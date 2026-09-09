-- Follow-up to the next-day plan security guard.
-- PostgreSQL BEFORE triggers run by name. The release-revalidation reset trigger
-- intentionally clears failed/running validation state during approval, so the
-- manager guard must allow exactly that server-computed reset. Also allow the
-- approved -> draft transition to clear approval audit fields.

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
  v_approval_transition boolean := false;
begin
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

  v_approval_transition := new.status = 'approved' and old.status is distinct from 'approved';

  -- The earlier reset_next_day_release_revalidation_on_plan_change trigger is
  -- allowed to reset these fields during a real approval transition. At every
  -- other time they remain server-only.
  if not v_approval_transition and (
    new.release_revalidation_attempted_at is distinct from old.release_revalidation_attempted_at
    or new.release_revalidated_at is distinct from old.release_revalidated_at
    or new.release_revalidation_status is distinct from old.release_revalidation_status
    or new.release_revalidation_result is distinct from old.release_revalidation_result
    or new.release_revalidation_attempt_count is distinct from old.release_revalidation_attempt_count
    or new.release_failure_notified_at is distinct from old.release_failure_notified_at
    or new.release_recovery_notified_at is distinct from old.release_recovery_notified_at
    or new.release_adjustment_notified_at is distinct from old.release_adjustment_notified_at
  ) then
    raise exception 'Morning release validation fields are server-controlled';
  end if;

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
  elsif new.status = 'approved' then
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