-- Gozsdu-only Laundryner operational duty. No global user_role enum, profile,
-- existing assignment, PMS, or another property's data is modified by migration.
create table if not exists public.gozsdu_laundry_duties (
  organization_slug text not null,
  hotel_id text not null default 'gozsdu-court' check (hotel_id = 'gozsdu-court'),
  work_date date not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  assigned_by uuid not null references public.profiles(id),
  assigned_at timestamptz not null default now(),
  primary key (organization_slug, hotel_id, work_date, user_id)
);
create index if not exists gozsdu_laundry_duties_user_date
  on public.gozsdu_laundry_duties (user_id, work_date desc);
alter table public.gozsdu_laundry_duties enable row level security;
revoke all on public.gozsdu_laundry_duties from anon, authenticated;
grant select on public.gozsdu_laundry_duties to authenticated;

-- A Laundryner is deliberately still an ordinary housekeeper for HR/attendance.
-- This scoped duty has no organization-wide or manager permissions.
create policy "Gozsdu duty: own and property managers read"
  on public.gozsdu_laundry_duties for select to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.organization_slug = gozsdu_laundry_duties.organization_slug
      and p.assigned_hotel in ('gozsdu-court', 'Gozsdu Court Budapest')
      and (p.id = gozsdu_laundry_duties.user_id or p.role::text in
        ('manager', 'housekeeping_manager', 'admin', 'top_management', 'top_management_manager'))
  ));

create table if not exists public.gozsdu_laundry_room_progress (
  organization_slug text not null,
  hotel_id text not null default 'gozsdu-court' check (hotel_id = 'gozsdu-court'),
  work_date date not null,
  user_id uuid not null references public.profiles(id),
  room_id uuid not null references public.rooms(id),
  status text not null check (status in ('collected', 'nothing_to_collect', 'could_not_access')),
  reason text,
  updated_at timestamptz not null default now(),
  primary key (organization_slug, hotel_id, work_date, user_id, room_id),
  constraint gozsdu_laundry_progress_reason check
    (status <> 'could_not_access' or nullif(btrim(reason), '') is not null)
);
create index if not exists gozsdu_laundry_progress_date
  on public.gozsdu_laundry_room_progress (organization_slug, work_date, room_id);
alter table public.gozsdu_laundry_room_progress enable row level security;
revoke all on public.gozsdu_laundry_room_progress from anon, authenticated;
grant select on public.gozsdu_laundry_room_progress to authenticated;
create policy "Gozsdu collection: own and property managers read"
  on public.gozsdu_laundry_room_progress for select to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.organization_slug = gozsdu_laundry_room_progress.organization_slug
      and p.assigned_hotel in ('gozsdu-court', 'Gozsdu Court Budapest')
      and (p.id = gozsdu_laundry_room_progress.user_id or p.role::text in
        ('manager', 'housekeeping_manager', 'admin', 'top_management', 'top_management_manager'))
  ));

-- Both manager duty changes and all assignment paths lock the same staff/date
-- key. This avoids a race between checking 'has work' and assigning new work.
create or replace function public.gozsdu_laundry_lock(p_user uuid, p_date date)
returns void language plpgsql security invoker set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtext('gozsdu-laundry'), hashtext(p_user::text || ':' || p_date::text));
end; $$;
revoke execute on function public.gozsdu_laundry_lock(uuid,date) from public, anon, authenticated;

create or replace function public.set_gozsdu_laundry_duty(
  p_user_id uuid, p_work_date date, p_enabled boolean
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_actor public.profiles%rowtype;
  v_staff public.profiles%rowtype;
  v_today date := (now() at time zone 'Europe/Budapest')::date;
begin
  select * into v_actor from public.profiles where id = auth.uid();
  select * into v_staff from public.profiles where id = p_user_id;
  if v_actor.id is null or v_actor.role::text not in
      ('manager','housekeeping_manager','admin','top_management','top_management_manager')
    or v_actor.assigned_hotel not in ('gozsdu-court','Gozsdu Court Budapest')
    or v_staff.id is null or v_staff.organization_slug is distinct from v_actor.organization_slug
    or v_staff.assigned_hotel not in ('gozsdu-court','Gozsdu Court Budapest')
    or not (v_staff.role::text = 'housekeeping' or coalesce(v_staff.acts_as_housekeeper, false))
    or p_work_date is null or p_work_date < v_today or p_work_date > v_today + 30
    or p_enabled is null then
    raise exception 'Unauthorized or invalid Gozsdu Laundryner duty' using errcode = '42501';
  end if;
  perform public.gozsdu_laundry_lock(p_user_id, p_work_date);
  if p_enabled then
    -- No implicit cancellation of active, started, completed or tomorrow-planned
    -- cleaning work. Manager must clear it using the existing workflow first.
    if exists (
      select 1 from public.room_assignments a join public.rooms r on r.id = a.room_id
       where a.assigned_to = p_user_id and a.assignment_date = p_work_date
         and r.hotel in ('gozsdu-court','Gozsdu Court Budapest')
    ) or exists (
      select 1 from public.general_tasks t
       where t.assigned_to = p_user_id and t.assigned_date = p_work_date
         and t.hotel in ('gozsdu-court','Gozsdu Court Budapest')
         and t.status <> 'cancelled'
    ) or exists (
      select 1 from public.next_day_housekeeping_plan_items i
        join public.next_day_housekeeping_plans p on p.id = i.plan_id
       where i.assigned_to = p_user_id and p.plan_date = p_work_date
         and p.hotel_id = 'gozsdu-court' and p.organization_slug = v_actor.organization_slug
         and p.status not in ('cancelled','failed')
    ) or exists (
      select 1 from public.next_day_housekeeping_plan_area_tasks a
        join public.next_day_housekeeping_plans p on p.id = a.plan_id
       where a.assigned_to = p_user_id and p.plan_date = p_work_date
         and p.hotel_id = 'gozsdu-court' and p.organization_slug = v_actor.organization_slug
         and p.status not in ('cancelled','failed')
    ) then
      raise exception 'Resolve existing cleaning or area assignments before selecting Laundryner';
    end if;
    insert into public.gozsdu_laundry_duties (organization_slug,hotel_id,work_date,user_id,assigned_by)
    values (v_actor.organization_slug,'gozsdu-court',p_work_date,p_user_id,v_actor.id)
    on conflict (organization_slug,hotel_id,work_date,user_id) do nothing;
  else
    delete from public.gozsdu_laundry_duties
    where organization_slug = v_actor.organization_slug and hotel_id = 'gozsdu-court'
      and work_date = p_work_date and user_id = p_user_id;
  end if;
end; $$;
revoke execute on function public.set_gozsdu_laundry_duty(uuid,date,boolean) from public, anon;
grant execute on function public.set_gozsdu_laundry_duty(uuid,date,boolean) to authenticated;

create or replace function public.gozsdu_laundry_block_cleaning_assignment()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_date date;
  v_hotel text;
  v_org text;
begin
  if tg_table_name = 'room_assignments' then
    select hotel into v_hotel from public.rooms where id = new.room_id;
    v_date := new.assignment_date;
  elsif tg_table_name = 'general_tasks' then
    v_hotel := new.hotel;
    v_date := new.assigned_date;
  elsif tg_table_name = 'next_day_housekeeping_plan_items'
    or tg_table_name = 'next_day_housekeeping_plan_area_tasks' then
    select hotel_id, plan_date, organization_slug into v_hotel, v_date, v_org
    from public.next_day_housekeeping_plans where id = new.plan_id;
  end if;
  if new.assigned_to is null or v_hotel not in ('gozsdu-court','Gozsdu Court Budapest') then
    return new;
  end if;
  perform public.gozsdu_laundry_lock(new.assigned_to, v_date);
  if exists (
    select 1 from public.gozsdu_laundry_duties d
    where d.user_id = new.assigned_to and d.work_date = v_date and d.hotel_id = 'gozsdu-court'
      and (v_org is null or d.organization_slug = v_org)
  ) then
    raise exception 'This employee is Laundryner on %, and cannot receive cleaning or area assignments', v_date;
  end if;
  return new;
end; $$;
revoke execute on function public.gozsdu_laundry_block_cleaning_assignment() from public, anon, authenticated;
drop trigger if exists gozsdu_laundry_no_room_assignments on public.room_assignments;
create trigger gozsdu_laundry_no_room_assignments before insert or update of assigned_to,room_id,assignment_date
on public.room_assignments for each row execute function public.gozsdu_laundry_block_cleaning_assignment();
drop trigger if exists gozsdu_laundry_no_general_tasks on public.general_tasks;
create trigger gozsdu_laundry_no_general_tasks before insert or update of assigned_to,hotel,assigned_date
on public.general_tasks for each row execute function public.gozsdu_laundry_block_cleaning_assignment();
drop trigger if exists gozsdu_laundry_no_next_day_rooms on public.next_day_housekeeping_plan_items;
create trigger gozsdu_laundry_no_next_day_rooms before insert or update of assigned_to,plan_id
on public.next_day_housekeeping_plan_items for each row execute function public.gozsdu_laundry_block_cleaning_assignment();
drop trigger if exists gozsdu_laundry_no_next_day_areas on public.next_day_housekeeping_plan_area_tasks;
create trigger gozsdu_laundry_no_next_day_areas before insert or update of assigned_to,plan_id
on public.next_day_housekeeping_plan_area_tasks for each row execute function public.gozsdu_laundry_block_cleaning_assignment();

-- One atomic collector action updates the *existing* linen source of truth and
-- the separate collection progress; the existing dirty-linen audit trigger
-- supplies immutable item-level history and existing manager realtime remains.
create or replace function public.record_gozsdu_laundry_collection(
  p_room_id uuid, p_status text, p_counts jsonb default '[]'::jsonb,
  p_reason text default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_actor public.profiles%rowtype;
  v_room public.rooms%rowtype;
  v_date date := (now() at time zone 'Europe/Budapest')::date;
  v_item jsonb;
  v_linen_id uuid;
  v_count integer;
  v_seen uuid[] := array[]::uuid[];
  v_total integer := 0;
begin
  select * into v_actor from public.profiles where id = auth.uid();
  select * into v_room from public.rooms where id = p_room_id;
  if v_actor.id is null or v_actor.assigned_hotel not in ('gozsdu-court','Gozsdu Court Budapest')
    or v_room.id is null or v_room.hotel not in ('gozsdu-court','Gozsdu Court Budapest')
    or v_room.status = 'out_of_order' or v_room.pms_metadata->'gozsduAvailability'->>'status' is distinct from 'operating'
    or v_room.pms_metadata->>'isNoShow' = 'true'
    or not exists (select 1 from public.gozsdu_laundry_duties d
      where d.user_id = v_actor.id and d.work_date = v_date and d.organization_slug = v_actor.organization_slug)
    or p_status not in ('collected','nothing_to_collect','could_not_access')
    or p_counts is null or jsonb_typeof(p_counts) <> 'array' or jsonb_array_length(p_counts) > 100 then
    raise exception 'Unauthorized or invalid Gozsdu laundry collection' using errcode = '42501';
  end if;
  if v_room.is_dnd and p_status <> 'could_not_access' then
    raise exception 'DND: room access must be resolved before collecting linen';
  end if;
  if p_status = 'could_not_access' and nullif(btrim(p_reason), '') is null then
    raise exception 'Please provide a no-access reason';
  end if;
  if p_status = 'could_not_access' and jsonb_array_length(p_counts) <> 0 then
    raise exception 'No-access cannot change linen counts';
  end if;
  perform pg_advisory_xact_lock(hashtext(v_actor.id::text), hashtext(p_room_id::text || ':' || v_date::text));
  for v_item in select value from jsonb_array_elements(p_counts) loop
    if jsonb_typeof(v_item) <> 'object' or not (v_item ? 'linen_item_id')
      or not (v_item ? 'count') or (v_item->>'count') !~ '^[0-9]{1,4}$' then
      raise exception 'Invalid linen item/count';
    end if;
    v_linen_id := (v_item->>'linen_item_id')::uuid;
    v_count := (v_item->>'count')::integer;
    if v_count > 1000 or v_linen_id = any(v_seen)
      or not exists (select 1 from public.dirty_linen_items where id = v_linen_id and is_active = true) then
      raise exception 'Duplicate, excessive, or inactive linen item';
    end if;
    v_seen := array_append(v_seen,v_linen_id);
    v_total := v_total + v_count;
  end loop;
  if p_status = 'collected' and v_total = 0 then
    raise exception 'Enter collected linen quantities before marking collected';
  end if;
  if p_status = 'nothing_to_collect' and v_total <> 0 then
    raise exception 'Nothing to collect cannot contain positive quantities';
  end if;
  if p_status <> 'could_not_access' then
    -- Zero entries are deliberate corrections. Counts are absolute and the
    -- existing unique key makes retries idempotent instead of additive.
    for v_item in select value from jsonb_array_elements(p_counts) loop
      v_linen_id := (v_item->>'linen_item_id')::uuid;
      v_count := (v_item->>'count')::integer;
      if v_count = 0 then
        delete from public.dirty_linen_counts
         where housekeeper_id = v_actor.id and room_id = p_room_id
           and linen_item_id = v_linen_id and work_date = v_date;
      else
        insert into public.dirty_linen_counts
          (housekeeper_id,room_id,assignment_id,linen_item_id,count,work_date,organization_slug)
        values (v_actor.id,p_room_id,null,v_linen_id,v_count,v_date,v_actor.organization_slug)
        on conflict (housekeeper_id,room_id,linen_item_id,work_date)
        do update set count = excluded.count;
      end if;
    end loop;
    if p_status = 'nothing_to_collect' and exists (
      select 1 from public.dirty_linen_counts
      where housekeeper_id = v_actor.id and room_id = p_room_id and work_date = v_date and count > 0
    ) then
      raise exception 'Clear recorded quantities before marking nothing to collect';
    end if;
  end if;
  insert into public.gozsdu_laundry_room_progress
    (organization_slug,hotel_id,work_date,user_id,room_id,status,reason,updated_at)
  values (v_actor.organization_slug,'gozsdu-court',v_date,v_actor.id,p_room_id,
    p_status,case when p_status='could_not_access' then btrim(p_reason) else null end,now())
  on conflict (organization_slug,hotel_id,work_date,user_id,room_id)
  do update set status=excluded.status,reason=excluded.reason,updated_at=now();
end; $$;
revoke execute on function public.record_gozsdu_laundry_collection(uuid,text,jsonb,text) from public, anon;
grant execute on function public.record_gozsdu_laundry_collection(uuid,text,jsonb,text) to authenticated;
