-- SLNT Team B: shared-room housekeeping architecture.
--
-- Team B owns a fixed group of SLNT units collectively. Future plans may still
-- be prepared with the existing manager planner, but when an approved plan is
-- released, Team B rooms are converted from provisional individual assignments
-- into a shared queue. A Team B member atomically claims a room; only then do we
-- create the normal room_assignments row. Existing start/finish/photo flows stay
-- authoritative and RD Hotels / Team A are untouched.

create table if not exists public.housekeeping_teams (
  id uuid primary key default gen_random_uuid(),
  organization_slug text not null,
  hotel_id text not null,
  code text not null,
  name text not null,
  assignment_mode text not null default 'individual'
    check (assignment_mode in ('individual', 'shared_claim')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_slug, hotel_id, code)
);

create table if not exists public.housekeeping_team_members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.housekeeping_teams(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  is_active boolean not null default true,
  effective_from date,
  effective_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (team_id, user_id)
);

create table if not exists public.housekeeping_team_rooms (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.housekeeping_teams(id) on delete cascade,
  room_id uuid not null references public.rooms(id) on delete cascade,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (team_id, room_id)
);

create table if not exists public.housekeeping_team_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_slug text not null,
  hotel_id text not null,
  team_id uuid not null references public.housekeeping_teams(id) on delete cascade,
  room_id uuid not null references public.rooms(id) on delete cascade,
  service_date date not null,
  assignment_type public.assignment_type not null,
  priority integer not null default 2,
  estimated_duration integer,
  notes text,
  status text not null default 'queued'
    check (status in ('queued', 'claimed', 'cancelled')),
  source_plan_item_id uuid references public.next_day_housekeeping_plan_items(id) on delete set null,
  planned_candidate_user_id uuid references public.profiles(id) on delete set null,
  claimed_by uuid references public.profiles(id) on delete set null,
  claimed_at timestamptz,
  room_assignment_id uuid references public.room_assignments(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (team_id, service_date, room_id)
);

create index if not exists idx_housekeeping_team_members_user
  on public.housekeeping_team_members(user_id, is_active);
create index if not exists idx_housekeeping_team_rooms_room
  on public.housekeeping_team_rooms(room_id, is_active);
create index if not exists idx_housekeeping_team_tasks_day
  on public.housekeeping_team_tasks(organization_slug, hotel_id, service_date, status);
create index if not exists idx_housekeeping_team_tasks_claimed_by
  on public.housekeeping_team_tasks(claimed_by, service_date);

alter table public.housekeeping_teams enable row level security;
alter table public.housekeeping_team_members enable row level security;
alter table public.housekeeping_team_rooms enable row level security;
alter table public.housekeeping_team_tasks enable row level security;

-- Tenant-safe read policies. Mutations are intentionally performed through the
-- SECURITY DEFINER RPCs below so membership and claim invariants are atomic.
drop policy if exists housekeeping_teams_org_read on public.housekeeping_teams;
create policy housekeeping_teams_org_read on public.housekeeping_teams
for select to authenticated
using (exists (
  select 1 from public.profiles p
  where p.id = auth.uid()
    and p.deleted_at is null
    and p.organization_slug = housekeeping_teams.organization_slug
));

drop policy if exists housekeeping_team_members_org_read on public.housekeeping_team_members;
create policy housekeeping_team_members_org_read on public.housekeeping_team_members
for select to authenticated
using (exists (
  select 1
  from public.housekeeping_teams t
  join public.profiles p on p.id = auth.uid()
  where t.id = housekeeping_team_members.team_id
    and p.deleted_at is null
    and p.organization_slug = t.organization_slug
));

drop policy if exists housekeeping_team_rooms_org_read on public.housekeeping_team_rooms;
create policy housekeeping_team_rooms_org_read on public.housekeeping_team_rooms
for select to authenticated
using (exists (
  select 1
  from public.housekeeping_teams t
  join public.profiles p on p.id = auth.uid()
  where t.id = housekeeping_team_rooms.team_id
    and p.deleted_at is null
    and p.organization_slug = t.organization_slug
));

drop policy if exists housekeeping_team_tasks_scoped_read on public.housekeeping_team_tasks;
create policy housekeeping_team_tasks_scoped_read on public.housekeeping_team_tasks
for select to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.deleted_at is null
      and p.organization_slug = housekeeping_team_tasks.organization_slug
      and p.role::text in ('admin','top_management','top_management_manager','manager','housekeeping_manager','supervisor')
  )
  or exists (
    select 1 from public.housekeeping_team_members m
    where m.team_id = housekeeping_team_tasks.team_id
      and m.user_id = auth.uid()
      and m.is_active
      and (m.effective_from is null or m.effective_from <= housekeeping_team_tasks.service_date)
      and (m.effective_to is null or m.effective_to >= housekeeping_team_tasks.service_date)
  )
);

-- Create Team B without hard-coded generated IDs.
insert into public.housekeeping_teams (
  organization_slug, hotel_id, code, name, assignment_mode, is_active
)
values ('slnt', 'slnt-group', 'team-b', 'Team B', 'shared_claim', true)
on conflict (organization_slug, hotel_id, code)
do update set
  name = excluded.name,
  assignment_mode = excluded.assignment_mode,
  is_active = true,
  updated_at = now();

-- The Excel workbook defines Team B collectively, not one cleaner per room.
-- Map the validated live SLNT room labels to Team B. Staff/login membership is
-- deliberately NOT guessed because production currently uses generic HK 1..HK 6
-- accounts while the workbook contains personal names.
with team_b as (
  select id
  from public.housekeeping_teams
  where organization_slug = 'slnt'
    and hotel_id = 'slnt-group'
    and code = 'team-b'
), mapped_rooms as (
  select r.id
  from public.rooms r
  where r.organization_slug = 'slnt'
    and lower(r.hotel) = 'slnt-group'
    and (
      r.room_number in (
        'Be Local Budapest Apartment',
        'Dorothilux Apartment',
        'Giselle Apartment'
      )
      or r.room_number like 'WR Pension 10%'
      or r.room_number like 'St King 11%'
      or r.room_number like 'K4 – Room %'
      or r.room_number like 'Silver Rooms %'
    )
)
insert into public.housekeeping_team_rooms (team_id, room_id, is_active)
select team_b.id, mapped_rooms.id, true
from team_b cross join mapped_rooms
on conflict (team_id, room_id)
do update set is_active = true, updated_at = now();

-- Fail the migration instead of silently shipping an incomplete or over-broad
-- workbook mapping. The validated Team B workbook covers 46 live SLNT units.
do $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.housekeeping_team_rooms tr
  join public.housekeeping_teams t on t.id = tr.team_id
  where t.organization_slug = 'slnt'
    and t.hotel_id = 'slnt-group'
    and t.code = 'team-b'
    and tr.is_active;

  if v_count <> 46 then
    raise exception 'SLNT Team B room mapping expected 46 rooms but resolved %', v_count;
  end if;
end $$;

create or replace function public.set_slnt_housekeeping_team_members(
  p_team_code text,
  p_user_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team public.housekeeping_teams%rowtype;
  v_bad_count integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into v_team
  from public.housekeeping_teams
  where organization_slug = 'slnt'
    and hotel_id = 'slnt-group'
    and code = p_team_code
    and is_active
  for update;

  if not found then
    raise exception 'SLNT housekeeping team not found';
  end if;

  if not public.can_manage_next_day_housekeeping_plan('slnt', 'slnt-group') then
    raise exception 'Not authorized to configure SLNT housekeeping teams' using errcode = '42501';
  end if;

  select count(*) into v_bad_count
  from unnest(coalesce(p_user_ids, array[]::uuid[])) requested(user_id)
  left join public.profiles p on p.id = requested.user_id
  where p.id is null
     or p.organization_slug <> 'slnt'
     or p.deleted_at is not null
     or not (p.role::text = 'housekeeping' or p.acts_as_housekeeper = true);

  if v_bad_count > 0 then
    raise exception 'One or more selected users are not active SLNT housekeepers';
  end if;

  delete from public.housekeeping_team_members
  where team_id = v_team.id;

  insert into public.housekeeping_team_members (team_id, user_id, is_active)
  select v_team.id, requested.user_id, true
  from unnest(coalesce(p_user_ids, array[]::uuid[])) requested(user_id)
  on conflict (team_id, user_id)
  do update set is_active = true, effective_from = null, effective_to = null, updated_at = now();

  return jsonb_build_object(
    'team_id', v_team.id,
    'team_code', v_team.code,
    'member_count', coalesce(cardinality(p_user_ids), 0)
  );
end;
$$;

-- Convert Team B's just-released individual rows into a shared claim queue.
-- This runs in the same release transaction, before any cleaner can start work.
create or replace function public.materialize_slnt_team_b_queue_after_plan_release()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
  v_queued_count integer := 0;
  v_deleted_count integer := 0;
begin
  if new.organization_slug <> 'slnt'
     or new.status <> 'released'
     or old.status = 'released' then
    return new;
  end if;

  select id into v_team_id
  from public.housekeeping_teams
  where organization_slug = 'slnt'
    and code = 'team-b'
    and assignment_mode = 'shared_claim'
    and is_active
  order by created_at
  limit 1;

  if v_team_id is null then
    return new;
  end if;

  insert into public.housekeeping_team_tasks (
    organization_slug,
    hotel_id,
    team_id,
    room_id,
    service_date,
    assignment_type,
    priority,
    estimated_duration,
    notes,
    status,
    source_plan_item_id,
    planned_candidate_user_id
  )
  select
    new.organization_slug,
    new.hotel_id,
    v_team_id,
    i.room_id,
    new.plan_date,
    i.assignment_type,
    i.priority,
    i.estimated_duration,
    i.notes,
    'queued',
    i.id,
    i.assigned_to
  from public.next_day_housekeeping_plan_items i
  join public.housekeeping_team_rooms tr
    on tr.team_id = v_team_id
   and tr.room_id = i.room_id
   and tr.is_active
  join public.room_assignments ra
    on ra.room_id = i.room_id
   and ra.assigned_to = i.assigned_to
   and ra.assignment_date = new.plan_date
   and ra.assignment_type = i.assignment_type
   and ra.status = 'assigned'::public.assignment_status
   and ra.started_at is null
   and ra.completed_at is null
   and coalesce(array_length(ra.completion_photos, 1), 0) = 0
   and ra.created_at >= coalesce(new.release_attempted_at, now() - interval '10 minutes')
  where i.plan_id = new.id
    and i.id in (
      select value::uuid
      from jsonb_array_elements_text(
        coalesce(new.release_revalidation_result -> 'eligible_plan_item_ids', '[]'::jsonb)
      ) value
    )
  on conflict (team_id, service_date, room_id)
  do update set
    assignment_type = excluded.assignment_type,
    priority = excluded.priority,
    estimated_duration = excluded.estimated_duration,
    notes = excluded.notes,
    source_plan_item_id = excluded.source_plan_item_id,
    planned_candidate_user_id = excluded.planned_candidate_user_id,
    status = case
      when public.housekeeping_team_tasks.status = 'claimed' then public.housekeeping_team_tasks.status
      else 'queued'
    end,
    updated_at = now();

  get diagnostics v_queued_count = row_count;

  delete from public.room_assignments ra
  using public.next_day_housekeeping_plan_items i,
        public.housekeeping_team_rooms tr
  where i.plan_id = new.id
    and tr.team_id = v_team_id
    and tr.room_id = i.room_id
    and tr.is_active
    and ra.room_id = i.room_id
    and ra.assigned_to = i.assigned_to
    and ra.assignment_date = new.plan_date
    and ra.assignment_type = i.assignment_type
    and ra.status = 'assigned'::public.assignment_status
    and ra.started_at is null
    and ra.completed_at is null
    and coalesce(array_length(ra.completion_photos, 1), 0) = 0
    and ra.created_at >= coalesce(new.release_attempted_at, now() - interval '10 minutes')
    and exists (
      select 1 from public.housekeeping_team_tasks task
      where task.team_id = v_team_id
        and task.service_date = new.plan_date
        and task.room_id = i.room_id
        and task.source_plan_item_id = i.id
    );

  get diagnostics v_deleted_count = row_count;

  -- Make the release audit explicit: Team B work is released, but is waiting in
  -- the shared queue until a real cleaner claims it.
  update public.next_day_housekeeping_plans
  set release_result = coalesce(release_result, '{}'::jsonb) || jsonb_build_object(
        'team_b_shared_queue', true,
        'queued_team_b_tasks', v_queued_count,
        'team_b_provisional_assignments_removed', v_deleted_count,
        'released_individual_assignments', greatest(
          0,
          coalesce((release_result ->> 'released_assignments')::integer, 0) - v_deleted_count
        )
      ),
      updated_at = now()
  where id = new.id;

  return new;
end;
$$;

drop trigger if exists trg_materialize_slnt_team_b_queue_after_plan_release
  on public.next_day_housekeeping_plans;
create trigger trg_materialize_slnt_team_b_queue_after_plan_release
after update of status on public.next_day_housekeeping_plans
for each row
execute function public.materialize_slnt_team_b_queue_after_plan_release();

create or replace function public.claim_housekeeping_team_task(p_task_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.housekeeping_team_tasks%rowtype;
  v_team public.housekeeping_teams%rowtype;
  v_assignment_id uuid;
  v_today date := (now() at time zone 'Europe/Budapest')::date;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into v_task
  from public.housekeeping_team_tasks
  where id = p_task_id
  for update;

  if not found then
    raise exception 'Housekeeping team task not found';
  end if;

  select * into v_team
  from public.housekeeping_teams
  where id = v_task.team_id
    and is_active;

  if not found or v_team.organization_slug <> 'slnt' or v_team.code <> 'team-b' then
    raise exception 'This task is not an active SLNT Team B task';
  end if;

  if v_task.service_date <> v_today then
    raise exception 'Team B rooms can only be claimed on their service date';
  end if;

  if not exists (
    select 1
    from public.housekeeping_team_members m
    join public.profiles p on p.id = m.user_id
    where m.team_id = v_task.team_id
      and m.user_id = auth.uid()
      and m.is_active
      and (m.effective_from is null or m.effective_from <= v_task.service_date)
      and (m.effective_to is null or m.effective_to >= v_task.service_date)
      and p.organization_slug = 'slnt'
      and p.deleted_at is null
      and (p.role::text = 'housekeeping' or p.acts_as_housekeeper = true)
  ) then
    raise exception 'You are not an active member of SLNT Team B' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.staff_schedules s
    where s.organization_slug = 'slnt'
      and s.user_id = auth.uid()
      and s.work_date = v_task.service_date
      and s.status = 'published'
  ) then
    raise exception 'Your published Staff Schedule does not show you working today';
  end if;

  if v_task.status = 'claimed' then
    if v_task.claimed_by = auth.uid() then
      return jsonb_build_object(
        'task_id', v_task.id,
        'room_assignment_id', v_task.room_assignment_id,
        'already_claimed', true
      );
    end if;
    raise exception 'This room was already claimed by another Team B cleaner';
  end if;

  if v_task.status <> 'queued' then
    raise exception 'This Team B task is not available to claim';
  end if;

  select ra.id into v_assignment_id
  from public.room_assignments ra
  where ra.room_id = v_task.room_id
    and ra.assignment_date = v_task.service_date
    and ra.status <> 'cancelled'::public.assignment_status
  order by ra.created_at desc
  limit 1;

  if v_assignment_id is not null then
    raise exception 'This room already has a live housekeeping assignment';
  end if;

  insert into public.room_assignments (
    room_id,
    assigned_to,
    assigned_by,
    assignment_date,
    assignment_type,
    status,
    priority,
    estimated_duration,
    notes,
    organization_slug
  ) values (
    v_task.room_id,
    auth.uid(),
    auth.uid(),
    v_task.service_date,
    v_task.assignment_type,
    'assigned'::public.assignment_status,
    v_task.priority,
    v_task.estimated_duration,
    v_task.notes,
    v_task.organization_slug
  )
  returning id into v_assignment_id;

  update public.housekeeping_team_tasks
  set status = 'claimed',
      claimed_by = auth.uid(),
      claimed_at = now(),
      room_assignment_id = v_assignment_id,
      updated_at = now()
  where id = v_task.id;

  return jsonb_build_object(
    'task_id', v_task.id,
    'room_assignment_id', v_assignment_id,
    'claimed_by', auth.uid(),
    'already_claimed', false
  );
end;
$$;

revoke all on function public.set_slnt_housekeeping_team_members(text, uuid[]) from public;
revoke all on function public.claim_housekeeping_team_task(uuid) from public;
grant execute on function public.set_slnt_housekeeping_team_members(text, uuid[]) to authenticated;
grant execute on function public.claim_housekeeping_team_task(uuid) to authenticated;

comment on table public.housekeeping_team_tasks is
  'Shared pre-claim housekeeping queue. Claiming creates the normal room_assignments record so existing HotelCare cleaning/photo flows remain authoritative.';
comment on function public.claim_housekeeping_team_task(uuid) is
  'Atomically claims an SLNT Team B room for the authenticated scheduled team member and creates its normal room assignment.';
