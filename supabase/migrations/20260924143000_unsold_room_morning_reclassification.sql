-- Neutral "Unsold now" next-day planning and morning PMS reconciliation.
--
-- Safety invariants:
--  * This migration does not alter any current assignment or room row.
--  * At release time, a planned room is skipped when ANY non-cancelled live
--    assignment already exists for the same business date.
--  * Existing assigned / in-progress / completed / DND / manager-created work
--    is therefore never overwritten by the next-day plan.
--  * Property service flags are only promoted on rooms that were actually
--    inserted by this release transaction; no flag is cleared here.
--
-- The release worker supplies room-id keyed type/service overrides after fresh
-- PMS revalidation. This also fixes the previous item-id vs room-id override
-- mismatch while preserving the manager-selected housekeeper.

create or replace function public.release_next_day_housekeeping_plan(p_plan_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan public.next_day_housekeeping_plans%rowtype;
  v_planned_count integer := 0;
  v_validated_room_count integer := 0;
  v_inserted_count integer := 0;
  v_conflict_room_count integer := 0;
  v_pms_skipped_room_count integer := 0;
  v_type_change_count integer := 0;
  v_service_flag_room_count integer := 0;
  v_result jsonb;
begin
  select * into v_plan
  from public.next_day_housekeeping_plans
  where id = p_plan_id
  for update;

  if not found then
    raise exception 'Next-day housekeeping plan not found';
  end if;

  if auth.uid() is not null
     and not public.can_manage_next_day_housekeeping_plan(v_plan.organization_slug, v_plan.hotel_id) then
    raise exception 'Not authorized to release this next-day housekeeping plan';
  end if;

  if v_plan.status = 'released' then
    return coalesce(v_plan.release_result, '{}'::jsonb) || jsonb_build_object('already_released', true);
  end if;

  if v_plan.status <> 'approved' then
    raise exception 'Only approved next-day housekeeping plans can be released (current status: %)', v_plan.status;
  end if;

  if v_plan.release_revalidation_status <> 'passed'
     or v_plan.release_revalidated_at is null
     or v_plan.release_revalidated_at < now() - interval '30 minutes' then
    raise exception 'A fresh server-side PMS revalidation is required before release';
  end if;

  if jsonb_typeof(v_plan.release_revalidation_result -> 'eligible_room_ids') <> 'array' then
    raise exception 'PMS revalidation result is missing eligible_room_ids';
  end if;

  update public.next_day_housekeeping_plans
  set status = 'releasing', release_attempted_at = now(), last_error = null
  where id = p_plan_id;

  select count(*) into v_planned_count
  from public.next_day_housekeeping_plan_items
  where plan_id = p_plan_id;

  select count(*) into v_validated_room_count
  from jsonb_array_elements_text(v_plan.release_revalidation_result -> 'eligible_room_ids');

  v_pms_skipped_room_count := greatest(0, v_planned_count - v_validated_room_count);
  v_type_change_count := coalesce(
    jsonb_array_length(v_plan.release_revalidation_result -> 'type_changes'),
    0
  );

  -- Any already-existing live work wins. Do not edit, cancel, reassign or
  -- otherwise mutate that work; the planned row for the room is simply skipped.
  select count(distinct i.room_id) into v_conflict_room_count
  from public.next_day_housekeeping_plan_items i
  where i.plan_id = p_plan_id
    and i.room_id in (
      select value::uuid
      from jsonb_array_elements_text(v_plan.release_revalidation_result -> 'eligible_room_ids') value
    )
    and exists (
      select 1 from public.room_assignments ra
      where ra.room_id = i.room_id
        and ra.assignment_date = v_plan.plan_date
        and ra.status <> 'cancelled'::public.assignment_status
    );

  with validated_rooms as materialized (
    select value::uuid as room_id
    from jsonb_array_elements_text(v_plan.release_revalidation_result -> 'eligible_room_ids') value
  ), eligible_rooms as materialized (
    select distinct i.room_id
    from public.next_day_housekeeping_plan_items i
    join validated_rooms vr on vr.room_id = i.room_id
    where i.plan_id = p_plan_id
      and not exists (
        select 1 from public.room_assignments ra
        where ra.room_id = i.room_id
          and ra.assignment_date = v_plan.plan_date
          and ra.status <> 'cancelled'::public.assignment_status
      )
  ), inserted as materialized (
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
    )
    select
      i.room_id,
      i.assigned_to,
      coalesce(v_plan.approved_by, v_plan.created_by),
      v_plan.plan_date,
      coalesce(
        nullif(
          v_plan.release_revalidation_result
            -> 'assignment_type_overrides'
            ->> i.room_id::text,
          ''
        )::public.assignment_type,
        i.assignment_type
      ),
      'assigned'::public.assignment_status,
      i.priority,
      i.estimated_duration,
      i.notes,
      v_plan.organization_slug
    from public.next_day_housekeeping_plan_items i
    join eligible_rooms er on er.room_id = i.room_id
    where i.plan_id = p_plan_id
    returning room_id
  ), promoted_service_flags as (
    update public.rooms r
    set
      towel_change_required = case
        when coalesce(
          (
            v_plan.release_revalidation_result
              -> 'service_flag_overrides'
              -> r.id::text
              ->> 'towel_change_required'
          )::boolean,
          false
        ) then true
        else r.towel_change_required
      end,
      linen_change_required = case
        when coalesce(
          (
            v_plan.release_revalidation_result
              -> 'service_flag_overrides'
              -> r.id::text
              ->> 'linen_change_required'
          )::boolean,
          false
        ) then true
        else r.linen_change_required
      end,
      updated_at = now()
    where r.id in (select room_id from inserted)
      and r.organization_slug = v_plan.organization_slug
      and (
        coalesce(
          (
            v_plan.release_revalidation_result
              -> 'service_flag_overrides'
              -> r.id::text
              ->> 'towel_change_required'
          )::boolean,
          false
        )
        or coalesce(
          (
            v_plan.release_revalidation_result
              -> 'service_flag_overrides'
              -> r.id::text
              ->> 'linen_change_required'
          )::boolean,
          false
        )
      )
    returning r.id
  )
  select
    (select count(*) from inserted),
    (select count(*) from promoted_service_flags)
  into v_inserted_count, v_service_flag_room_count;

  v_result := jsonb_build_object(
    'plan_id', p_plan_id,
    'plan_date', v_plan.plan_date,
    'planned_assignments', v_planned_count,
    'pms_validated_rooms', v_validated_room_count,
    'pms_skipped_rooms', v_pms_skipped_room_count,
    'overnight_type_changes', v_type_change_count,
    'service_flag_rooms_promoted', v_service_flag_room_count,
    'released_assignments', v_inserted_count,
    'skipped_rooms_with_live_changes', v_conflict_room_count,
    'release_revalidation', v_plan.release_revalidation_result,
    'released_at', now()
  );

  update public.next_day_housekeeping_plans
  set status = 'released',
      released_at = now(),
      release_result = v_result,
      last_error = null
  where id = p_plan_id;

  return v_result;
exception when others then
  raise;
end;
$$;

-- Browser/user calls cannot bypass the fresh-PMS release worker.
revoke execute on function public.release_next_day_housekeeping_plan(uuid) from authenticated;
grant execute on function public.release_next_day_housekeeping_plan(uuid) to service_role;
