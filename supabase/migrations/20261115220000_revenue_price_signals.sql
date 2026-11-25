-- Price Signal: one demand score (0–100) per stay date, derived from the same
-- facts the pricing engine prices from (latest engine decision per date,
-- approved events, validated competitor median). Shown on the Rate & Pickup
-- calendar in place of unlabeled colour blocks, and quoted by the engines.
--
--   pace gap vs. lead-time target ... 35
--   7-day pickup velocity .......... 25
--   approved event impact .......... 20
--   competitor median vs. our rate . 10
--   scarcity / weekend ............. 10
--
-- Bands: surge >=80 · strong >=60 · on_pace >=40 · soft >=20 · weak.
-- SECURITY INVOKER: the caller's RLS on the underlying tables applies.
create or replace function public.revenue_price_signals(p_hotel_id text, p_from date, p_to date)
returns table (
  stay_date date,
  days_out integer,
  score integer,
  band text,
  action text,
  occupancy_pct numeric,
  pace_target_pct numeric,
  rooms_remaining integer,
  pickup_24h integer,
  pickup_7d integer,
  reference_price numeric,
  market_median numeric,
  event_title text,
  event_impact text,
  engine_direction text,
  engine_reason text,
  engine_at timestamptz,
  drivers text[]
)
language sql
stable
security invoker
set search_path = public
as $$
with latest as (
  select distinct on (d.stay_date) d.*
  from public.revenue_date_decisions d
  where d.hotel_id = p_hotel_id and d.stay_date between p_from and p_to
    and d.created_at >= now() - interval '2 days'
  order by d.stay_date, d.created_at desc
), ev as (
  -- A season-long entry (Advent markets, festive period) is context, not a
  -- compression night: anything longer than 4 days counts as 'seasonal'.
  select e.event_date, e.end_date, e.title,
         case when coalesce(e.end_date, e.event_date) - e.event_date > 4 then 'seasonal'
              else lower(coalesce(e.expected_impact,'')) end impact
  from public.demand_events e
  where e.hotel_id = p_hotel_id and e.approved = true
    and coalesce(e.end_date, e.event_date) >= p_from and e.event_date <= p_to
), facts as (
  select l.stay_date, l.days_out, l.occupancy_pct::numeric occ, l.pace_target_pct::numeric pace,
         l.rooms_remaining, coalesce(l.pickup_24h,0) p24, coalesce(l.pickup_7d,0) p7,
         coalesce(l.rooms_sold,0) + coalesce(l.rooms_remaining,0) rooms,
         l.current_price::numeric ref, l.direction, l.decision_reason, l.created_at,
         m.median_rate_eur::numeric median, coalesce(m.validated_competitor_count,0) comps,
         (select x.title from ev x where l.stay_date between x.event_date and coalesce(x.end_date, x.event_date)
            order by (x.impact='high') desc, (x.impact='medium') desc, (x.impact='seasonal') desc limit 1) event_title,
         (select x.impact from ev x where l.stay_date between x.event_date and coalesce(x.end_date, x.event_date)
            order by (x.impact='high') desc, (x.impact='medium') desc, (x.impact='seasonal') desc limit 1) event_impact,
         extract(isodow from l.stay_date) dow
  from latest l
  left join public.revenue_competitor_market_daily m on m.hotel_id = p_hotel_id and m.stay_date = l.stay_date
), scored as (
  select f.*,
    -- pace: −30 points behind → 0, on pace → 17.5, +30 ahead → 35
    round(least(35, greatest(0, (coalesce(f.occ,0) - coalesce(f.pace,0) + 30) / 60 * 35)))::int s_pace,
    -- pickup velocity: 7-day pickup as share of house, 40% of the house in a week = full marks; fresh 24h pickup adds
    round(least(25, greatest(0, f.p7::numeric / greatest(1,f.rooms) / 0.40 * 20 + least(5, f.p24 * 2.5))))::int s_pickup,
    case f.event_impact when 'high' then 20 when 'medium' then 10 when 'seasonal' then 5 when 'low' then 4 else 0 end s_event,
    -- market: competitors priced above us = room to move up
    case when f.median is null or f.comps < 3 or f.ref is null or f.ref <= 0 then 5
         when f.median >= f.ref * 1.15 then 10
         when f.median >= f.ref * 1.05 then 8
         when f.median >= f.ref * 0.95 then 5
         when f.median >= f.ref * 0.85 then 2
         else 0 end s_market,
    least(10, (case when coalesce(f.rooms_remaining,99) <= 1 then 10 when f.rooms_remaining <= 3 then 8 when f.rooms_remaining <= 5 then 5 else 0 end)
              + (case when f.dow in (5,6) then 3 else 0 end))::int s_scarcity
  from facts f
), banded as (
  select s.*, (s.s_pace + s.s_pickup + s.s_event + s.s_market + s.s_scarcity)::int total from scored s
)
select b.stay_date, b.days_out, b.total score,
  case when b.total >= 80 then 'surge' when b.total >= 60 then 'strong' when b.total >= 40 then 'on_pace' when b.total >= 20 then 'soft' else 'weak' end band,
  case when b.total >= 60 then 'raise'
       when b.total >= 40 then 'hold'
       when coalesce(b.occ,0) >= 85 or coalesce(b.rooms_remaining,99) <= 3 then 'hold'
       else 'lower' end action,
  b.occ, b.pace, b.rooms_remaining, b.p24, b.p7, b.ref, b.median, b.event_title, b.event_impact,
  b.direction, b.decision_reason, b.created_at,
  array_remove(array[
    format('Pace: %s%% sold vs %s%% target %s days out (%s/35)', coalesce(round(b.occ)::text,'?'), coalesce(round(b.pace)::text,'?'), b.days_out, b.s_pace),
    format('Pickup: %s rooms in 7 days, %s in 24h (%s/25)', b.p7, b.p24, b.s_pickup),
    case when b.event_title is not null then format('Event: %s (%s) (%s/20)', b.event_title, b.event_impact, b.s_event) else 'Event: none approved (0/20)' end,
    case when b.median is null or b.comps < 3 then 'Market: no validated competitor median (5/10)'
         else format('Market: competitor median €%s vs our €%s (%s/10)', round(b.median), round(b.ref), b.s_market) end,
    format('Inventory: %s rooms left%s (%s/10)', coalesce(b.rooms_remaining::text,'?'), case when b.dow in (5,6) then ', weekend' else '' end, b.s_scarcity),
    case when b.direction is not null then format('Engine: %s · %s', b.direction, coalesce(b.decision_reason,'')) else null end
  ], null) drivers
from banded b
order by b.stay_date
$$;

revoke all on function public.revenue_price_signals(text, date, date) from public;
grant execute on function public.revenue_price_signals(text, date, date) to authenticated, service_role;
