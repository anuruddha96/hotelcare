-- Let authorized managers choose the automatic release time for a prepared
-- housekeeping plan without reopening the approved room/staff plan.
--
-- The editable window is intentionally narrow: 06:00-08:30 in 30-minute
-- increments, and an approved plan can only be rescheduled before release work
-- has started. Room/staff/PMS content remains immutable while approved.

alter table public.next_day_housekeeping_plans
  drop constraint if exists next_day_housekeeping_plans_release_time_window_check;

alter table public.next_day_housekeeping_plans
  add constraint next_day_housekeeping_plans_release_time_window_check
  check (
    release_time = any (array[
      '06:00'::time,
      '06:30'::time,
      '07:00'::time,
      '07:30'::time,
      '08:00'::time,
      '08:30'::time
    ])
  );

-- Replace the manager guard with a narrow exception for the dedicated release
-- time RPC below. The marker is transaction-local and bound to auth.uid().
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
  v_release_time_rpc_user text := current_setting('hotelcare.next_day_release_time_editor', true);
  v_release_time_only boolean := false;
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

  -- Only the dedicated RPC may adjust an approved schedule in place. Comparing
  -- the complete rows minus the three trigger-computed schedule fields prevents
  -- the marker from becoming a bypass for any other plan content.
  v_release_time_only :=
    old.status = 'approved'
    and new.status = 'approved'
    and v_release_time_rpc_user = auth.uid()::text
    and new.release_time is distinct from old.release_time
    and (
      to_jsonb(new) - array['release_time','scheduled_release_at','updated_at']::text[]
    ) = (
      to_jsonb(old) - array['release_time','scheduled_release_at','updated_at']::text[]
    );

  if old.status = 'approved' and new.status = 'approved' and (
    new.auto_release is distinct from old.auto_release
    or new.release_time is distinct from old.release_time
    or new.release_timezone is distinct from old.release_timezone
    or new.scheduled_release_at is distinct from old.scheduled_release_at
    or new.pms_synced_at is distinct from old.pms_synced_at
    or new.pms_sync_snapshot is distinct from old.pms_sync_snapshot
    or new.algorithm_version is distinct from old.algorithm_version
    or new.generation_context is distinct from old.generation_context
  ) and not v_release_time_only then
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
  elsif new.status = 'approved' and v_approval_transition then
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
  elsif new.status = 'approved' then
    -- Preserve the original approval audit on approved -> approved updates.
    if new.approved_by is distinct from old.approved_by
       or new.approved_at is distinct from old.approved_at then
      raise exception 'Approval audit fields are controlled by the approval transition';
    end if;
  elsif new.approved_by is distinct from old.approved_by
     or new.approved_at is distinct from old.approved_at then
    raise exception 'Approval audit fields are controlled by the approval transition';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_next_day_housekeeping_plan_mutation() from public;

create or replace function public.set_next_day_housekeeping_release_time(
  p_plan_id uuid,
  p_release_time time without time zone
)
returns public.next_day_housekeeping_plans
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan public.next_day_housekeeping_plans%rowtype;
  v_candidate_release_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if p_release_time <> all (array[
    '06:00'::time,
    '06:30'::time,
    '07:00'::time,
    '07:30'::time,
    '08:00'::time,
    '08:30'::time
  ]) then
    raise exception 'Release time must be between 06:00 and 08:30 in 30-minute increments';
  end if;

  select * into v_plan
  from public.next_day_housekeeping_plans
  where id = p_plan_id
  for update;

  if not found then
    raise exception 'Next-day housekeeping plan not found';
  end if;

  if not public.can_manage_next_day_housekeeping_plan(v_plan.organization_slug, v_plan.hotel_id) then
    raise exception 'Not authorized to manage this housekeeping plan';
  end if;

  if v_plan.status not in ('draft','approved') then
    raise exception 'The release time can only be changed before release starts';
  end if;

  v_candidate_release_at :=
    (v_plan.plan_date::timestamp + p_release_time) at time zone v_plan.release_timezone;

  if v_candidate_release_at <= now() then
    raise exception 'Choose a release time that is still in the future';
  end if;

  if v_plan.status = 'approved' and (
    v_plan.scheduled_release_at <= now()
    or v_plan.release_attempted_at is not null
    or v_plan.release_revalidation_attempted_at is not null
    or v_plan.release_revalidation_status = 'running'
  ) then
    raise exception 'Release processing has already started; the time is locked';
  end if;

  perform set_config('hotelcare.next_day_release_time_editor', auth.uid()::text, true);

  update public.next_day_housekeeping_plans
  set release_time = p_release_time
  where id = p_plan_id;

  perform set_config('hotelcare.next_day_release_time_editor', '', true);

  select * into v_plan
  from public.next_day_housekeeping_plans
  where id = p_plan_id;

  return v_plan;
end;
$$;

revoke all on function public.set_next_day_housekeeping_release_time(uuid,time without time zone) from public;
revoke all on function public.set_next_day_housekeeping_release_time(uuid,time without time zone) from anon;
grant execute on function public.set_next_day_housekeeping_release_time(uuid,time without time zone) to authenticated;

-- The activity watchdog follows the real assignment release instead of a fixed
-- 08:45 wall clock. A 06:30 release is checked at 07:15; an 08:30 release is
-- checked at 09:15. This also avoids blaming staff when a worker was delayed.
create or replace function public.prepare_due_housekeeping_activity_alerts()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer := 0;
begin
  with candidate as (
    select
      p.organization_slug,
      p.hotel_id,
      p.plan_date as work_date,
      i.assigned_to as user_id,
      coalesce(s.alert_emails, array['anuruddha.dharmasena@gmail.com']::text[]) as recipients,
      (p.released_at + interval '45 minutes') as cutoff_at,
      count(distinct i.room_id)::integer as assignment_count
    from public.next_day_housekeeping_plans p
    join public.next_day_housekeeping_plan_items i on i.plan_id = p.id
    left join public.housekeeping_automation_settings s
      on s.organization_slug = p.organization_slug and s.hotel_id = p.hotel_id
    where p.status = 'released'
      and p.released_at is not null
      and coalesce(s.inactivity_alert_enabled, true) = true
      and (p.released_at + interval '45 minutes') <= now()
      and (p.released_at + interval '45 minutes') > now() - interval '12 hours'
      and exists (
        select 1
        from public.room_assignments ra
        where ra.assignment_date = p.plan_date
          and ra.room_id = i.room_id
          and ra.assigned_to = i.assigned_to
          and ra.status <> 'cancelled'::public.assignment_status
      )
    group by p.organization_slug, p.hotel_id, p.plan_date, i.assigned_to,
      s.alert_emails, p.released_at
  ), missing as (
    select c.*
    from candidate c
    where not exists (
      select 1
      from public.housekeeping_daily_presence hp
      where hp.organization_slug = c.organization_slug
        and hp.hotel_id = c.hotel_id
        and hp.user_id = c.user_id
        and hp.work_date = c.work_date
        and hp.first_seen_at <= c.cutoff_at
    )
    and not exists (
      select 1
      from public.staff_attendance sa
      where sa.organization_slug = c.organization_slug
        and sa.user_id = c.user_id
        and sa.work_date = c.work_date
        and sa.check_in_time <= c.cutoff_at
    )
    and not exists (
      select 1
      from public.room_assignments ra
      where ra.organization_slug = c.organization_slug
        and ra.assigned_to = c.user_id
        and ra.assignment_date = c.work_date
        and ra.started_at is not null
        and ra.started_at <= c.cutoff_at
    )
  ), inserted as (
    insert into public.housekeeping_automation_alerts (
      organization_slug, hotel_id, work_date, user_id, alert_type,
      status, recipients, assignment_count, cutoff_at
    )
    select
      organization_slug, hotel_id, work_date, user_id, 'missing_activity',
      'pending', recipients, assignment_count, cutoff_at
    from missing
    on conflict (organization_slug, hotel_id, work_date, user_id, alert_type) do nothing
    returning id
  )
  select count(*) into v_inserted from inserted;

  return v_inserted;
end;
$$;

revoke all on function public.prepare_due_housekeeping_activity_alerts() from public;
revoke all on function public.prepare_due_housekeeping_activity_alerts() from anon;
revoke all on function public.prepare_due_housekeeping_activity_alerts() from authenticated;
grant execute on function public.prepare_due_housekeeping_activity_alerts() to service_role;
