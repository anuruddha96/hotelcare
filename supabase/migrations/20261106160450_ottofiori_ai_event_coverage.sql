-- Keep all high-impact winter events ahead of the bounded context limit.
-- Expose actual manager protection and current budgets to the independent reviewer.
create or replace function public.ottofiori_ai_context(p_stay_date date default null) returns jsonb
language sql security invoker set search_path=public as $fn$
with dates as (
 select d::date stay_date from generate_series((now() at time zone 'Europe/Budapest')::date,
 (now() at time zone 'Europe/Budapest')::date+120,interval '1 day') d where p_stay_date is null or d::date=p_stay_date
), cells as (
 select distinct on(r.stay_date,r.obk_id,r.occupancy) r.stay_date,r.obk_id,r.occupancy,
 round(r.price)::int price,r.captured_at
 from public.revenue_room_type_rates r join public.previo_rate_plan_mapping m
 on m.hotel_id=r.hotel_id and m.previo_room_type_id=r.obk_id and m.previo_rate_plan_id=r.rate_plan_id
 where r.hotel_id='ottofiori' and r.organization_slug='rdhotels'
 and r.stay_date between (now() at time zone 'Europe/Budapest')::date and (now() at time zone 'Europe/Budapest')::date+120
 and (p_stay_date is null or r.stay_date=p_stay_date) and r.price>0 and r.currency='EUR'
 order by r.stay_date,r.obk_id,r.occupancy,r.captured_at desc
), priced as (
 select c.stay_date,min(c.price) min_price,max(c.price) max_price,min(c.captured_at) captured_at,
 min(c.price) filter(where c.occupancy=2 and coalesce(a.availability,1)>0) reference,
 jsonb_agg(jsonb_build_object('obk_id',c.obk_id,'occupancy',c.occupancy,'price',c.price) order by c.obk_id,c.occupancy) cells
 from cells c left join public.revenue_room_type_availability a
 on a.hotel_id='ottofiori' and a.stay_date=c.stay_date and a.obk_id=c.obk_id group by c.stay_date
), bookings as (
 select stay_date,max(created_at_pms) last_pickup,
 count(distinct res_id) filter(where created_at_pms>=now()-interval '1 hour') pickup_1h,
 count(distinct res_id) filter(where created_at_pms>=now()-interval '6 hours') pickup_6h,
 count(distinct res_id) filter(where created_at_pms>=now()-interval '24 hours') pickup_24h,
 count(distinct res_id) filter(where created_at_pms>=now()-interval '48 hours') pickup_48h,
 count(distinct res_id) filter(where created_at_pms>=now()-interval '7 days') pickup_7d
 from public.revenue_booking_nights where hotel_id='ottofiori' and organization_slug='rdhotels'
 and stay_date between (now() at time zone 'Europe/Budapest')::date and (now() at time zone 'Europe/Budapest')::date+120 and (p_stay_date is null or stay_date=p_stay_date) group by stay_date
), movement as (
 select stay_date,sum(abs(movement)) filter(where direction='decrease') down_today,
 sum(abs(movement)) filter(where direction='increase') up_today,
 count(*) filter(where direction='decrease') markdowns_today,max(created_at) last_move_at
 from public.revenue_date_decisions where hotel_id='ottofiori' and (p_stay_date is null or stay_date=p_stay_date) and direction<>'hold'
 and status in ('queued','accepted','confirmed','published','partial')
 and created_at>=(((now() at time zone 'Europe/Budapest')::date)::timestamp at time zone 'Europe/Budapest') group by stay_date
), holds as (
 select stay_date,max(case when hold_kind='hard' then hold_until else hold_until+interval '4 hours' end) manager_hold_until
 from public.revenue_manual_hold_state('ottofiori',now()-interval '4 hours',array['cell-edit','cell-selection','day-tool','bulk','bulk-edit','manual','quick-adjust']) group by stay_date
), facts as (
 select jsonb_build_object('date',d.stay_date,'lead',d.stay_date-(now() at time zone 'Europe/Budapest')::date,
 'occ',s.occupancy_pct,'left',greatest(0,s.rooms_available-s.rooms_sold),
 'reference',p.reference,'min_price',p.min_price,'max_price',p.max_price,'cells',coalesce(p.cells,'[]'::jsonb),'captured_at',coalesce((select max(pms_refreshed_at) from public.ottofiori_ai_review_runs where status='running' and pms_refreshed_at>=now()-interval '8 minutes'),p.captured_at),
 'pickup_1h',coalesce(b.pickup_1h,0),'pickup_6h',coalesce(b.pickup_6h,0),'pickup_24h',coalesce(b.pickup_24h,0),
 'pickup_48h',coalesce(b.pickup_48h,0),'pickup_7d',coalesce(b.pickup_7d,0),
 'quiet_hours',case when b.last_pickup is null then null else round(extract(epoch from now()-b.last_pickup)/3600,1) end,
 'cancellations_24h',(select count(*) from public.revenue_cancelled_nights n where n.hotel_id='ottofiori' and n.stay_date=d.stay_date and n.cancelled_at>=now()-interval '24 hours'),
 'down_today',coalesce(m.down_today,0),'up_today',coalesce(m.up_today,0),'markdowns_today',coalesce(m.markdowns_today,0),'last_move_at',m.last_move_at,
 'market',jsonb_build_object('median',c.median_rate_eur,'count',coalesce(c.validated_competitor_count,0),'age_hours',extract(epoch from now()-c.freshest_captured_at)/3600),
 'manager_hold_until',h.manager_hold_until,'engine_reason',e.decision_reason,'pace',e.pace_target_pct) fact
 from dates d left join priced p using(stay_date) left join bookings b using(stay_date) left join movement m using(stay_date) left join holds h using(stay_date)
 left join lateral(select rooms_sold,rooms_available,occupancy_pct from public.revenue_daily_snapshots
 where hotel_id='ottofiori' and stay_date=d.stay_date order by captured_at desc limit 1) s on true
 left join public.revenue_competitor_market_daily c on c.hotel_id='ottofiori' and c.stay_date=d.stay_date
 left join lateral(select decision_reason,pace_target_pct from public.revenue_date_decisions
 where hotel_id='ottofiori' and stay_date=d.stay_date order by created_at desc limit 1) e on true
)
select jsonb_build_object('dates',(select jsonb_agg(fact) from facts),
 'rule',(select jsonb_build_object('windows',window_rules,'floor',80,'daily_movement_cap',40,'max_markdowns',max_markdowns_per_day,'monthly_adr_targets',monthly_adr_targets)
 from public.revenue_pickup_automation_rules where hotel_id='ottofiori' and organization_slug='rdhotels' limit 1),
 'events',(select coalesce(jsonb_agg(to_jsonb(e)),'[]'::jsonb) from (select title,event_date,end_date,expected_impact,approved,confidence,url,source from public.demand_events
 where hotel_id='ottofiori' and coalesce(end_date,event_date)>=(now() at time zone 'Europe/Budapest')::date
 and event_date<=(now() at time zone 'Europe/Budapest')::date+120 and approved=true order by (expected_impact='high') desc,event_date limit 150) e),
 'history',(select coalesce(jsonb_agg(to_jsonb(h)),'[]'::jsonb) from (select distinct on(stay_date) stay_date,occupancy_pct,adr_eur,revpar_eur
 from public.revenue_historical_daily where p_stay_date is null and hotel_id='ottofiori' and stay_date between (now() at time zone 'Europe/Budapest')::date-interval '1 year'
 and (now() at time zone 'Europe/Budapest')::date+120-interval '1 year' order by stay_date,observed_date desc limit 121) h))
$fn$;
