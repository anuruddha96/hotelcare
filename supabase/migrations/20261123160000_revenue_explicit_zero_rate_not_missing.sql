-- €0 is a PMS-provided value, not a missing price.
-- Preserve tenant authorization; flag zero allocations for verification.
CREATE OR REPLACE FUNCTION public.revenue_kpi_reconciliation_days(p_hotel_id text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS TABLE(hotel_id text, stay_date date, is_past_night boolean, capacity_rooms integer, commercial_capacity integer, booked_nights_all integer, hold_nights integer, commercial_sold integer, unassigned_nights integer, option_nights integer, previo_dashboard_occupied integer, housekeeping_occupied integer, housekeeping_usable boolean, best_physical_occupied integer, best_commercial_sold integer, best_source text, confidence text, previo_dashboard_occupancy_pct numeric, hotelcare_commercial_occupancy_pct numeric, housekeeping_occupancy_pct numeric, best_physical_occupancy_pct numeric, best_commercial_occupancy_pct numeric, room_revenue_gross numeric, adr_gross numeric, revpar_gross numeric, unpriced_nights integer, flags text[], bookings_captured_at timestamp with time zone, housekeeping_captured_at timestamp with time zone, breakfast_guests integer, breakfast_price_per_guest numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
settings as (
  -- Read here (as definer) because hotel managers cannot read the settings table.
  select hrs.breakfast_price_per_guest
  from public.hotel_revenue_settings hrs
  where hrs.hotel_id = p_hotel_id
  limit 1
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
    count(*) filter (where not h.is_hold and b.nightly_price_eur is null)::int as unpriced_nights,
    count(*) filter (where not h.is_hold and b.nightly_price_eur = 0)::int as zero_price_nights,
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
breakfasts as (
  -- Breakfasts served the morning after night D, from the housekeeping list for
  -- business_date D+1. Future lists exist too, so this covers nights ahead.
  -- One value per room (the list can arrive from more than one source).
  select x.stay_date, sum(x.bf)::int as breakfast_guests
  from (
    select (o.business_date - 1) as stay_date, o.room_label, max(coalesce(o.breakfast, 0)) as bf
    from public.daily_overview_snapshots o
    cross join win w
    where o.hotel_id = p_hotel_id
      and o.business_date between w.d_from + 1 and w.d_to + 1
      and o.arrival_date <= o.business_date - 1
      and o.departure_date >= o.business_date
      and (select ok from guard)
    group by 1, 2
  ) x
  group by x.stay_date
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
    coalesce(n.zero_price_nights, 0) as zero_price_nights,
    n.bookings_captured_at,
    k.housekeeping_captured_at,
    bf.breakfast_guests
  from spine s
  cross join capacity c
  left join nights n on n.stay_date = s.stay_date
  left join housekeeping k on k.stay_date = s.stay_date
  left join breakfasts bf on bf.stay_date = s.stay_date
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
    case when b.zero_price_nights > 0 then 'zero_price_nights' end,
    case when b.is_past_night and b.housekeeping_occupied is null then 'no_housekeeping_check' end
  ], null),
  b.bookings_captured_at,
  b.housekeeping_captured_at,
  b.breakfast_guests,
  (select st.breakfast_price_per_guest from settings st)
from best b
order by b.stay_date;
$function$;
