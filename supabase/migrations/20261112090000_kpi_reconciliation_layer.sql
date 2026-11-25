-- KPI reconciliation layer: Previo dashboard vs HotelCare vs housekeeping.
--
-- Why: managers compare HotelCare occupancy with the Previo dashboard and see
-- different numbers. Investigation on 2026-11-12 showed the gap is almost
-- entirely definitional, plus one real bug:
--
--   1. Previo's dashboard "Occupied" counts only room-nights that have a
--      physical room (object) assigned. HotelCare counts every booked
--      room-night, including bookings not yet allocated to a room.
--      Reproduced exactly: Mika Dec 512, Ottofiori Nov 507 / Dec 394 / Jan 26,
--      Gozsdu Dec 1730 (Mika Nov 836 vs Previo 835).
--   2. Gozsdu's source-less multi-year inventory holds were removed from the
--      snapshot denominator (rooms_available) by previo-revenue-sync, but the
--      BEFORE-write integrity trigger counted them back into rooms_sold, so
--      revenue_daily_snapshots showed Gozsdu at up to 125% occupancy. Fixed below.
--   3. Previo's ADR is lower than HotelCare's by EUR 11.6-13.7 per guest per
--      night on all 8 checked Mika/Ottofiori nights (Nov 5/12, Dec 3/10/11/18),
--      while the percentage gap moved between 14% and 39%. On fully-breakfasted
--      nights the gap equals the breakfast count x ~EUR 12.1-12.4. So Previo's
--      dashboard ADR is room-only and HotelCare's <price> total includes
--      breakfast / per-person extras. Not corrected here: amounts stay labelled
--      gross until the split is read from Previo per reservation.
--   4. Zero-night records (stay_from = stay_to, e.g. Mika status 9 on Nov 2/6)
--      were counted as one sold night. Excluded below.
--   5. Previo's dashboard month card lagged bookings made the same morning
--      (Mika Nov: 4 bookings created 05:41-10:28 = 12 nights missing at 12:50).
--
-- New, read-only views (security_invoker, so existing tenant RLS applies):
--   revenue_kpi_reconciliation_daily   one row per hotel and night
--   revenue_kpi_reconciliation_monthly the same, summed per month
-- They add a third, independent source: the next-morning housekeeping room
-- list (daily_overview_snapshots for business_date = night + 1), which shows
-- which rooms were really occupied, including walk-ins, minus no-shows.

-- ---------------------------------------------------------------------------
-- 1. Snapshot integrity: keep inventory holds out of rooms_sold and revenue,
--    matching rooms_available (capacity minus holds) and the frontend.
-- ---------------------------------------------------------------------------
create or replace function public.revenue_snapshot_before_write_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sold integer := 0;
  v_priced integer := 0;
  v_revenue numeric := 0;
  v_new integer := 0;
begin
  if new.hotel_id = 'slnt-group' then
    return new;
  end if;

  select
    count(*),
    count(*) filter (where coalesce(nightly_price_eur, 0) > 0),
    coalesce(sum(coalesce(nightly_price_eur, 0)), 0),
    count(*) filter (
      where coalesce(nightly_price_eur, 0) > 0
        and created_at_pms is not null
        and (created_at_pms at time zone 'Europe/Budapest')::date = new.captured_date
    )
  into v_sold, v_priced, v_revenue, v_new
  from public.revenue_booking_nights
  where hotel_id = new.hotel_id
    and stay_date = new.stay_date
    -- A record that starts and ends on the same day is not a sold night.
    and not (stay_from is not null and stay_to is not null and stay_to <= stay_from)
    -- Source-less stays longer than a leap year are unit holds, not sales.
    -- previo-revenue-sync already subtracts them from rooms_available, so
    -- counting them here as sold pushed occupancy above 100%.
    and not (
      coalesce(trim(source_name), '') = ''
      and stay_from is not null
      and stay_to is not null
      and (stay_to - stay_from) > 366
    );

  new.rooms_sold := v_sold;
  new.revenue_eur := round(v_revenue, 2);
  new.adr_eur := case when v_priced > 0 then round(v_revenue / v_priced, 2) else null end;
  new.new_bookings := v_new;
  if coalesce(new.rooms_available, 0) > 0 then
    new.occupancy_pct := round((v_sold::numeric / new.rooms_available) * 100, 1);
  else
    new.occupancy_pct := 0;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Daily reconciliation view.
-- ---------------------------------------------------------------------------
create or replace view public.revenue_kpi_reconciliation_daily
with (security_invoker = true)
as
with capacity as (
  select hotel_id, sum(coalesce(num_rooms, 0))::int as capacity_rooms
  from public.room_types
  where coalesce(counts_toward_inventory, true)
  group by hotel_id
),
nights as (
  select
    b.hotel_id,
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
  cross join lateral (
    select (coalesce(btrim(b.source_name), '') = ''
            and b.stay_from is not null and b.stay_to is not null
            and (b.stay_to - b.stay_from) > 366) as is_hold
  ) h
  where b.status_id not in (7, 8)
    -- Zero-night records (arrival = departure) are not sold room-nights.
    and not (b.stay_from is not null and b.stay_to is not null and b.stay_to <= b.stay_from)
    -- Nights on room kinds that do not count toward inventory (e.g. SLNT's
    -- excluded apartments) must not count as sold either, or occupancy can
    -- exceed 100%.
    and not exists (
      select 1 from public.room_types rt
      where rt.hotel_id = b.hotel_id
        and rt.pms_room_id = b.obk_id
        and rt.counts_toward_inventory = false
    )
  group by b.hotel_id, b.stay_date
),
housekeeping as (
  -- The morning list for business_date D+1 holds every room that was occupied
  -- on night D: departures that morning plus ongoing stays (arrival <= D).
  select
    o.hotel_id,
    (o.business_date - 1) as stay_date,
    count(distinct o.room_label) filter (
      where o.arrival_date <= o.business_date - 1
        and o.departure_date >= o.business_date
    )::int as housekeeping_occupied,
    max(o.captured_at) as housekeeping_captured_at
  from public.daily_overview_snapshots o
  where o.business_date <= (now() at time zone 'Europe/Budapest')::date
  group by o.hotel_id, o.business_date
),
bounds as (
  select hotel_id, min(stay_date) as first_night, max(stay_date) as last_night
  from (
    select hotel_id, stay_date from nights
    union all
    select hotel_id, stay_date from housekeeping
  ) z
  group by hotel_id
),
spine as (
  -- Every night of every covered month, so empty nights still count toward
  -- capacity exactly like the PMS month card does.
  select b.hotel_id, g::date as stay_date
  from bounds b
  cross join lateral generate_series(
    date_trunc('month', b.first_night)::date,
    (date_trunc('month', b.last_night) + interval '1 month - 1 day')::date,
    interval '1 day'
  ) g
),
joined as (
  select
    s.hotel_id,
    s.stay_date,
    (s.stay_date < (now() at time zone 'Europe/Budapest')::date) as is_past_night,
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
  left join capacity c on c.hotel_id = s.hotel_id
  left join nights n on n.hotel_id = s.hotel_id and n.stay_date = s.stay_date
  left join housekeeping k on k.hotel_id = s.hotel_id and k.stay_date = s.stay_date
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
    --                                            (an unassigned past night
    --                                            is almost always a no-show)
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
  b.hotel_id,
  b.stay_date,
  b.is_past_night,
  b.capacity_rooms,
  greatest(coalesce(b.capacity_rooms, 0) - b.hold_nights, 0) as commercial_capacity,
  b.booked_nights_all,
  b.hold_nights,
  b.commercial_sold,
  b.unassigned_nights,
  b.option_nights,
  b.previo_dashboard_occupied,
  b.housekeeping_occupied,
  b.housekeeping_usable,
  b.best_physical_occupied,
  greatest(b.best_physical_occupied - b.hold_nights, 0) as best_commercial_sold,
  b.best_source,
  case
    when b.best_source = 'housekeeping_verified'
         and abs(b.housekeeping_occupied - b.previo_dashboard_occupied) <= 1 then 'high'
    when b.best_source = 'bookings_on_the_books'
         and b.unassigned_nights = 0 and b.option_nights = 0 then 'high'
    when b.housekeeping_occupied is not null and not b.housekeeping_usable then 'low'
    else 'medium'
  end as confidence,
  round(100.0 * b.previo_dashboard_occupied / nullif(b.capacity_rooms, 0), 1) as previo_dashboard_occupancy_pct,
  round(100.0 * b.commercial_sold / nullif(b.capacity_rooms - b.hold_nights, 0), 1) as hotelcare_commercial_occupancy_pct,
  round(100.0 * b.housekeeping_occupied / nullif(b.capacity_rooms, 0), 1) as housekeeping_occupancy_pct,
  round(100.0 * b.best_physical_occupied / nullif(b.capacity_rooms, 0), 1) as best_physical_occupancy_pct,
  round(100.0 * greatest(b.best_physical_occupied - b.hold_nights, 0)
        / nullif(b.capacity_rooms - b.hold_nights, 0), 1) as best_commercial_occupancy_pct,
  -- Gross = full reservation price (may include breakfast / extras / taxes).
  round(b.room_revenue_gross, 2) as room_revenue_gross,
  round(b.room_revenue_gross / nullif(b.commercial_sold - b.unpriced_nights, 0), 2) as adr_gross,
  round(b.room_revenue_gross / nullif(b.capacity_rooms - b.hold_nights, 0), 2) as revpar_gross,
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
  ], null) as flags,
  b.bookings_captured_at,
  b.housekeeping_captured_at
from best b;

comment on view public.revenue_kpi_reconciliation_daily is
  'Per hotel-night occupancy from three sources: Previo dashboard definition (rooms with a physical room assigned), HotelCare commercial (all bookings, holds excluded both sides) and next-morning housekeeping list. best_* columns pick housekeeping for past nights and bookings on the books for future nights. Revenue is gross reservation price.';

revoke all on public.revenue_kpi_reconciliation_daily from public, anon;
grant select on public.revenue_kpi_reconciliation_daily to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Monthly roll-up.
-- ---------------------------------------------------------------------------
create or replace view public.revenue_kpi_reconciliation_monthly
with (security_invoker = true)
as
select
  d.hotel_id,
  date_trunc('month', d.stay_date)::date as month_start,
  count(*)::int as nights_in_data,
  sum(d.capacity_rooms)::int as capacity_room_nights,
  sum(d.commercial_capacity)::int as commercial_capacity_room_nights,
  sum(d.booked_nights_all)::int as booked_nights_all,
  sum(d.hold_nights)::int as hold_nights,
  sum(d.commercial_sold)::int as commercial_sold,
  sum(d.unassigned_nights)::int as unassigned_nights,
  sum(d.option_nights)::int as option_nights,
  sum(d.previo_dashboard_occupied)::int as previo_dashboard_occupied,
  sum(d.housekeeping_occupied) filter (where d.is_past_night)::int as housekeeping_occupied_past,
  count(*) filter (where d.is_past_night)::int as past_nights,
  count(*) filter (where d.best_source = 'housekeeping_verified')::int as housekeeping_verified_nights,
  sum(d.best_physical_occupied)::int as best_physical_occupied,
  sum(d.best_commercial_sold)::int as best_commercial_sold,
  round(100.0 * sum(d.previo_dashboard_occupied) / nullif(sum(d.capacity_rooms), 0), 1) as previo_dashboard_occupancy_pct,
  round(100.0 * sum(d.commercial_sold) / nullif(sum(d.commercial_capacity), 0), 1) as hotelcare_commercial_occupancy_pct,
  round(100.0 * sum(d.best_physical_occupied) / nullif(sum(d.capacity_rooms), 0), 1) as best_physical_occupancy_pct,
  round(100.0 * sum(d.best_commercial_sold) / nullif(sum(d.commercial_capacity), 0), 1) as best_commercial_occupancy_pct,
  round(sum(d.room_revenue_gross), 2) as room_revenue_gross,
  round(sum(d.room_revenue_gross) / nullif(sum(d.commercial_sold) - sum(d.unpriced_nights), 0), 2) as adr_gross,
  sum(d.unpriced_nights)::int as unpriced_nights,
  round(sum(d.room_revenue_gross) / nullif(sum(d.commercial_capacity), 0), 2) as revpar_gross,
  count(*) filter (where 'housekeeping_mismatch' = any(d.flags))::int as housekeeping_mismatch_nights
from public.revenue_kpi_reconciliation_daily d
group by d.hotel_id, date_trunc('month', d.stay_date);

comment on view public.revenue_kpi_reconciliation_monthly is
  'Monthly roll-up of revenue_kpi_reconciliation_daily. previo_dashboard_* should match the Previo dashboard month card; hotelcare_commercial_* matches the HotelCare Revenue month header; best_* is the recommended figure.';

revoke all on public.revenue_kpi_reconciliation_monthly from public, anon;
grant select on public.revenue_kpi_reconciliation_monthly to authenticated;
