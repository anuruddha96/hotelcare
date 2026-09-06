create table if not exists public.housekeeping_room_snapshots (
  id uuid primary key default gen_random_uuid(),
  business_date date not null,
  room_id uuid not null references public.rooms(id) on delete cascade,
  hotel text not null,
  organization_slug text,
  room_number text not null,
  floor_number integer,
  venue_id uuid,
  room_size_sqm integer,
  bed_type text,
  bed_configuration text,
  room_status text,
  is_checkout_room boolean,
  is_dnd boolean not null default false,
  towel_change_required boolean not null default false,
  linen_change_required boolean not null default false,
  room_notes text,
  pms_metadata jsonb,
  guest_nights_stayed integer,
  last_cleaned_at timestamptz,
  last_towel_change date,
  last_linen_change date,
  had_dnd boolean not null default false,
  had_towel_change boolean not null default false,
  had_linen_change boolean not null default false,
  had_room_cleaning_request boolean not null default false,
  had_extra_towels_request boolean not null default false,
  had_ready_to_clean boolean not null default false,
  had_no_service boolean not null default false,
  assignment_id uuid,
  assigned_to uuid,
  assignment_type text,
  assignment_status text,
  assignment_started_at timestamptz,
  assignment_completed_at timestamptz,
  supervisor_approved boolean,
  ready_to_clean boolean,
  pms_hold boolean,
  assignment_notes text,
  dnd_attempt_count smallint,
  status_history jsonb not null default '[]'::jsonb,
  source text not null default 'live_capture',
  captured_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint housekeeping_room_snapshots_date_room_key unique (business_date, room_id)
);
create index if not exists idx_housekeeping_room_snapshots_hotel_date on public.housekeeping_room_snapshots (hotel,business_date);
create index if not exists idx_housekeeping_room_snapshots_org_date on public.housekeeping_room_snapshots (organization_slug,business_date);
create index if not exists idx_housekeeping_room_snapshots_room_date on public.housekeeping_room_snapshots (room_id,business_date desc);
alter table public.housekeeping_room_snapshots enable row level security;
drop policy if exists "Authorized hotel staff can view housekeeping history" on public.housekeeping_room_snapshots;
create policy "Authorized hotel staff can view housekeeping history" on public.housekeeping_room_snapshots for select to authenticated using (
  is_super_admin(auth.uid()) or (
    (organization_slug is null or organization_slug=get_user_organization_slug(auth.uid()))
    and get_user_role(auth.uid())=any(array['admin'::user_role,'top_management'::user_role,'top_management_manager'::user_role,'manager'::user_role,'housekeeping_manager'::user_role,'supervisor'::user_role,'reception'::user_role,'front_office'::user_role])
    and (
      get_user_role(auth.uid())=any(array['admin'::user_role,'top_management'::user_role,'top_management_manager'::user_role])
      or exists(
        select 1 from public.profiles p
        left join public.hotel_configurations hc on p.assigned_hotel=hc.hotel_id or p.assigned_hotel=hc.hotel_name
        where p.id=auth.uid() and (p.assigned_hotel=housekeeping_room_snapshots.hotel or hc.hotel_id=housekeeping_room_snapshots.hotel or hc.hotel_name=housekeeping_room_snapshots.hotel)
      )
    )
  )
);

create or replace function public.capture_housekeeping_room_snapshot(p_room_id uuid,p_business_date date,p_include_room_state boolean default true)
returns void language plpgsql security definer set search_path=public as $$
declare
  r public.rooms%rowtype;
  a public.room_assignments%rowtype;
  v_date date:=coalesce(p_business_date,(now() at time zone 'Europe/Budapest')::date);
  v_has_assignment boolean:=false;
  v_dnd boolean:=false;
  v_clean_request boolean:=false;
  v_extra_towels boolean:=false;
  v_no_service boolean:=false;
  v_event jsonb;
begin
  select * into r from public.rooms where id=p_room_id;
  if not found then return; end if;
  select * into a from public.room_assignments ra where ra.room_id=p_room_id and ra.assignment_date=v_date
  order by case when ra.status::text='completed' and coalesce(ra.supervisor_approved,false) then 5 when ra.status::text='completed' then 4 when ra.status::text='in_progress' then 3 when ra.status::text='dnd_pending_retry' then 2 else 1 end desc,ra.updated_at desc limit 1;
  v_has_assignment:=found;
  v_dnd:=coalesce(case when v_has_assignment then a.is_dnd else null end,r.is_dnd,false)
    or (v_has_assignment and coalesce(a.dnd_attempt_count,0)>0)
    or (v_has_assignment and a.status::text='dnd_pending_retry');
  v_clean_request:=position('[ROOM_CLEANING]' in coalesce(r.notes,''))>0 or (v_has_assignment and position('[GREEN_BOARD_CLEAN_REQUEST]' in coalesce(a.notes,''))>0);
  v_extra_towels:=position('[COLLECT_EXTRA_TOWELS]' in coalesce(r.notes,''))>0;
  v_no_service:=v_has_assignment and position('[NO_SERVICE]' in coalesce(a.notes,''))>0;
  v_event:=jsonb_strip_nulls(jsonb_build_object('at',now(),'room_status',case when p_include_room_state then r.status else null end,'assignment_status',case when v_has_assignment then a.status::text else null end,'is_dnd',v_dnd,'towel_change',case when p_include_room_state then coalesce(r.towel_change_required,false) else null end,'linen_change',case when p_include_room_state then coalesce(r.linen_change_required,false) else null end,'clean_request',v_clean_request,'ready_to_clean',case when v_has_assignment then a.ready_to_clean else null end,'approved',case when v_has_assignment then a.supervisor_approved else null end));
  insert into public.housekeeping_room_snapshots(
    business_date,room_id,hotel,organization_slug,room_number,floor_number,venue_id,room_size_sqm,bed_type,bed_configuration,
    room_status,is_checkout_room,is_dnd,towel_change_required,linen_change_required,room_notes,pms_metadata,guest_nights_stayed,last_cleaned_at,last_towel_change,last_linen_change,
    had_dnd,had_towel_change,had_linen_change,had_room_cleaning_request,had_extra_towels_request,had_ready_to_clean,had_no_service,
    assignment_id,assigned_to,assignment_type,assignment_status,assignment_started_at,assignment_completed_at,supervisor_approved,ready_to_clean,pms_hold,assignment_notes,dnd_attempt_count,status_history,source,captured_at,updated_at
  ) values(
    v_date,r.id,r.hotel,coalesce(r.organization_slug,case when v_has_assignment then a.organization_slug else null end),r.room_number,r.floor_number,r.venue_id,r.room_size_sqm,r.bed_type,r.bed_configuration,
    case when p_include_room_state then r.status else null end,
    case when p_include_room_state then r.is_checkout_room else (case when v_has_assignment then a.assignment_type::text='checkout_cleaning' else null end) end,
    v_dnd,case when p_include_room_state then coalesce(r.towel_change_required,false) else false end,case when p_include_room_state then coalesce(r.linen_change_required,false) else false end,
    case when p_include_room_state then r.notes else null end,case when p_include_room_state then r.pms_metadata else null end,case when p_include_room_state then r.guest_nights_stayed else null end,case when p_include_room_state then r.last_cleaned_at else null end,case when p_include_room_state then r.last_towel_change else null end,case when p_include_room_state then r.last_linen_change else null end,
    v_dnd,p_include_room_state and coalesce(r.towel_change_required,false),p_include_room_state and coalesce(r.linen_change_required,false),v_clean_request,v_extra_towels,v_has_assignment and coalesce(a.ready_to_clean,false),v_no_service,
    case when v_has_assignment then a.id else null end,case when v_has_assignment then a.assigned_to else null end,case when v_has_assignment then a.assignment_type::text else null end,case when v_has_assignment then a.status::text else null end,case when v_has_assignment then a.started_at else null end,case when v_has_assignment then a.completed_at else null end,case when v_has_assignment then a.supervisor_approved else null end,case when v_has_assignment then a.ready_to_clean else null end,case when v_has_assignment then a.pms_hold else null end,case when v_has_assignment then a.notes else null end,case when v_has_assignment then a.dnd_attempt_count else null end,
    jsonb_build_array(v_event),case when p_include_room_state then 'live_capture' else 'assignment_capture' end,now(),now()
  ) on conflict(business_date,room_id) do update set
    hotel=excluded.hotel,organization_slug=coalesce(excluded.organization_slug,housekeeping_room_snapshots.organization_slug),room_number=excluded.room_number,floor_number=excluded.floor_number,venue_id=excluded.venue_id,room_size_sqm=excluded.room_size_sqm,bed_type=excluded.bed_type,bed_configuration=excluded.bed_configuration,
    room_status=case when p_include_room_state then excluded.room_status else housekeeping_room_snapshots.room_status end,
    is_checkout_room=case when p_include_room_state then excluded.is_checkout_room when housekeeping_room_snapshots.is_checkout_room is null then excluded.is_checkout_room else housekeeping_room_snapshots.is_checkout_room end,
    is_dnd=excluded.is_dnd,
    towel_change_required=case when p_include_room_state then excluded.towel_change_required else housekeeping_room_snapshots.towel_change_required end,
    linen_change_required=case when p_include_room_state then excluded.linen_change_required else housekeeping_room_snapshots.linen_change_required end,
    room_notes=case when p_include_room_state then excluded.room_notes else housekeeping_room_snapshots.room_notes end,
    pms_metadata=case when p_include_room_state then excluded.pms_metadata else housekeeping_room_snapshots.pms_metadata end,
    guest_nights_stayed=case when p_include_room_state then excluded.guest_nights_stayed else housekeeping_room_snapshots.guest_nights_stayed end,
    last_cleaned_at=case when p_include_room_state then excluded.last_cleaned_at else housekeeping_room_snapshots.last_cleaned_at end,
    last_towel_change=case when p_include_room_state then excluded.last_towel_change else housekeeping_room_snapshots.last_towel_change end,
    last_linen_change=case when p_include_room_state then excluded.last_linen_change else housekeeping_room_snapshots.last_linen_change end,
    had_dnd=housekeeping_room_snapshots.had_dnd or excluded.had_dnd,
    had_towel_change=housekeeping_room_snapshots.had_towel_change or (p_include_room_state and excluded.had_towel_change),
    had_linen_change=housekeeping_room_snapshots.had_linen_change or (p_include_room_state and excluded.had_linen_change),
    had_room_cleaning_request=housekeeping_room_snapshots.had_room_cleaning_request or excluded.had_room_cleaning_request,
    had_extra_towels_request=housekeeping_room_snapshots.had_extra_towels_request or excluded.had_extra_towels_request,
    had_ready_to_clean=housekeeping_room_snapshots.had_ready_to_clean or excluded.had_ready_to_clean,
    had_no_service=housekeeping_room_snapshots.had_no_service or excluded.had_no_service,
    assignment_id=excluded.assignment_id,assigned_to=excluded.assigned_to,assignment_type=excluded.assignment_type,assignment_status=excluded.assignment_status,assignment_started_at=excluded.assignment_started_at,assignment_completed_at=excluded.assignment_completed_at,supervisor_approved=excluded.supervisor_approved,ready_to_clean=excluded.ready_to_clean,pms_hold=excluded.pms_hold,assignment_notes=excluded.assignment_notes,dnd_attempt_count=excluded.dnd_attempt_count,
    status_history=case when (p_include_room_state and (excluded.room_status is distinct from housekeeping_room_snapshots.room_status or excluded.towel_change_required is distinct from housekeeping_room_snapshots.towel_change_required or excluded.linen_change_required is distinct from housekeeping_room_snapshots.linen_change_required or excluded.room_notes is distinct from housekeeping_room_snapshots.room_notes)) or excluded.assignment_status is distinct from housekeeping_room_snapshots.assignment_status or excluded.is_dnd is distinct from housekeeping_room_snapshots.is_dnd or excluded.ready_to_clean is distinct from housekeeping_room_snapshots.ready_to_clean or excluded.supervisor_approved is distinct from housekeeping_room_snapshots.supervisor_approved or excluded.assignment_notes is distinct from housekeeping_room_snapshots.assignment_notes then housekeeping_room_snapshots.status_history||jsonb_build_array(v_event) else housekeeping_room_snapshots.status_history end,
    source=case when p_include_room_state then 'live_capture' when housekeeping_room_snapshots.source='live_capture' then housekeeping_room_snapshots.source else 'assignment_capture' end,updated_at=now();
end;$$;

create or replace function public.capture_all_housekeeping_rooms_for_date(p_business_date date default ((now() at time zone 'Europe/Budapest')::date)) returns integer language plpgsql security definer set search_path=public as $$
declare r record; v_count integer:=0;
begin for r in select id from public.rooms loop perform public.capture_housekeeping_room_snapshot(r.id,p_business_date,true); v_count:=v_count+1; end loop; return v_count; end;$$;
create or replace function public.trg_capture_housekeeping_room_history() returns trigger language plpgsql security definer set search_path=public as $$ begin perform public.capture_housekeeping_room_snapshot(new.id,(now() at time zone 'Europe/Budapest')::date,true); return new; end; $$;
drop trigger if exists trg_rooms_capture_housekeeping_history on public.rooms;
create trigger trg_rooms_capture_housekeeping_history after insert or update on public.rooms for each row execute function public.trg_capture_housekeeping_room_history();
create or replace function public.trg_capture_housekeeping_assignment_history() returns trigger language plpgsql security definer set search_path=public as $$
declare v_room_id uuid; v_date date;
begin if tg_op='DELETE' then v_room_id:=old.room_id;v_date:=old.assignment_date;else v_room_id:=new.room_id;v_date:=new.assignment_date;end if;perform public.capture_housekeeping_room_snapshot(v_room_id,v_date,false);return coalesce(new,old);end;$$;
drop trigger if exists trg_assignments_capture_housekeeping_history on public.room_assignments;
create trigger trg_assignments_capture_housekeeping_history after insert or update or delete on public.room_assignments for each row execute function public.trg_capture_housekeeping_assignment_history();

with ranked as (
 select ra.*,row_number() over(partition by ra.assignment_date,ra.room_id order by case when ra.status::text='completed' and coalesce(ra.supervisor_approved,false) then 5 when ra.status::text='completed' then 4 when ra.status::text='in_progress' then 3 when ra.status::text='dnd_pending_retry' then 2 else 1 end desc,ra.updated_at desc) rn
 from public.room_assignments ra where ra.assignment_date <= (now() at time zone 'Europe/Budapest')::date
)
insert into public.housekeeping_room_snapshots(business_date,room_id,hotel,organization_slug,room_number,floor_number,venue_id,room_size_sqm,bed_type,bed_configuration,room_status,is_checkout_room,is_dnd,had_dnd,had_room_cleaning_request,had_ready_to_clean,had_no_service,assignment_id,assigned_to,assignment_type,assignment_status,assignment_started_at,assignment_completed_at,supervisor_approved,ready_to_clean,pms_hold,assignment_notes,dnd_attempt_count,status_history,source,captured_at,updated_at)
select a.assignment_date,r.id,r.hotel,coalesce(a.organization_slug,r.organization_slug),r.room_number,r.floor_number,r.venue_id,r.room_size_sqm,r.bed_type,r.bed_configuration,case when a.status::text='in_progress' then 'in_progress' when a.status::text='completed' then 'clean' else 'dirty' end,a.assignment_type::text='checkout_cleaning',coalesce(a.is_dnd,false) or coalesce(a.dnd_attempt_count,0)>0 or a.status::text='dnd_pending_retry',coalesce(a.is_dnd,false) or coalesce(a.dnd_attempt_count,0)>0 or a.status::text='dnd_pending_retry',position('[GREEN_BOARD_CLEAN_REQUEST]' in coalesce(a.notes,''))>0,coalesce(a.ready_to_clean,false),position('[NO_SERVICE]' in coalesce(a.notes,''))>0,a.id,a.assigned_to,a.assignment_type::text,a.status::text,a.started_at,a.completed_at,a.supervisor_approved,a.ready_to_clean,a.pms_hold,a.notes,a.dnd_attempt_count,jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('at',coalesce(a.updated_at,a.created_at),'assignment_status',a.status::text,'is_dnd',coalesce(a.is_dnd,false) or coalesce(a.dnd_attempt_count,0)>0 or a.status::text='dnd_pending_retry','clean_request',position('[GREEN_BOARD_CLEAN_REQUEST]' in coalesce(a.notes,''))>0,'ready_to_clean',a.ready_to_clean,'approved',a.supervisor_approved))),'reconstructed_assignment',coalesce(a.updated_at,a.created_at),now()
from ranked a join public.rooms r on r.id=a.room_id where a.rn=1 on conflict(business_date,room_id) do nothing;
select public.capture_all_housekeeping_rooms_for_date((now() at time zone 'Europe/Budapest')::date);
grant select on public.housekeeping_room_snapshots to authenticated;
revoke insert,update,delete on public.housekeeping_room_snapshots from authenticated;
grant execute on function public.capture_housekeeping_room_snapshot(uuid,date,boolean) to service_role;
grant execute on function public.capture_all_housekeeping_rooms_for_date(date) to service_role;
