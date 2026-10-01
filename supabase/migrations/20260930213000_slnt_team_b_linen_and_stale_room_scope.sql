-- SLNT Team B operational cleanup.
-- 1) Add the one extra dirty-linen item requested by SLNT.
-- 2) Mark only the mapped Team B units that require a dish towel.
-- 3) Remove the one stale workbook-missing SLNT unit from operating inventory.
-- 4) Let SLNT managers prepare future Team B shared-queue work without assigning
--    rooms to individual cleaners.
-- No RD Hotels rows are touched.

begin;

insert into public.dirty_linen_items (name, display_name, is_active, sort_order, hotel_scope)
select 'slnt_dish_towel', 'Dish towel', true, 7, 'slnt'
where not exists (
  select 1
  from public.dirty_linen_items
  where name = 'slnt_dish_towel' and hotel_scope = 'slnt'
);

-- Keep the existing global catalogue readable everywhere, preserve the Gozsdu
-- scoped catalogue, and expose SLNT-scoped additions only inside the SLNT tenant.
drop policy if exists "Read own venue linen catalogue" on public.dirty_linen_items;
create policy "Read own venue linen catalogue"
on public.dirty_linen_items
for select
to authenticated
using (
  hotel_scope is null
  or (
    hotel_scope = 'gozsdu-court'
    and get_user_assigned_hotel(auth.uid()) = any (array['gozsdu-court'::text, 'Gozsdu Court Budapest'::text])
  )
  or (
    hotel_scope = 'slnt'
    and get_user_organization_slug(auth.uid()) in ('slnt', 'slnt-group')
  )
);

-- The workbook specifies one additional dish towel only for Be Local,
-- Dorothilux, Giselle and K4 Rooms 1-7. Restrict the update to rooms that are
-- actively mapped to SLNT Team B; Team A and every other tenant remain untouched.
update public.rooms r
set pms_metadata = jsonb_set(
  coalesce(r.pms_metadata, '{}'::jsonb),
  '{slntLinen,requiresDishTowel}',
  'true'::jsonb,
  true
),
updated_at = now()
where r.organization_slug = 'slnt'
  and exists (
    select 1
    from public.housekeeping_team_rooms htr
    join public.housekeeping_teams ht on ht.id = htr.team_id
    where htr.room_id = r.id
      and htr.is_active = true
      and ht.is_active = true
      and ht.organization_slug = 'slnt'
      and ht.code = 'team-b'
  )
  and (
    r.room_number in ('Be Local Budapest Apartment', 'Dorothilux Apartment', 'Giselle Apartment')
    or r.room_number like 'K4 %Room %'
  );

-- Sobi is not present in the supplied active apartment workbook. Do not delete
-- the row or its history; make only this exact SLNT unit non-operating.
update public.rooms
set status = 'out_of_order', updated_at = now()
where organization_slug = 'slnt'
  and room_number = 'Sobi Apartment Budapest'
  and status is distinct from 'out_of_order';

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

  -- Validate every submitted room before making any changes. This is the hard
  -- tenant/team boundary for the security-definer write.
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
  end loop;

  -- Reconcile only still-unclaimed future work. Claimed/current work is never
  -- overwritten by future-plan edits.
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
    null
  from jsonb_array_elements(p_tasks) submitted
  on conflict (team_id, service_date, room_id) do update
  set assignment_type = excluded.assignment_type,
      priority = excluded.priority,
      estimated_duration = excluded.estimated_duration,
      notes = excluded.notes,
      planned_candidate_user_id = null,
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

commit;
