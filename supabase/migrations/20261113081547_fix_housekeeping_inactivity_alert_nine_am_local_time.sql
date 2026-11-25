-- Housekeeping inactivity alerts must use the configured hotel-local clock time,
-- not the housekeeping plan release time plus 45 minutes.
-- Retains per-housekeeper activity checks, grouping, recipients and idempotency.
alter table public.housekeeping_automation_settings
  alter column inactivity_alert_time set default time '09:00';

update public.housekeeping_automation_settings
set inactivity_alert_time = time '09:00',
    updated_at = now()
where inactivity_alert_time is distinct from time '09:00'
  and inactivity_alert_enabled = true;

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
      clock.cutoff_at,
      count(distinct i.room_id)::integer as assignment_count
    from public.next_day_housekeeping_plans p
    join public.next_day_housekeeping_plan_items i on i.plan_id = p.id
    left join public.housekeeping_automation_settings s
      on s.organization_slug = p.organization_slug
     and s.hotel_id = p.hotel_id
    cross join lateral (
      select ((p.plan_date + coalesce(s.inactivity_alert_time, time '09:00'))
              at time zone coalesce(nullif(s.timezone, ''), 'Europe/Budapest')) as cutoff_at
    ) clock
    where p.status = 'released'
      and p.released_at is not null
      and coalesce(s.inactivity_alert_enabled, true) = true
      -- Late-released plans should not cause retroactive alerts for staff who
      -- did not yet have a released assignment at the 09:00 checkpoint.
      and p.released_at <= clock.cutoff_at
      and clock.cutoff_at <= now()
      and clock.cutoff_at > now() - interval '12 hours'
      and exists (
        select 1
        from public.room_assignments ra
        where ra.assignment_date = p.plan_date
          and ra.room_id = i.room_id
          and ra.assigned_to = i.assigned_to
          and ra.status <> 'cancelled'::public.assignment_status
      )
    group by p.organization_slug, p.hotel_id, p.plan_date,
      i.assigned_to, s.alert_emails, clock.cutoff_at
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

-- Never claim an alert before its actual configured cutoff.
create or replace function public.claim_housekeeping_activity_alerts(p_limit integer default 100)
returns setof public.housekeeping_automation_alerts
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  return query
  with picked as (
    select a.id
    from public.housekeeping_automation_alerts a
    where a.status in ('pending', 'failed')
      and a.attempt_count < 3
      and a.cutoff_at <= now()
      and a.cutoff_at > now() - interval '12 hours'
      and (a.last_attempt_at is null or a.last_attempt_at < now() - interval '15 minutes')
    order by a.cutoff_at, a.created_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 100), 500))
  ), claimed as (
    update public.housekeeping_automation_alerts a
    set status = 'sending',
        last_attempt_at = now(),
        attempt_count = a.attempt_count + 1,
        last_error = null
    from picked
    where a.id = picked.id
    returning a.*
  )
  select * from claimed;
end;
$function$;

-- Recalculate already queued, unsent future alerts so the worker does not
-- send them at an earlier release-based cutoff. Sent history is untouched.
update public.housekeeping_automation_alerts a
set cutoff_at = ((a.work_date + coalesce(s.inactivity_alert_time, time '09:00'))
                 at time zone coalesce(nullif(s.timezone, ''), 'Europe/Budapest')),
    updated_at = now()
from public.housekeeping_automation_settings s
where s.organization_slug = a.organization_slug
  and s.hotel_id = a.hotel_id
  and a.status in ('pending', 'failed')
  and a.work_date >= (now() at time zone 'Europe/Budapest')::date
  and a.cutoff_at is distinct from
      ((a.work_date + coalesce(s.inactivity_alert_time, time '09:00'))
        at time zone coalesce(nullif(s.timezone, ''), 'Europe/Budapest'));
