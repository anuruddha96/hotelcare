-- Do not alert a housekeeper for an 08:45 inactivity cutoff if HotelCare itself
-- released that day's planned assignments after the cutoff. In that situation
-- the employee did not have the planned work in time and must not be blamed.
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
      ((p.plan_date::timestamp + coalesce(s.inactivity_alert_time, '08:45'::time))
        at time zone coalesce(s.timezone, p.release_timezone, 'Europe/Budapest')) as cutoff_at,
      count(distinct i.room_id)::integer as assignment_count
    from public.next_day_housekeeping_plans p
    join public.next_day_housekeeping_plan_items i on i.plan_id = p.id
    left join public.housekeeping_automation_settings s
      on s.organization_slug = p.organization_slug and s.hotel_id = p.hotel_id
    where p.status = 'released'
      and p.released_at is not null
      and coalesce(s.inactivity_alert_enabled, true) = true
      and p.released_at <= ((p.plan_date::timestamp + coalesce(s.inactivity_alert_time, '08:45'::time))
        at time zone coalesce(s.timezone, p.release_timezone, 'Europe/Budapest'))
      and ((p.plan_date::timestamp + coalesce(s.inactivity_alert_time, '08:45'::time))
        at time zone coalesce(s.timezone, p.release_timezone, 'Europe/Budapest')) <= now()
      and ((p.plan_date::timestamp + coalesce(s.inactivity_alert_time, '08:45'::time))
        at time zone coalesce(s.timezone, p.release_timezone, 'Europe/Budapest')) > now() - interval '12 hours'
      and exists (
        select 1
        from public.room_assignments ra
        where ra.assignment_date = p.plan_date
          and ra.room_id = i.room_id
          and ra.assigned_to = i.assigned_to
          and ra.status <> 'cancelled'::public.assignment_status
      )
    group by p.organization_slug, p.hotel_id, p.plan_date, i.assigned_to,
      s.alert_emails, s.inactivity_alert_time, s.timezone, p.release_timezone
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
