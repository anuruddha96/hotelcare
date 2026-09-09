-- Security and integrity hardening for next-day housekeeping automation.
--
-- UI checks are not a security boundary. This migration makes approved/released
-- plans tamper-resistant at the database layer, validates every planned worker
-- against the hotel, and gives shared-cleaning helper rows an explicit role that
-- never trains the manager-correction learning model.

alter table public.next_day_housekeeping_plan_items
  drop constraint if exists next_day_housekeeping_plan_items_source_check;

alter table public.next_day_housekeeping_plan_items
  add constraint next_day_housekeeping_plan_items_source_check
  check (source in ('auto','manager','manual','learned','shared'));

create or replace function public.next_day_housekeeping_staff_matches_hotel(
  p_plan_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.next_day_housekeeping_plans plan
    join public.profiles person on person.id = p_user_id
    where plan.id = p_plan_id
      and person.organization_slug = plan.organization_slug
      and person.deleted_at is null
      and (
        person.role in (
          'housekeeping'::public.user_role,
          'housekeeping_manager'::public.user_role,
          'supervisor'::public.user_role
        )
        or coalesce(person.acts_as_housekeeper, false)
      )
      and (
        person.assigned_hotel = plan.hotel_id
        or person.hotel_id = plan.hotel_id
        or exists (
          select 1
          from public.hotel_configurations hc
          where (hc.hotel_id = plan.hotel_id or hc.hotel_name = plan.hotel_id)
            and (
              person.assigned_hotel = hc.hotel_id
              or person.assigned_hotel = hc.hotel_name
              or person.hotel_id = hc.hotel_id
              or person.hotel_id = hc.hotel_name
            )
        )
      )
  );
$$;

revoke all on function public.next_day_housekeeping_staff_matches_hotel(uuid,uuid) from public;
grant execute on function public.next_day_housekeeping_staff_matches_hotel(uuid,uuid) to authenticated;

create or replace function public.guard_next_day_housekeeping_plan_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_selected_staff integer := 0;
  v_items integer := 0;
  v_invalid_items integer := 0;
  v_claim_role text := current_setting('request.jwt.claim.role', true);
begin
  -- Service-role / pg_cron workers own release-state transitions. RLS already
  -- prevents anonymous callers from reaching these rows, while authenticated
  -- manager writes are constrained below.
  if auth.uid() is null or v_claim_role = 'service_role' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'New next-day housekeeping plans must start as draft';
    end if;
    if new.created_by <> auth.uid() then
      raise exception 'Plan creator must be the authenticated user';
    end if;
    new.approved_by := null;
    new.approved_at := null;
    new.release_attempted_at := null;
    new.released_at := null;
    new.release_result := '{}'::jsonb;
    new.last_error := null;
    return new;
  end if;

  if new.organization_slug is distinct from old.organization_slug
     or new.hotel_id is distinct from old.hotel_id
     or new.plan_date is distinct from old.plan_date
     or new.created_by is distinct from old.created_by then
    raise exception 'Plan identity fields are immutable; create a new plan instead';
  end if;

  if old.status in ('releasing','released') then
    raise exception 'A releasing or released housekeeping plan is immutable';
  end if;

  if new.status in ('releasing','released','failed') and new.status is distinct from old.status then
    raise exception 'Release states are server-controlled';
  end if;

  if new.release_attempted_at is distinct from old.release_attempted_at
     or new.released_at is distinct from old.released_at
     or new.release_result is distinct from old.release_result then
    raise exception 'Release audit fields are server-controlled';
  end if;

  -- Revalidation/audit columns are added by the later release-worker migration.
  -- They are intentionally not writable by a manager through PostgREST.
  if new.release_revalidated_at is distinct from old.release_revalidated_at
     or new.release_revalidation_status is distinct from old.release_revalidation_status
     or new.release_revalidation_result is distinct from old.release_revalidation_result
     or new.release_revalidation_attempt_count is distinct from old.release_revalidation_attempt_count
     or new.release_failure_notified_at is distinct from old.release_failure_notified_at
     or new.release_recovery_notified_at is distinct from old.release_recovery_notified_at
     or new.release_adjustment_notified_at is distinct from old.release_adjustment_notified_at then
    raise exception 'Morning release validation fields are server-controlled';
  end if;

  -- An approved plan can only be edited by explicitly reopening it as draft.
  if old.status = 'approved' and new.status = 'approved' and (
    new.auto_release is distinct from old.auto_release
    or new.release_time is distinct from old.release_time
    or new.release_timezone is distinct from old.release_timezone
    or new.pms_synced_at is distinct from old.pms_synced_at
    or new.pms_sync_snapshot is distinct from old.pms_sync_snapshot
    or new.algorithm_version is distinct from old.algorithm_version
    or new.generation_context is distinct from old.generation_context
  ) then
    raise exception 'Reopen the approved plan as draft before changing it';
  end if;

  if new.status is distinct from old.status then
    if not (
      (old.status = 'draft' and new.status in ('approved','cancelled'))
      or (old.status = 'approved' and new.status in ('draft','cancelled'))
      or (old.status in ('cancelled','failed') and new.status = 'draft')
    ) then
      raise exception 'Invalid housekeeping plan status transition: % -> %', old.status, new.status;
    end if;
  end if;

  if new.status = 'draft' then
    new.approved_by := null;
    new.approved_at := null;
  end if;

  if new.status = 'approved' then
    if new.pms_synced_at is null or new.pms_synced_at < now() - interval '60 minutes' then
      raise exception 'A PMS sync from the last 60 minutes is required before approval';
    end if;

    select count(*)::integer
    into v_selected_staff
    from public.next_day_housekeeping_plan_staff staff
    where staff.plan_id = new.id and staff.selected = true;

    select count(*)::integer
    into v_items
    from public.next_day_housekeeping_plan_items item
    where item.plan_id = new.id;

    select count(*)::integer
    into v_invalid_items
    from public.next_day_housekeeping_plan_items item
    where item.plan_id = new.id
      and not exists (
        select 1
        from public.next_day_housekeeping_plan_staff staff
        where staff.plan_id = new.id
          and staff.user_id = item.assigned_to
          and staff.selected = true
      );

    if v_selected_staff = 0 or v_items = 0 then
      raise exception 'Approved housekeeping plans require selected staff and assignment items';
    end if;
    if v_invalid_items > 0 then
      raise exception 'Every planned assignment must belong to selected plan staff';
    end if;

    new.approved_by := auth.uid();
    new.approved_at := now();
  elsif new.approved_by is distinct from old.approved_by
     or new.approved_at is distinct from old.approved_at then
    raise exception 'Approval audit fields are controlled by the approval transition';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_next_day_housekeeping_plan_mutation() from public;

drop trigger if exists zz_guard_next_day_housekeeping_plan_mutation
  on public.next_day_housekeeping_plans;
create trigger zz_guard_next_day_housekeeping_plan_mutation
before insert or update on public.next_day_housekeeping_plans
for each row execute function public.guard_next_day_housekeeping_plan_mutation();

create or replace function public.guard_next_day_housekeeping_child_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan_id uuid;
  v_status text;
  v_claim_role text := current_setting('request.jwt.claim.role', true);
begin
  if auth.uid() is null or v_claim_role = 'service_role' then
    return coalesce(new, old);
  end if;

  v_plan_id := case when tg_op = 'DELETE' then old.plan_id else new.plan_id end;
  select status into v_status
  from public.next_day_housekeeping_plans
  where id = v_plan_id
  for update;

  if v_status is null then
    raise exception 'Housekeeping plan not found';
  end if;
  if v_status <> 'draft' then
    raise exception 'Plan staff and rooms can only be changed while the plan is draft';
  end if;

  return coalesce(new, old);
end;
$$;

revoke all on function public.guard_next_day_housekeeping_child_write() from public;

drop trigger if exists aa_guard_next_day_housekeeping_plan_staff_write
  on public.next_day_housekeeping_plan_staff;
create trigger aa_guard_next_day_housekeeping_plan_staff_write
before insert or update or delete on public.next_day_housekeeping_plan_staff
for each row execute function public.guard_next_day_housekeeping_child_write();

drop trigger if exists aa_guard_next_day_housekeeping_plan_item_write
  on public.next_day_housekeeping_plan_items;
create trigger aa_guard_next_day_housekeeping_plan_item_write
before insert or update or delete on public.next_day_housekeeping_plan_items
for each row execute function public.guard_next_day_housekeeping_child_write();

create or replace function public.validate_next_day_housekeeping_plan_staff()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.selected and not public.next_day_housekeeping_staff_matches_hotel(new.plan_id, new.user_id) then
    raise exception 'Selected worker is not an eligible housekeeper for this hotel';
  end if;
  return new;
end;
$$;

revoke all on function public.validate_next_day_housekeeping_plan_staff() from public;

drop trigger if exists validate_next_day_housekeeping_plan_staff_trigger
  on public.next_day_housekeeping_plan_staff;
create trigger validate_next_day_housekeeping_plan_staff_trigger
before insert or update of user_id, selected
on public.next_day_housekeeping_plan_staff
for each row execute function public.validate_next_day_housekeeping_plan_staff();

create or replace function public.validate_next_day_housekeeping_plan_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan public.next_day_housekeeping_plans%rowtype;
  v_room public.rooms%rowtype;
  v_role text;
  v_other_primary integer := 0;
  v_other_shared integer := 0;
begin
  select * into v_plan
  from public.next_day_housekeeping_plans
  where id = new.plan_id;
  if not found then
    raise exception 'Housekeeping plan not found';
  end if;

  select * into v_room
  from public.rooms
  where id = new.room_id;
  if not found then
    raise exception 'Room not found';
  end if;

  if v_room.organization_slug <> v_plan.organization_slug then
    raise exception 'Room belongs to a different organization';
  end if;
  if not (
    v_room.hotel = v_plan.hotel_id
    or public.get_hotel_name_from_id(v_room.hotel) = v_plan.hotel_id
    or public.get_hotel_name_from_id(v_plan.hotel_id) = v_room.hotel
  ) then
    raise exception 'Room does not belong to the plan hotel';
  end if;

  if not public.next_day_housekeeping_staff_matches_hotel(new.plan_id, new.assigned_to) then
    raise exception 'Assignment target is not an eligible housekeeper for this hotel';
  end if;
  if not exists (
    select 1
    from public.next_day_housekeeping_plan_staff staff
    where staff.plan_id = new.plan_id
      and staff.user_id = new.assigned_to
      and staff.selected = true
  ) then
    raise exception 'Assignment target must be selected in the plan staff list';
  end if;

  v_role := coalesce(
    nullif(new.recommendation_context ->> 'assignment_role', ''),
    case when new.source = 'shared' then 'shared' else 'primary' end
  );
  if v_role not in ('primary','shared') then
    raise exception 'Invalid plan assignment role';
  end if;
  if new.source = 'shared' and v_role <> 'shared' then
    raise exception 'Shared plan items must use assignment_role=shared';
  end if;
  if v_role = 'shared' and new.source <> 'shared' then
    new.source := 'shared';
  end if;

  select
    count(*) filter (
      where coalesce(nullif(item.recommendation_context ->> 'assignment_role',''),
        case when item.source = 'shared' then 'shared' else 'primary' end) = 'primary'
    )::integer,
    count(*) filter (
      where coalesce(nullif(item.recommendation_context ->> 'assignment_role',''),
        case when item.source = 'shared' then 'shared' else 'primary' end) = 'shared'
    )::integer
  into v_other_primary, v_other_shared
  from public.next_day_housekeeping_plan_items item
  where item.plan_id = new.plan_id
    and item.room_id = new.room_id
    and item.id <> coalesce(new.id, gen_random_uuid());

  if v_role = 'primary' and v_other_primary > 0 then
    raise exception 'A room can have only one primary housekeeper in a next-day plan';
  end if;
  if v_role = 'shared' and v_other_shared > 0 then
    raise exception 'A room can have only one shared helper (two housekeepers total)';
  end if;

  new.recommendation_context := coalesce(new.recommendation_context, '{}'::jsonb)
    || jsonb_build_object('assignment_role', v_role);

  if new.estimated_duration is not null and new.estimated_duration <= 0 then
    raise exception 'Estimated duration must be positive';
  end if;
  if new.priority < 0 or new.priority > 100 then
    raise exception 'Assignment priority is outside the allowed range';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_next_day_housekeeping_plan_item() from public;

drop trigger if exists validate_next_day_housekeeping_plan_item_trigger
  on public.next_day_housekeeping_plan_items;
create trigger validate_next_day_housekeeping_plan_item_trigger
before insert or update of plan_id, room_id, assigned_to, source, recommendation_context, estimated_duration, priority
on public.next_day_housekeeping_plan_items
for each row execute function public.validate_next_day_housekeeping_plan_item();

create index if not exists next_day_housekeeping_plan_items_role_idx
  on public.next_day_housekeeping_plan_items (
    plan_id,
    room_id,
    ((recommendation_context ->> 'assignment_role'))
  );