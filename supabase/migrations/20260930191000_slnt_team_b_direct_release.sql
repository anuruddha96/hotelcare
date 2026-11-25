-- Refine Team B release so shared rooms never create a provisional individual
-- room_assignment. This avoids notifications/history/learning events for a
-- cleaner who never actually claimed the room.

drop trigger if exists trg_materialize_slnt_team_b_queue_after_plan_release
  on public.next_day_housekeeping_plans;

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
  v_team_queued_count integer := 0;
  v_conflict_room_count integer := 0;
  v_pms_skipped_count integer := 0;
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
  ), slnt_team_b as materialized (
    select t.id
    from public.housekeeping_teams t
    where v_plan.organization_slug = 'slnt'
      and t.organization_slug = v_plan.organization_slug
      and t.code = 'team-b'
      and t.assignment_mode = 'shared_claim'
      and t.is_active
    order by t.created_at
    limit 1
  ), team_items as materialized (
    select i.*, t.id as team_id
    from eligible_items i
    join slnt_team_b t on true
    join public.housekeeping_team_rooms tr
      on tr.team_id = t.id
     and tr.room_id = i.room_id
     and tr.is_active
  ), individual_items as materialized (
    select i.*
    from eligible_items i
    where not exists (
      select 1 from team_items ti where ti.id = i.id
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
        nullif(
          v_plan.release_revalidation_result
            -> 'assignment_type_overrides'
            ->> i.id::text,
          ''
        )::public.assignment_type,
        i.assignment_type
      ),
      'assigned'::public.assignment_status,
      i.priority,
      i.estimated_duration,
      i.notes,
      v_plan.organization_slug
    from individual_items i
    returning id, room_id
  ), queued_team as (
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
      v_plan.organization_slug,
      v_plan.hotel_id,
      i.team_id,
      i.room_id,
      v_plan.plan_date,
      coalesce(
        nullif(
          v_plan.release_revalidation_result
            -> 'assignment_type_overrides'
            ->> i.id::text,
          ''
        )::public.assignment_type,
        i.assignment_type
      ),
      i.priority,
      i.estimated_duration,
      i.notes,
      'queued',
      i.id,
      i.assigned_to
    from team_items i
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
      updated_at = now()
    returning id, room_id
  ), released_rooms as materialized (
    select room_id from inserted
    union
    select room_id from queued_team
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
    where r.id in (select room_id from released_rooms)
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
    (select count(*) from queued_team),
    (select count(*) from promoted_service_flags)
  into v_inserted_count, v_team_queued_count, v_service_flag_room_count;

  v_result := jsonb_build_object(
    'plan_id', p_plan_id,
    'plan_date', v_plan.plan_date,
    'planned_assignments', v_planned_count,
    'validated_assignments', v_validated_item_count,
    'pms_or_staff_skipped_assignments', v_pms_skipped_count,
    'overnight_type_changes', v_type_change_count,
    'service_flag_rooms_promoted', v_service_flag_room_count,
    'released_assignments', v_inserted_count,
    'queued_team_b_tasks', v_team_queued_count,
    'released_work_items', v_inserted_count + v_team_queued_count,
    'team_b_shared_queue', v_team_queued_count > 0,
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

comment on function public.release_next_day_housekeeping_plan(uuid) is
  'Releases validated housekeeping plans. SLNT Team B mapped rooms go directly to the shared claim queue; all other rooms retain the existing individual room-assignment release path.';
