-- KPI reconciliation: make it fast for hotel managers.
--
-- Why: the views from 20261112090000_kpi_reconciliation_layer are
-- security_invoker, so every row of revenue_booking_nights, room_types and
-- daily_overview_snapshots ran its RLS policy functions, and the month filter
-- could not reach stay_date. A Mika manager loading one month waited 79 s
-- (PostgREST times out far earlier), so the Revenue page card stayed empty.
--
-- Now one function does the work for ONE hotel and an explicit date range,
-- after ONE access check (user_can_access_hotel, the same rule that guards
-- revenue_booking_nights). The two views and the card's RPC all read from it,
-- so the logic lives in one place. Output columns and figures are unchanged.
--
-- Access: a signed-in user gets rows only for hotels they can access; anon gets
-- nothing; a direct database / service-role connection (no user JWT) gets all.
-- Housekeeping data is exposed only as a per-night room COUNT, never names.

drop view if exists public.revenue_kpi_reconciliation_monthly;
drop view if exists public.revenue_kpi_reconciliation_daily;

-- ---------------------------------------------------------------------------
-- 1. Access check, once per call.
-- ---------------------------------------------------------------------------
create or replace function public.revenue_kpi_reconciliation_allowed(p_hotel_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is not null then public.user_can_access_hotel(auth.uid(), p_hotel_id)
    -- No signed-in user: allow only service role or a direct DB session.
    else coalesce(auth.role(), '') in ('service_role', '')
  end;
$$;

revoke all on function public.revenue_kpi_reconciliation_allowed(text) from public, anon;
grant execute on function public.revenue_kpi_reconciliation_allowed(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Per-night reconciliation for one hotel. p_from / p_to are widened to whole
--    months; null means every month that has bookings or housekeeping data.
-- ---------------------------------------------------------------------------
create or replace function public.revenue_kpi_reconciliation_days(
  p_hotel_id text,
  p_from date default null,
  p_to date default null
)
returns table (
  hotel_id text,
  stay_date date,
  is_past_night boolean,
  capacity_rooms integer,
  commercial_capacity integer,
  booked_nights_all integer,
  hold_nights integer,
  commercial_sold integer,
  unassigned_nights integer,
  option_nights integer,
  previo_dashboard_occupied integer,
  housekeeping_occupied integer,
  housekeeping_usable boolean,
  best_physical_occupied integer,
  best_commercial_sold integer,
  best_source text,
  confidence text,
  previo_dashboard_occupancy_pct numeric,
  hotelcare_commercial_occupancy_pct numeric,
  housekeeping_occupancy_pct numeric,
  best_physical_occupancy_pct numeric,
  best_commercial_occupancy_pct numeric,
  room_revenue_gross numeric,
  adr_gross numeric,
  revpar_gross numeric,
  unpriced_nights integer,
  flags text[],
  bookings_captured_at timestamptz,
  housekeeping_captured_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
with guard as (
  select public.revenue_kpi_reconciliation_allowed(p_hotel_id) as ok
),
today as (
  select (now() at time zone 'Europe/Budapest')::date as d
),
data_bounds as (
  -- Only needed when the caller did not give a range.
  select min(x.d) as first_night, max(x.d) as last_night
  from (
    select min(b.stay_date) as d from public.revenue_booking_nights b where b.hotel_id = p_hotel_id
    union all
    select max(b.stay_date) from public.revenue_booking_nights b where b.hotel_id = p_hotel_id
    union all
    select min(o.business_date) - 1 from public.daily_overview_snapshots o where o.hotel_id = p_hotel_id
  ) x
  where p_from is null or p_to is null
),
win as (
  select
    date_trunc('month', coalesce(p_from, (select first_night from data_bounds)))::date as d_from,
    (date_trunc('month', coalesce(p_to, (select last_night from data_bounds)))
       + interval '1 month - 1 day')::date as d_to
),
capacity as (
  select sum(coalesce(rt.num_rooms, 0))::int as capacity_rooms
  from public.room_types rt
  where rt.hotel_id = p_hotel_id
    and coalesce(rt.counts_toward_inventory, true)
),
excluded_kinds as (
  -- Room kinds that do not count toward inventory (e.g. SLNT's excluded
  -- apartments) must not count as sold either, or occupancy can exceed 100%.
  select rt.pms_room_id
  from public.room_types rt
  where rt.hotel_id = p_hotel_id
    and rt.counts_toward_inventory = false
    and rt.pms_room_id is not null
),
nights as (
  select
    b.stay_date,
    count(*)::int as booked_nights_all,
    count(*) filter (where h.is_hold)::int as hold_nights,
    count(*) filter (where not h.is_hold)::int as commercial_sold,
    count(*) filter (where b.obj_id is null)::int as unassigned_nights,
    count(*) filter (where b.status_id = 1)::int as option_nights,
    count(distinct b.obj_id) filter (where b.obj_id is not null)::int as previo_dashboard_occupied,
    coalesce(sum(b.nightly_price_eur) filter (where not h.is_hold), 0)::numeric as room_revenue_gross,
    count(*) filter (where not h.is_hold and coalesce(b.nightly_price_eur, 0) = 0)::int as unpriced_nights,
    max(b.captured_at) as bookings_captured_at
  from public.revenue_booking_nights b
  cross join win r
  cross join lateral (
    -- Source-less stays longer than a leap year are unit holds, not sales.
    select (coalesce(btrim(b.source_name), '') = ''
            and b.stay_from is not null and b.stay_to is not null
            and (b.stay_to - b.stay_from) > 366) as is_hold
  ) h
  where b.hotel_id = p_hotel_id
    and b.stay_date between r.d_from and r.d_to
    and (select ok from guard)
    and b.status_id not in (7, 8)
    -- Zero-night records (arrival = departure) are not sold room-nights.
    and not (b.stay_from is not null and b.stay_to is not null and b.stay_to <= b.stay_from)
    and (b.obk_id is null or b.obk_id not in (select pms_room_id from excluded_kinds))
  group by b.stay_date
),
housekeeping as (
  -- The morning list for business_date D+1 holds every room that was occupied
  -- on night D: departures that morning plus ongoing stays (arrival <= D).
  select
    (o.business_date - 1) as stay_date,
    count(distinct o.room_label) filter (
      where o.arrival_date <= o.business_date - 1
        and o.departure_date >= o.business_date
    )::int as housekeeping_occupied,
    max(o.captured_at) as housekeeping_captured_at
  from public.daily_overview_snapshots o
  cross join win r
  where o.hotel_id = p_hotel_id
    and o.business_date between r.d_from + 1 and r.d_to + 1
    and o.business_date <= (select d from today)
    and (select ok from guard)
  group by o.business_date
),
spine as (
  -- Every night of every covered month, so empty nights still count toward
  -- capacity exactly like the PMS month card does.
  select g::date as stay_date
  from win r
  cross join lateral generate_series(r.d_from, r.d_to, interval '1 day') g
  where (select ok from guard)
    and r.d_from is not null
    -- Guard against runaway ranges (about three years).
    and r.d_to - r.d_from <= 1130
),
joined as (
  select
    s.stay_date,
    (s.stay_date < (select d from today)) as is_past_night,
    c.capacity_rooms,
    coalesce(n.booked_nights_all, 0) as booked_nights_all,
    coalesce(n.hold_nights, 0) as hold_nights,
    coalesce(n.commercial_sold, 0) as commercial_sold,
    coalesce(n.unassigned_nights, 0) as unassigned_nights,
    coalesce(n.option_nights, 0) as option_nights,
    coalesce(n.previo_dashboard_occupied, 0) as previo_dashboard_occupied,
    k.housekeeping_occupied,
    coalesce(n.room_revenue_gross, 0) as room_revenue_gross,
    coalesce(n.unpriced_nights, 0) as unpriced_nights,
    n.bookings_captured_at,
    k.housekeeping_captured_at
  from spine s
  cross join capacity c
  left join nights n on n.stay_date = s.stay_date
  left join housekeeping k on k.stay_date = s.stay_date
),
checked as (
  select
    j.*,
    -- The housekeeping list is an independent check, but early imports (e.g.
    -- August 2026) were incomplete and labels can occasionally duplicate. Use
    -- it only when it is close to the booking book; otherwise flag the night.
    (j.housekeeping_occupied is not null
      and abs(j.housekeeping_occupied - j.booked_nights_all)
          <= greatest(2, ceil(0.05 * coalesce(j.capacity_rooms, 0)))) as housekeeping_usable
  from joined j
),
best as (
  select
    c.*,
    -- Physical rooms occupied (holds included, like Previo).
    --   past night + usable housekeeping list -> what housekeeping saw
    --   past night otherwise                  -> rooms Previo had assigned
    --   future night                          -> every booking on the books
    case
      when c.is_past_night and c.housekeeping_usable
        then least(c.housekeeping_occupied, coalesce(c.capacity_rooms, c.housekeeping_occupied))
      when c.is_past_night then c.previo_dashboard_occupied
      else c.booked_nights_all
    end as best_physical_occupied,
    case
      when c.is_past_night and c.housekeeping_usable then 'housekeeping_verified'
      when c.is_past_night then 'previo_assigned_rooms'
      else 'bookings_on_the_books'
    end as best_source
  from checked c
)
select
  p_hotel_id,
  b.stay_date,
  b.is_past_night,
  b.capacity_rooms,
  greatest(coalesce(b.capacity_rooms, 0) - b.hold_nights, 0),
  b.booked_nights_all,
  b.hold_nights,
  b.commercial_sold,
  b.unassigned_nights,
  b.option_nights,
  b.previo_dashboard_occupied,
  b.housekeeping_occupied,
  b.housekeeping_usable,
  b.best_physical_occupied,
  greatest(b.best_physical_occupied - b.hold_nights, 0),
  b.best_source,
  case
    when b.best_source = 'housekeeping_verified'
         and abs(b.housekeeping_occupied - b.previo_dashboard_occupied) <= 1 then 'high'
    when b.best_source = 'bookings_on_the_books'
         and b.unassigned_nights = 0 and b.option_nights = 0 then 'high'
    when b.housekeeping_occupied is not null and not b.housekeeping_usable then 'low'
    else 'medium'
  end,
  round(100.0 * b.previo_dashboard_occupied / nullif(b.capacity_rooms, 0), 1),
  round(100.0 * b.commercial_sold / nullif(b.capacity_rooms - b.hold_nights, 0), 1),
  round(100.0 * b.housekeeping_occupied / nullif(b.capacity_rooms, 0), 1),
  round(100.0 * b.best_physical_occupied / nullif(b.capacity_rooms, 0), 1),
  round(100.0 * greatest(b.best_physical_occupied - b.hold_nights, 0)
        / nullif(b.capacity_rooms - b.hold_nights, 0), 1),
  -- Gross = full reservation price (may include breakfast / extras / taxes).
  round(b.room_revenue_gross, 2),
  round(b.room_revenue_gross / nullif(b.commercial_sold - b.unpriced_nights, 0), 2),
  round(b.room_revenue_gross / nullif(b.capacity_rooms - b.hold_nights, 0), 2),
  b.unpriced_nights,
  array_remove(array[
    case when b.unassigned_nights > 0 then 'unassigned_rooms' end,
    case when b.option_nights > 0 then 'options_counted' end,
    case when b.hold_nights > 0 then 'inventory_holds' end,
    case when b.housekeeping_occupied is not null and not b.housekeeping_usable
      then 'housekeeping_mismatch' end,
    case when b.housekeeping_usable and b.housekeeping_occupied <> b.previo_dashboard_occupied
      then 'housekeeping_differs_from_previo' end,
    case when b.booked_nights_all > coalesce(b.capacity_rooms, 0) then 'overbooked_or_duplicate' end,
    case when b.unpriced_nights > 0 then 'unpriced_nights' end,
    case when b.is_past_night and b.housekeeping_occupied is null then 'no_housekeeping_check' end
  ], null),
  b.bookings_captured_at,
  b.housekeeping_captured_at
from best b
order by b.stay_date;
$$;

revoke all on function public.revenue_kpi_reconciliation_days(text, date, date) from public, anon;
grant execute on function public.revenue_kpi_reconciliation_days(text, date, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Monthly roll-up for one hotel. The Revenue page card calls this as an RPC
--    with p_from = p_to = the selected month's first day.
-- ---------------------------------------------------------------------------
create or replace function public.revenue_kpi_reconciliation_months(
  p_hotel_id text,
  p_from date default null,
  p_to date default null
)
returns table (
  hotel_id text,
  month_start date,
  nights_in_data integer,
  capacity_room_nights integer,
  commercial_capacity_room_nights integer,
  booked_nights_all integer,
  hold_nights integer,
  commercial_sold integer,
  unassigned_nights integer,
  option_nights integer,
  previo_dashboard_occupied integer,
  housekeeping_occupied_past integer,
  past_nights integer,
  housekeeping_verified_nights integer,
  best_physical_occupied integer,
  best_commercial_sold integer,
  previo_dashboard_occupancy_pct numeric,
  hotelcare_commercial_occupancy_pct numeric,
  best_physical_occupancy_pct numeric,
  best_commercial_occupancy_pct numeric,
  room_revenue_gross numeric,
  adr_gross numeric,
  unpriced_nights integer,
  revpar_gross numeric,
  housekeeping_mismatch_nights integer
)
language sql
stable
security definer
set search_path = public
as $$
select
  p_hotel_id,
  date_trunc('month', d.stay_date)::date,
  count(*)::int,
  sum(d.capacity_rooms)::int,
  sum(d.commercial_capacity)::int,
  sum(d.booked_nights_all)::int,
  sum(d.hold_nights)::int,
  sum(d.commercial_sold)::int,
  sum(d.unassigned_nights)::int,
  sum(d.option_nights)::int,
  sum(d.previo_dashboard_occupied)::int,
  (sum(d.housekeeping_occupied) filter (where d.is_past_night))::int,
  (count(*) filter (where d.is_past_night))::int,
  (count(*) filter (where d.best_source = 'housekeeping_verified'))::int,
  sum(d.best_physical_occupied)::int,
  sum(d.best_commercial_sold)::int,
  round(100.0 * sum(d.previo_dashboard_occupied) / nullif(sum(d.capacity_rooms), 0), 1),
  round(100.0 * sum(d.commercial_sold) / nullif(sum(d.commercial_capacity), 0), 1),
  round(100.0 * sum(d.best_physical_occupied) / nullif(sum(d.capacity_rooms), 0), 1),
  round(100.0 * sum(d.best_commercial_sold) / nullif(sum(d.commercial_capacity), 0), 1),
  round(sum(d.room_revenue_gross), 2),
  round(sum(d.room_revenue_gross) / nullif(sum(d.commercial_sold) - sum(d.unpriced_nights), 0), 2),
  sum(d.unpriced_nights)::int,
  round(sum(d.room_revenue_gross) / nullif(sum(d.commercial_capacity), 0), 2),
  (count(*) filter (where 'housekeeping_mismatch' = any(d.flags)))::int
from public.revenue_kpi_reconciliation_days(p_hotel_id, p_from, p_to) d
group by date_trunc('month', d.stay_date)
order by 2;
$$;

revoke all on function public.revenue_kpi_reconciliation_months(text, date, date) from public, anon;
grant execute on function public.revenue_kpi_reconciliation_months(text, date, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Same views as before (same columns), now on top of the functions, so ad-hoc
--    analysis keeps working. Each hotel is computed in one pass after one check.
-- ---------------------------------------------------------------------------
create view public.revenue_kpi_reconciliation_daily
with (security_invoker = true)
as
select d.*
from (select distinct rt.hotel_id from public.room_types rt where rt.hotel_id is not null) h
cross join lateral public.revenue_kpi_reconciliation_days(h.hotel_id) d;

comment on view public.revenue_kpi_reconciliation_daily is
  'Per hotel-night occupancy from three sources: Previo dashboard definition (rooms with a physical room assigned), HotelCare commercial (all bookings, holds excluded both sides) and next-morning housekeeping list. best_* picks housekeeping for past nights and bookings on the books for future nights. Revenue is gross reservation price. For one hotel and range, call revenue_kpi_reconciliation_days() directly.';

create view public.revenue_kpi_reconciliation_monthly
with (security_invoker = true)
as
select m.*
from (select distinct rt.hotel_id from public.room_types rt where rt.hotel_id is not null) h
cross join lateral public.revenue_kpi_reconciliation_months(h.hotel_id) m;

comment on view public.revenue_kpi_reconciliation_monthly is
  'Monthly roll-up per hotel. previo_dashboard_* should match the Previo dashboard month card; hotelcare_commercial_* matches the HotelCare Revenue month header; best_* is the recommended figure. For one hotel and month, call revenue_kpi_reconciliation_months() directly (fast).';

revoke all on public.revenue_kpi_reconciliation_daily from public, anon;
revoke all on public.revenue_kpi_reconciliation_monthly from public, anon;
grant select on public.revenue_kpi_reconciliation_daily to authenticated, service_role;
grant select on public.revenue_kpi_reconciliation_monthly to authenticated, service_role;
