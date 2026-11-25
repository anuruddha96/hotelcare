-- Follow-up hardening for the 08:00 release worker.
-- 1) Validate individual plan items, not only rooms, so a shared room can keep
--    one active housekeeper while another person was marked Off overnight.
-- 2) Store one-time delay/recovery notification state on the plan.

alter table public.next_day_housekeeping_plans
  add column if not exists release_failure_notified_at timestamptz,
  add column if not exists release_failure_notification_error text,
  add column if not exists release_recovery_notified_at timestamptz;

create or replace function public.release_next_day_housekeeping_plan(p_plan_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan public.next_day_housekeeping_plans%rowtype;
  v_planned_count integer := 0;
  v_validated_item_count integer := 0;
  v_inserted_count integer := 0;
  v_conflict_room_count integer := 0;
  v_pms_skipped_count integer := 0;
  v_type_change_count integer := 0;
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

  if jsonb_typeof(v_plan.release_revalidation_result -> 'eligible_plan_item_ids') <> 'array' then
    raise exception 'PMS revalidation result is missing eligible_plan_item_ids';
  end if;

  update public.next_day_housekeeping_plans
  set status = 'releasing', release_attempted_at = now(), last_error = null
  where id = p_plan_id;

  select count(*) into v_planned_count
  from public.next_day_housekeeping_plan_items
  where plan_id = p_plan_id;

  select count(*) into v_validated_item_count
  from jsonb_array_elements_text(v_plan.release_revalidation_result -> 'eligible_plan_item_ids');

  v_pms_skipped_count := greatest(0, v_planned_count - v_validated_item_count);
  v_type_change_count := coalesce(
    jsonb_array_length(v_plan.release_revalidation_result -> 'type_changes'),
    0
  );

  select count(distinct i.room_id) into v_conflict_room_count
  from public.next_day_housekeeping_plan_items i
  where i.plan_id = p_plan_id
    and i.id in (
      select value::uuid
      from jsonb_array_elements_text(v_plan.release_revalidation_result -> 'eligible_plan_item_ids') value
    )
    and exists (
      select 1 from public.room_assignments ra
      where ra.room_id = i.room_id
        and ra.assignment_date = v_plan.plan_date
        and ra.status <> 'cancelled'::public.assignment_status
    );

  with validated_items as materialized (
    select value::uuid as plan_item_id
    from jsonb_array_elements_text(v_plan.release_revalidation_result -> 'eligible_plan_item_ids') value
  ), eligible_items as materialized (
    select i.*
    from public.next_day_housekeeping_plan_items i
    join validated_items vi on vi.plan_item_id = i.id
    where i.plan_id = p_plan_id
      and not exists (
        select 1 from public.room_assignments ra
        where ra.room_id = i.room_id
          and ra.assignment_date = v_plan.plan_date
          and ra.status <> 'cancelled'::public.assignment_status
      )
  ), inserted as (
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
        nullif(v_plan.release_revalidation_result -> 'assignment_type_overrides' ->> i.id::text, '')::public.assignment_type,
        i.assignment_type
      ),
      'assigned'::public.assignment_status,
      i.priority,
      i.estimated_duration,
      i.notes,
      v_plan.organization_slug
    from eligible_items i
    returning id
  )
  select count(*) into v_inserted_count from inserted;

  v_result := jsonb_build_object(
    'plan_id', p_plan_id,
    'plan_date', v_plan.plan_date,
    'planned_assignments', v_planned_count,
    'validated_assignments', v_validated_item_count,
    'pms_or_staff_skipped_assignments', v_pms_skipped_count,
    'overnight_type_changes', v_type_change_count,
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

revoke execute on function public.release_next_day_housekeeping_plan(uuid) from authenticated;
grant execute on function public.release_next_day_housekeeping_plan(uuid) to service_role;
