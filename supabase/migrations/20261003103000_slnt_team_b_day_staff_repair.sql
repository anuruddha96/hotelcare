-- SLNT Team B guided planning.
-- Managers choose the cleaners working on each future date directly in the
-- 14-day planner. The HR/master staff schedule is no longer a prerequisite for
-- Team B planning. Default cleaners are auto-selected for new dates.

begin;

alter table public.housekeeping_team_members
  add column if not exists is_default boolean not null default false;

create table if not exists public.housekeeping_team_day_staff (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.housekeeping_teams(id) on delete cascade,
  service_date date not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  selected_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (team_id, service_date, user_id)
);

create index if not exists idx_housekeeping_team_day_staff_date
  on public.housekeeping_team_day_staff(team_id, service_date);

alter table public.housekeeping_team_day_staff enable row level security;

drop policy if exists housekeeping_team_day_staff_org_read on public.housekeeping_team_day_staff;
create policy housekeeping_team_day_staff_org_read
on public.housekeeping_team_day_staff
for select to authenticated
using (
  exists (
    select 1
    from public.housekeeping_teams t
    join public.profiles p on p.id = auth.uid()
    where t.id = housekeeping_team_day_staff.team_id
      and p.deleted_at is null
      and p.organization_slug = t.organization_slug
  )
);

-- Preserve default flags when Team B login membership is edited. Removed logins
-- are deactivated rather than deleting/recreating every membership row.
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
  v_ids uuid[] := coalesce(p_user_ids, array[]::uuid[]);
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
  from unnest(v_ids) requested(user_id)
  left join public.profiles p on p.id = requested.user_id
  where p.id is null
     or p.organization_slug <> 'slnt'
     or p.deleted_at is not null
     or not (p.role::text = 'housekeeping' or p.acts_as_housekeeper = true);

  if v_bad_count > 0 then
    raise exception 'One or more selected users are not active SLNT housekeepers';
  end if;

  update public.housekeeping_team_members
  set is_active = false,
      is_default = false,
      updated_at = now()
  where team_id = v_team.id
    and not (user_id = any(v_ids));

  insert into public.housekeeping_team_members (team_id, user_id, is_active)
  select v_team.id, requested.user_id, true
  from unnest(v_ids) requested(user_id)
  on conflict (team_id, user_id)
  do update set
    is_active = true,
    effective_from = null,
    effective_to = null,
    updated_at = now();

  delete from public.housekeeping_team_day_staff ds
  where ds.team_id = v_team.id
    and ds.service_date >= (now() at time zone 'Europe/Budapest')::date
    and not (ds.user_id = any(v_ids));

  return jsonb_build_object(
    'team_id', v_team.id,
    'team_code', v_team.code,
    'member_count', cardinality(v_ids)
  );
end;
$$;

create or replace function public.prepare_slnt_team_b_day_plan(
  p_service_date date,
  p_staff_ids uuid[],
  p_default_staff_ids uuid[],
  p_tasks jsonb
)
returns table(
  queued_count integer,
  cancelled_count integer,
  selected_staff_count integer,
  default_staff_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_team_id uuid;
  v_task jsonb;
  v_room_id uuid;
  v_candidate_id uuid;
  v_assignment text;
  v_cancelled integer := 0;
  v_queued integer := 0;
  v_bad_count integer := 0;
  v_staff_ids uuid[] := coalesce(p_staff_ids, array[]::uuid[]);
  v_default_ids uuid[] := coalesce(p_default_staff_ids, array[]::uuid[]);
begin
  if v_user_id is null then
    raise exception 'Authentication required.';
  end if;

  if coalesce(get_user_organization_slug(v_user_id), '') not in ('slnt', 'slnt-group') then
    raise exception 'SLNT access required.';
  end if;

  if not (
    is_super_admin(v_user_id)
    or is_top_management(v_user_id)
    or coalesce(get_user_role(v_user_id)::text, '') in ('admin', 'manager', 'housekeeping_manager', 'top_management', 'top_management_manager', 'supervisor')
  ) then
    raise exception 'Manager permission required.';
  end if;

  if p_service_date is null or p_service_date <= (now() at time zone 'Europe/Budapest')::date then
    raise exception 'Team B planning is available only for dates after today.';
  end if;

  if cardinality(v_staff_ids) = 0 then
    raise exception 'Select at least one Team B cleaner for this date.';
  end if;

  if p_tasks is null or jsonb_typeof(p_tasks) <> 'array' then
    raise exception 'Team B tasks must be a JSON array.';
  end if;

  select id into v_team_id
  from public.housekeeping_teams
  where organization_slug = 'slnt'
    and hotel_id = 'slnt-group'
    and code = 'team-b'
    and is_active = true
  limit 1;

  if v_team_id is null then
    raise exception 'Active SLNT Team B is not configured.';
  end if;

  select count(*) into v_bad_count
  from unnest(v_staff_ids) requested(user_id)
  left join public.housekeeping_team_members htm
    on htm.team_id = v_team_id
   and htm.user_id = requested.user_id
   and htm.is_active = true
  left join public.profiles p on p.id = requested.user_id
  where htm.id is null
     or p.id is null
     or p.organization_slug <> 'slnt'
     or p.deleted_at is not null
     or not (p.role::text = 'housekeeping' or p.acts_as_housekeeper = true);

  if v_bad_count > 0 then
    raise exception 'One or more selected cleaners are not active Team B members.';
  end if;

  select count(*) into v_bad_count
  from unnest(v_default_ids) requested(user_id)
  left join public.housekeeping_team_members htm
    on htm.team_id = v_team_id
   and htm.user_id = requested.user_id
   and htm.is_active = true
  where htm.id is null;

  if v_bad_count > 0 then
    raise exception 'Default cleaners must be active Team B members.';
  end if;

  for v_task in select value from jsonb_array_elements(p_tasks)
  loop
    begin
      v_room_id := (v_task->>'room_id')::uuid;
    exception when invalid_text_representation then
      raise exception 'Invalid Team B room id.';
    end;

    v_assignment := v_task->>'assignment_type';
    if v_assignment not in ('checkout_cleaning', 'daily_cleaning') then
      raise exception 'Invalid Team B assignment type.';
    end if;

    if not exists (
      select 1
      from public.housekeeping_team_rooms htr
      join public.rooms r on r.id = htr.room_id
      where htr.team_id = v_team_id
        and htr.room_id = v_room_id
        and htr.is_active = true
        and r.organization_slug = 'slnt'
        and r.status is distinct from 'out_of_order'
    ) then
      raise exception 'Room % is not an active Team B room.', v_room_id;
    end if;

    v_candidate_id := null;
    if nullif(v_task->>'planned_candidate_user_id', '') is not null then
      begin
        v_candidate_id := (v_task->>'planned_candidate_user_id')::uuid;
      exception when invalid_text_representation then
        raise exception 'Invalid Team B planned cleaner id.';
      end;

      if not (v_candidate_id = any(v_staff_ids)) then
        raise exception 'Every planned cleaner must be selected as working for this date.';
      end if;
    end if;
  end loop;

  update public.housekeeping_team_members htm
  set is_default = htm.user_id = any(v_default_ids),
      updated_at = now()
  where htm.team_id = v_team_id
    and htm.is_active = true;

  delete from public.housekeeping_team_day_staff
  where team_id = v_team_id
    and service_date = p_service_date;

  insert into public.housekeeping_team_day_staff (
    team_id, service_date, user_id, selected_by
  )
  select v_team_id, p_service_date, requested.user_id, v_user_id
  from (select distinct unnest(v_staff_ids) as user_id) requested;

  update public.housekeeping_team_tasks existing
  set status = 'cancelled', updated_at = now()
  where existing.team_id = v_team_id
    and existing.service_date = p_service_date
    and existing.status = 'queued'
    and existing.claimed_by is null
    and not exists (
      select 1
      from jsonb_array_elements(p_tasks) submitted
      where (submitted->>'room_id')::uuid = existing.room_id
    );
  get diagnostics v_cancelled = row_count;

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
    planned_candidate_user_id
  )
  select
    'slnt',
    'slnt-group',
    v_team_id,
    (submitted->>'room_id')::uuid,
    p_service_date,
    (submitted->>'assignment_type')::assignment_type,
    greatest(1, least(9, coalesce((submitted->>'priority')::integer, 2))),
    nullif(submitted->>'estimated_duration', '')::integer,
    nullif(submitted->>'notes', ''),
    'queued',
    nullif(submitted->>'planned_candidate_user_id', '')::uuid
  from jsonb_array_elements(p_tasks) submitted
  on conflict (team_id, service_date, room_id) do update
  set assignment_type = excluded.assignment_type,
      priority = excluded.priority,
      estimated_duration = excluded.estimated_duration,
      notes = excluded.notes,
      planned_candidate_user_id = excluded.planned_candidate_user_id,
      status = case
        when public.housekeeping_team_tasks.status = 'claimed' then public.housekeeping_team_tasks.status
        else 'queued'
      end,
      updated_at = now();

  select count(*)::integer into v_queued
  from public.housekeeping_team_tasks
  where team_id = v_team_id
    and service_date = p_service_date
    and status <> 'cancelled';

  return query select
    v_queued,
    v_cancelled,
    cardinality(v_staff_ids),
    cardinality(v_default_ids);
end;
$$;

revoke all on function public.prepare_slnt_team_b_day_plan(date, uuid[], uuid[], jsonb) from public;
grant execute on function public.prepare_slnt_team_b_day_plan(date, uuid[], uuid[], jsonb) to authenticated;

-- Team B claims use the planner's selected day staff. Existing released days
-- without a guided staffing record retain the old published-schedule fallback.
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
  v_has_day_staff boolean := false;
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

  select exists (
    select 1
    from public.housekeeping_team_day_staff ds
    where ds.team_id = v_task.team_id
      and ds.service_date = v_task.service_date
  ) into v_has_day_staff;

  if v_has_day_staff then
    if not exists (
      select 1
      from public.housekeeping_team_day_staff ds
      where ds.team_id = v_task.team_id
        and ds.service_date = v_task.service_date
        and ds.user_id = auth.uid()
    ) then
      raise exception 'You are not selected as working for Team B today' using errcode = '42501';
    end if;
  elsif not exists (
    select 1 from public.staff_schedules s
    where s.organization_slug = 'slnt'
      and s.user_id = auth.uid()
      and s.work_date = v_task.service_date
      and s.status = 'published'
  ) then
    raise exception 'You are not selected as working for Team B today' using errcode = '42501';
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

revoke all on function public.claim_housekeeping_team_task(uuid) from public;
grant execute on function public.claim_housekeeping_team_task(uuid) to authenticated;

comment on table public.housekeeping_team_day_staff is
  'SLNT Team B manager-selected cleaners working on a specific service date. Independent from the HR/master staff schedule.';
comment on column public.housekeeping_team_members.is_default is
  'When true, this Team B member is auto-selected on future dates that have no saved guided staffing plan.';
comment on function public.prepare_slnt_team_b_day_plan(date, uuid[], uuid[], jsonb) is
  'Atomically saves Team B day staffing, default staff preferences, and planned room candidates for one future service date.';

commit;
