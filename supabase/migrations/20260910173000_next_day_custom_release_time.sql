-- Managers may choose a safe morning release time for tomorrow's approved plan.
-- Existing plans keep the 08:00 default unless a manager explicitly changes it.

alter table public.next_day_housekeeping_plans
  drop constraint if exists next_day_housekeeping_release_time_slots_chk;

alter table public.next_day_housekeeping_plans
  add constraint next_day_housekeeping_release_time_slots_chk
  check (release_time in (
    time '06:00', time '06:30', time '07:00',
    time '07:30', time '08:00', time '08:30'
  ));

-- Keep the existing security guard, but permit one narrowly-scoped mutation on an
-- approved plan: changing release_time while the new execution time is still in
-- the future. All other approved-plan material changes still require reopening.
create or replace function public.guard_next_day_housekeeping_plan_mutation()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_selected_staff integer := 0;
  v_items integer := 0;
  v_invalid_items integer := 0;
  v_claim_role text := current_setting('request.jwt.claim.role', true);
  v_approval_transition boolean := false;
  v_expected_release timestamptz;
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

  -- scheduled_release_at is derived by prepare_next_day_housekeeping_plan().
  -- A client cannot move it independently from release_time/timezone.
  if new.scheduled_release_at is distinct from old.scheduled_release_at
     and new.release_time is not distinct from old.release_time
     and new.release_timezone is not distinct from old.release_timezone then
    raise exception 'Scheduled release timestamp is server-controlled';
  end if;

  if old.status = 'approved' and new.status = 'approved' then
    if new.auto_release is distinct from old.auto_release
       or new.release_timezone is distinct from old.release_timezone
       or new.pms_synced_at is distinct from old.pms_synced_at
       or new.pms_sync_snapshot is distinct from old.pms_sync_snapshot
       or new.algorithm_version is distinct from old.algorithm_version
       or new.generation_context is distinct from old.generation_context then
      raise exception 'Reopen the approved plan as draft before changing it';
    end if;

    if new.release_time is distinct from old.release_time then
      if new.release_time not in (
        time '06:00', time '06:30', time '07:00',
        time '07:30', time '08:00', time '08:30'
      ) then
        raise exception 'Release time must be between 06:00 and 08:30 in 30-minute steps';
      end if;

      v_expected_release := (new.plan_date::timestamp + new.release_time)
        at time zone new.release_timezone;
      if new.scheduled_release_at is distinct from v_expected_release then
        raise exception 'Scheduled release timestamp does not match the selected release time';
      end if;
      if v_expected_release <= now() then
        raise exception 'The selected release time has already passed';
      end if;
    end if;
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
    -- A release-time-only edit must not invalidate or rewrite approval audit.
    if old.status = 'approved' and new.release_time is distinct from old.release_time then
      new.approved_by := old.approved_by;
      new.approved_at := old.approved_at;
      return new;
    end if;

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
$function$;

create or replace function public.update_next_day_housekeeping_release_time(
  p_plan_id uuid,
  p_release_time text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_plan public.next_day_housekeeping_plans%rowtype;
  v_time time without time zone;
  v_scheduled timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if p_release_time not in ('06:00','06:30','07:00','07:30','08:00','08:30') then
    raise exception 'Release time must be between 06:00 and 08:30 in 30-minute steps';
  end if;
  v_time := p_release_time::time;

  select * into v_plan
  from public.next_day_housekeeping_plans
  where id = p_plan_id
  for update;

  if not found then
    raise exception 'Tomorrow housekeeping plan not found';
  end if;

  if not public.can_manage_next_day_housekeeping_plan(v_plan.organization_slug, v_plan.hotel_id) then
    raise exception 'You do not have permission to change this hotel plan';
  end if;

  if v_plan.status not in ('draft','approved') then
    raise exception 'Release time can only be changed before the plan starts releasing';
  end if;

  v_scheduled := (v_plan.plan_date::timestamp + v_time) at time zone v_plan.release_timezone;
  if v_scheduled <= now() then
    raise exception 'The selected release time has already passed';
  end if;

  update public.next_day_housekeeping_plans
  set release_time = v_time
  where id = p_plan_id
  returning * into v_plan;

  return jsonb_build_object(
    'id', v_plan.id,
    'release_time', v_plan.release_time::text,
    'scheduled_release_at', v_plan.scheduled_release_at,
    'status', v_plan.status
  );
end;
$function$;

revoke all on function public.update_next_day_housekeeping_release_time(uuid, text) from public, anon;
grant execute on function public.update_next_day_housekeeping_release_time(uuid, text) to authenticated;

-- Activity monitoring follows the actual release. The original 08:45 cutoff was
-- 45 minutes after the default 08:00 release; preserve that operational window
-- for every custom release time.
create or replace function public.prepare_due_housekeeping_activity_alerts()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
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
      and p.released_at + interval '45 minutes' <= now()
      and p.released_at + interval '45 minutes' > now() - interval '12 hours'
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
$function$;

revoke all on function public.prepare_due_housekeeping_activity_alerts() from public, anon, authenticated;
grant execute on function public.prepare_due_housekeeping_activity_alerts() to service_role;
