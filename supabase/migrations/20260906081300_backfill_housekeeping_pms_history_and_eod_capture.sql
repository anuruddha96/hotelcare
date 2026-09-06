with latest_pms as (
  select distinct on (hotel_id,business_date,coalesce(room_number,room_label))
    hotel_id,business_date,room_number,room_label,arrival_date,departure_date,status,captured_at
  from public.daily_overview_snapshots
  where business_date <= (now() at time zone 'Europe/Budapest')::date
    and coalesce(room_number,room_label) is not null
  order by hotel_id,business_date,coalesce(room_number,room_label),captured_at desc
), matched as (
  select s.*,r.id matched_room_id,r.hotel matched_hotel,r.organization_slug matched_org,
    r.room_number matched_room_number,r.floor_number,r.venue_id,r.room_size_sqm,r.bed_type,r.bed_configuration,
    row_number() over(
      partition by s.hotel_id,s.business_date,coalesce(s.room_number,s.room_label)
      order by case when r.hotel=s.hotel_id then 0 else 1 end,r.updated_at desc
    ) room_rank
  from latest_pms s
  left join public.hotel_configurations hc on hc.hotel_id=s.hotel_id
  join public.rooms r on (r.hotel=s.hotel_id or r.hotel=hc.hotel_name)
   and (
     lower(trim(r.room_number))=lower(trim(coalesce(s.room_number,s.room_label)))
     or nullif(ltrim(regexp_replace(r.room_number,'[^0-9]','','g'),'0'),'')=nullif(ltrim(regexp_replace(coalesce(s.room_number,s.room_label),'[^0-9]','','g'),'0'),'')
   )
), normalized as (
  select m.*,
    (coalesce(m.departure_date=m.business_date,false) or lower(coalesce(m.status,''))='departing') pms_checkout,
    case when m.arrival_date is not null and m.business_date>=m.arrival_date then (m.business_date-m.arrival_date)+1 else null end current_night
  from matched m where m.room_rank=1
), dedup as (
  select n.*,
    row_number() over(partition by n.business_date,n.matched_room_id order by n.captured_at desc) final_rank
  from normalized n
)
insert into public.housekeeping_room_snapshots(
  business_date,room_id,hotel,organization_slug,room_number,floor_number,venue_id,room_size_sqm,bed_type,bed_configuration,
  is_checkout_room,towel_change_required,linen_change_required,had_towel_change,had_linen_change,pms_metadata,
  status_history,source,captured_at,updated_at
)
select d.business_date,d.matched_room_id,d.matched_hotel,d.matched_org,d.matched_room_number,d.floor_number,d.venue_id,d.room_size_sqm,d.bed_type,d.bed_configuration,
  d.pms_checkout,
  coalesce((not d.pms_checkout and d.current_night>=3 and mod(d.current_night-3,4)=0),false),
  coalesce((not d.pms_checkout and d.current_night>=3 and mod(d.current_night-3,4)=2),false),
  coalesce((not d.pms_checkout and d.current_night>=3 and mod(d.current_night-3,4)=0),false),
  coalesce((not d.pms_checkout and d.current_night>=3 and mod(d.current_night-3,4)=2),false),
  jsonb_strip_nulls(jsonb_build_object('arrivalDate',d.arrival_date,'departureDate',d.departure_date,'status',d.status,'currentNight',d.current_night,'archivedCapturedAt',d.captured_at)),
  '[]'::jsonb,'reconstructed_pms',d.captured_at,now()
from dedup d where d.final_rank=1
on conflict(business_date,room_id) do update set
  is_checkout_room=coalesce(housekeeping_room_snapshots.is_checkout_room,excluded.is_checkout_room),
  towel_change_required=housekeeping_room_snapshots.towel_change_required or excluded.towel_change_required,
  linen_change_required=housekeeping_room_snapshots.linen_change_required or excluded.linen_change_required,
  had_towel_change=housekeeping_room_snapshots.had_towel_change or excluded.had_towel_change,
  had_linen_change=housekeeping_room_snapshots.had_linen_change or excluded.had_linen_change,
  pms_metadata=coalesce(housekeeping_room_snapshots.pms_metadata,excluded.pms_metadata),
  source=case
    when housekeeping_room_snapshots.source in ('live_capture','assignment_capture') then housekeeping_room_snapshots.source
    when housekeeping_room_snapshots.source='reconstructed_assignment' then 'reconstructed_assignment+pms'
    else excluded.source
  end,
  updated_at=now();

do $$
begin
  if exists(select 1 from cron.job where jobname='housekeeping_history_eod_2155') then
    perform cron.unschedule((select jobid from cron.job where jobname='housekeeping_history_eod_2155' limit 1));
  end if;
  if exists(select 1 from cron.job where jobname='housekeeping_history_eod_2255') then
    perform cron.unschedule((select jobid from cron.job where jobname='housekeeping_history_eod_2255' limit 1));
  end if;
  perform cron.schedule('housekeeping_history_eod_2155','55 21 * * *',$cron$select public.capture_all_housekeeping_rooms_for_date((now() at time zone 'Europe/Budapest')::date);$cron$);
  perform cron.schedule('housekeeping_history_eod_2255','55 22 * * *',$cron$select public.capture_all_housekeeping_rooms_for_date((now() at time zone 'Europe/Budapest')::date);$cron$);
end;$$;
