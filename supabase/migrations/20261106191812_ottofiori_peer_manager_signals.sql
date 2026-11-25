-- Same-date, confirmed Ricsi edits are evidence for Ottofiori's reviewer.
-- Read-only and server-only: this function never queues prices at any property.
create or replace function public.ottofiori_peer_context() returns jsonb
language sql stable security invoker set search_path=public as $fn$
with confirmed_cells as materialized (
 select distinct on (a.hotel_id,a.stay_date,a.payload->>'push_run_id',
   a.payload->>'room_type_name',a.payload->>'occupancy')
   a.hotel_id,a.stay_date,a.payload->>'push_run_id' run_key,
   coalesce(r.started_at,r.created_at,a.performed_at) action_at,
   a.old_rate_eur,a.new_rate_eur,a.delta_eur
 from public.rate_change_audit a
 join public.profiles p on p.id=a.performed_by
 join public.revenue_rate_push_runs r on r.id::text=a.payload->>'push_run_id'
   and r.hotel_id=a.hotel_id and r.organization_slug=a.organization_slug
 where a.organization_slug='rdhotels'
 and a.hotel_id in ('gozsdu-court','mika-downtown','memories-budapest')
 and p.organization_slug='rdhotels' and lower(btrim(p.full_name))='ricsi' and p.deleted_at is null
 and a.source in ('previo_confirmed','previo_bulk_confirmed')
 and a.payload->>'confirmation_status'='confirmed'
 and a.payload->>'actual_previo_price'=a.payload->>'requested_price'
 and a.performed_at>=now()-interval '7 days'
 and coalesce(r.started_at,r.created_at)>=now()-interval '7 days'
 and a.stay_date between (now() at time zone 'Europe/Budapest')::date
   and (now() at time zone 'Europe/Budapest')::date+120
 and a.old_rate_eur>0 and a.new_rate_eur>0 and a.delta_eur<>0
 order by a.hotel_id,a.stay_date,a.payload->>'push_run_id',
   a.payload->>'room_type_name',a.payload->>'occupancy',a.performed_at desc,a.id
), moves as materialized (
 select hotel_id,stay_date,run_key,max(action_at) action_at,count(*) cells,
 round((percentile_cont(.5) within group(order by delta_eur))::numeric,2) delta,
 round((percentile_cont(.5) within group(order by 100*delta_eur/old_rate_eur))::numeric,2) pct,
 case when bool_and(delta_eur>0) then 'increase'
      when bool_and(delta_eur<0) then 'decrease' else 'mixed' end direction
 from confirmed_cells group by hotel_id,stay_date,run_key
), latest as materialized (
 select distinct on(hotel_id,stay_date) * from moves order by hotel_id,stay_date,action_at desc,run_key
), operating as materialized (
 select distinct prm.pms_room_id from public.pms_room_mappings prm
 join public.pms_configurations pc on pc.id=prm.pms_config_id
 join public.rooms r on r.hotel=pc.hotel_id and r.room_number=prm.hotelcare_room_number
 where pc.hotel_id='gozsdu-court' and prm.is_active is distinct from false
 and r.pms_metadata->'gozsduAvailability'->>'status'='operating'
), gozsdu_capacity as (
 select count(*)::numeric capacity from public.rooms
 where hotel='gozsdu-court' and pms_metadata->'gozsduAvailability'->>'status'='operating'
), facts as (
 select l.stay_date,jsonb_build_object(
   'hotel',l.hotel_id,'at',l.action_at,'age_h',round((extract(epoch from now()-l.action_at)/3600)::numeric,1),
   'direction',l.direction,'delta',l.delta,'pct',l.pct,'cells',l.cells,'confirmed',true,
   'previous_direction',(select m.direction from moves m where m.hotel_id=l.hotel_id
     and m.stay_date=l.stay_date and m.action_at<l.action_at order by m.action_at desc limit 1),
   'occ',case when l.hotel_id='gozsdu-court' then round(100*b.sold/nullif(g.capacity,0),1) else s.occupancy_pct end,
   'adr',case when l.hotel_id='gozsdu-court' then round(b.revenue/nullif(b.sold,0),2) else s.adr_eur end,
   'snapshot_age_h',round((extract(epoch from now()-s.captured_at)/3600)::numeric,1),
   'pickup_48h',b.pickup_48h,
   'offer',o.price,'offer_age_h',round((extract(epoch from now()-o.captured_at)/3600)::numeric,1)
 ) fact
 from latest l cross join gozsdu_capacity g
 left join lateral(select occupancy_pct,adr_eur,captured_at from public.revenue_daily_snapshots s
   where s.hotel_id=l.hotel_id and s.organization_slug='rdhotels' and s.stay_date=l.stay_date
   order by captured_at desc limit 1) s on true
 left join lateral(
   select count(*)::numeric sold,sum(n.nightly_price_eur) revenue,
     count(distinct(n.res_id,n.room_key)) filter(where n.created_at_pms>=now()-interval '48 hours') pickup_48h
   from public.revenue_booking_nights n where n.hotel_id=l.hotel_id
   and n.organization_slug='rdhotels' and n.stay_date=l.stay_date
   and not(coalesce(btrim(n.source_name),'')='' and coalesce(n.stay_to-n.stay_from,0)>366)
   and (l.hotel_id<>'gozsdu-court' or exists(select 1 from operating x where x.pms_room_id=n.obj_id))
 ) b on true
 left join lateral(
   select min(n.price) price,min(n.captured_at) captured_at from public.revenue_room_type_rates n
   join public.previo_rate_plan_mapping m on m.hotel_id=n.hotel_id
     and m.previo_room_type_id=n.obk_id and m.previo_rate_plan_id=n.rate_plan_id
   left join public.revenue_room_type_availability a on a.hotel_id=n.hotel_id
     and a.stay_date=n.stay_date and a.obk_id=n.obk_id
   where n.hotel_id=l.hotel_id and n.organization_slug='rdhotels' and n.stay_date=l.stay_date
   and n.occupancy=2 and n.price>0 and n.currency='EUR' and coalesce(a.availability,1)>0
 ) o on true
), grouped as (
 select stay_date,jsonb_agg(fact order by fact->>'hotel') peers from facts group by stay_date
)
select jsonb_build_object('as_of',now(),'dates',coalesce((select jsonb_agg(
 jsonb_build_object('date',stay_date,'peers',peers) order by stay_date) from grouped),'[]'::jsonb))
$fn$;
revoke all on function public.ottofiori_peer_context() from public,anon,authenticated;
grant execute on function public.ottofiori_peer_context() to service_role;
