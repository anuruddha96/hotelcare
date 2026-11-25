-- Allow SLNT Team B future planner to persist the manager's suggested cleaner
-- while preserving the shared-claim execution model on the work date.
-- Suggestions are restricted to active Team B members with a published schedule
-- for the selected service date.

create or replace function public.prepare_slnt_team_b_tasks(
  p_service_date date,
  p_tasks jsonb
)
returns table(queued_count integer, cancelled_count integer)
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
    raise exception 'Team B future planning is available only for dates after today.';
  end if;

  if p_tasks is null or jsonb_typeof(p_tasks) <> 'array' then
    raise exception 'Team B tasks must be a JSON array.';
  end if;

  select id into v_team_id
  from housekeeping_teams
  where organization_slug = 'slnt'
    and hotel_id = 'slnt-group'
    and code = 'team-b'
    and is_active = true
  limit 1;

  if v_team_id is null then
    raise exception 'Active SLNT Team B is not configured.';
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
      from housekeeping_team_rooms htr
      join rooms r on r.id = htr.room_id
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

      if not exists (
        select 1
        from housekeeping_team_members htm
        join profiles p on p.id = htm.user_id
        join staff_schedules s
          on s.user_id = htm.user_id
         and s.organization_slug = 'slnt'
         and s.hotel_id = 'slnt-group'
         and s.work_date = p_service_date
         and s.status = 'published'
        where htm.team_id = v_team_id
          and htm.user_id = v_candidate_id
          and htm.is_active = true
          and (htm.effective_from is null or htm.effective_from <= p_service_date)
          and (htm.effective_to is null or htm.effective_to >= p_service_date)
          and p.organization_slug = 'slnt'
          and p.deleted_at is null
          and (p.role::text = 'housekeeping' or p.acts_as_housekeeper = true)
      ) then
        raise exception 'Planned cleaner % is not a published Team B housekeeper for %.', v_candidate_id, p_service_date;
      end if;
    end if;
  end loop;

  update housekeeping_team_tasks existing
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

  insert into housekeeping_team_tasks (
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
        when housekeeping_team_tasks.status = 'cancelled' and housekeeping_team_tasks.claimed_by is null then 'queued'
        else housekeeping_team_tasks.status
      end,
      updated_at = now();

  select count(*)::integer into v_queued
  from housekeeping_team_tasks
  where team_id = v_team_id
    and service_date = p_service_date
    and status <> 'cancelled';

  return query select v_queued, v_cancelled;
end;
$$;

revoke all on function public.prepare_slnt_team_b_tasks(date, jsonb) from public;
grant execute on function public.prepare_slnt_team_b_tasks(date, jsonb) to authenticated;

comment on function public.prepare_slnt_team_b_tasks(date, jsonb) is
  'Prepares future SLNT Team B shared work and stores an optional manager-planned cleaner. The planned cleaner must be an active Team B member with a published schedule for the service date; work still remains shared/claimable on the service date.';
