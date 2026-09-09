-- Phase 3: next-day housekeeping activity watchdog.
-- Tracks real HotelCare activity, keeps per-hotel alert settings, and creates
-- duplicate-safe alert rows for housekeepers who were not active by the cutoff.

create table if not exists public.housekeeping_automation_settings (
  organization_slug text not null,
  hotel_id text not null,
  timezone text not null default 'Europe/Budapest',
  inactivity_alert_enabled boolean not null default true,
  inactivity_alert_time time without time zone not null default '08:45'::time,
  alert_emails text[] not null default array['anuruddha.dharmasena@gmail.com']::text[],
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_slug, hotel_id),
  check (cardinality(alert_emails) > 0)
);

create table if not exists public.housekeeping_daily_presence (
  id uuid primary key default gen_random_uuid(),
  organization_slug text not null,
  hotel_id text not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  work_date date not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  source text not null default 'housekeeping_app',
  client_context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_slug, hotel_id, user_id, work_date)
);

create table if not exists public.housekeeping_automation_alerts (
  id uuid primary key default gen_random_uuid(),
  organization_slug text not null,
  hotel_id text not null,
  work_date date not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  alert_type text not null default 'missing_activity' check (alert_type in ('missing_activity')),
  status text not null default 'pending' check (status in ('pending','sending','sent','failed','skipped')),
  recipients text[] not null,
  assignment_count integer not null default 0,
  cutoff_at timestamptz not null,
  first_detected_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  attempt_count integer not null default 0,
  sent_at timestamptz,
  provider_message_id text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_slug, hotel_id, work_date, user_id, alert_type)
);

create index if not exists housekeeping_presence_lookup_idx
  on public.housekeeping_daily_presence (organization_slug, hotel_id, work_date, user_id, first_seen_at);

create index if not exists housekeeping_activity_alert_queue_idx
  on public.housekeeping_automation_alerts (status, cutoff_at, last_attempt_at)
  where status in ('pending','failed');

drop trigger if exists update_housekeeping_automation_settings_updated_at on public.housekeeping_automation_settings;
create trigger update_housekeeping_automation_settings_updated_at
before update on public.housekeeping_automation_settings
for each row execute function public.update_updated_at_column();

drop trigger if exists update_housekeeping_daily_presence_updated_at on public.housekeeping_daily_presence;
create trigger update_housekeeping_daily_presence_updated_at
before update on public.housekeeping_daily_presence
for each row execute function public.update_updated_at_column();

drop trigger if exists update_housekeeping_automation_alerts_updated_at on public.housekeeping_automation_alerts;
create trigger update_housekeeping_automation_alerts_updated_at
before update on public.housekeeping_automation_alerts
for each row execute function public.update_updated_at_column();

alter table public.housekeeping_automation_settings enable row level security;
alter table public.housekeeping_daily_presence enable row level security;
alter table public.housekeeping_automation_alerts enable row level security;

create policy "Managers can view housekeeping automation settings"
on public.housekeeping_automation_settings
for select to authenticated
using (public.can_manage_next_day_housekeeping_plan(organization_slug, hotel_id));

create policy "Managers can create housekeeping automation settings"
on public.housekeeping_automation_settings
for insert to authenticated
with check (
  public.can_manage_next_day_housekeeping_plan(organization_slug, hotel_id)
  and (created_by is null or created_by = auth.uid())
);

create policy "Managers can update housekeeping automation settings"
on public.housekeeping_automation_settings
for update to authenticated
using (public.can_manage_next_day_housekeeping_plan(organization_slug, hotel_id))
with check (public.can_manage_next_day_housekeeping_plan(organization_slug, hotel_id));

create policy "Users can view own housekeeping presence"
on public.housekeeping_daily_presence
for select to authenticated
using (user_id = auth.uid());

create policy "Managers can view housekeeping presence"
on public.housekeeping_daily_presence
for select to authenticated
using (public.can_manage_next_day_housekeeping_plan(organization_slug, hotel_id));

create policy "Managers can view housekeeping automation alerts"
on public.housekeeping_automation_alerts
for select to authenticated
using (public.can_manage_next_day_housekeeping_plan(organization_slug, hotel_id));

-- A heartbeat represents meaningful HotelCare activity, not merely an old auth
-- session. Derive the work date in the hotel's configured timezone so Budapest
-- DST and future non-Hungarian hotels are handled correctly.
create or replace function public.mark_housekeeping_presence(
  p_hotel_id text,
  p_source text default 'housekeeping_app',
  p_client_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user public.profiles%rowtype;
  v_org text;
  v_timezone text := 'Europe/Budapest';
  v_work_date date;
  v_now timestamptz := now();
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select * into v_user from public.profiles where id = auth.uid();
  if not found then
    raise exception 'Profile not found';
  end if;

  if not (
    v_user.role in ('housekeeping'::public.user_role, 'housekeeping_manager'::public.user_role, 'supervisor'::public.user_role)
    or coalesce(v_user.acts_as_housekeeper, false)
  ) then
    return jsonb_build_object('recorded', false, 'reason', 'not_housekeeping_user');
  end if;

  v_org := v_user.organization_slug;
  if v_org is null then
    raise exception 'Organization is missing';
  end if;

  if not (
    v_user.assigned_hotel = p_hotel_id
    or v_user.hotel_id::text = p_hotel_id
    or exists (
      select 1
      from public.hotel_configurations hc
      where (hc.hotel_id = p_hotel_id or hc.hotel_name = p_hotel_id)
        and (
          v_user.assigned_hotel = hc.hotel_id
          or v_user.assigned_hotel = hc.hotel_name
          or v_user.hotel_id::text = hc.hotel_id
        )
    )
  ) then
    raise exception 'Hotel access denied';
  end if;

  select coalesce(s.timezone, 'Europe/Budapest')
  into v_timezone
  from public.housekeeping_automation_settings s
  where s.organization_slug = v_org and s.hotel_id = p_hotel_id;
  v_timezone := coalesce(v_timezone, 'Europe/Budapest');

  begin
    perform v_now at time zone v_timezone;
  exception when invalid_parameter_value then
    v_timezone := 'Europe/Budapest';
  end;

  v_work_date := (v_now at time zone v_timezone)::date;

  insert into public.housekeeping_daily_presence (
    organization_slug, hotel_id, user_id, work_date,
    first_seen_at, last_seen_at, source, client_context
  ) values (
    v_org, p_hotel_id, auth.uid(), v_work_date,
    v_now, v_now, coalesce(nullif(p_source, ''), 'housekeeping_app'), coalesce(p_client_context, '{}'::jsonb)
  )
  on conflict (organization_slug, hotel_id, user_id, work_date)
  do update set
    last_seen_at = excluded.last_seen_at,
    source = excluded.source,
    client_context = public.housekeeping_daily_presence.client_context || excluded.client_context;

  return jsonb_build_object(
    'recorded', true,
    'work_date', v_work_date,
    'last_seen_at', v_now,
    'timezone', v_timezone
  );
end;
$$;

revoke all on function public.mark_housekeeping_presence(text,text,jsonb) from public;
grant execute on function public.mark_housekeeping_presence(text,text,jsonb) to authenticated;

-- Insert one durable alert record per late housekeeper/day. The exact planned
-- assignment must also exist in live room_assignments so a plan item skipped at
-- 08:00 because of a manual conflict can never create a false missing-user alert.
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
      and coalesce(s.inactivity_alert_enabled, true) = true
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

-- Claim retryable alert rows atomically. A crashed worker can retry after 15 min;
-- at most three email attempts are made for a given late housekeeper/day.
create or replace function public.claim_housekeeping_activity_alerts(p_limit integer default 100)
returns setof public.housekeeping_automation_alerts
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with picked as (
    select a.id
    from public.housekeeping_automation_alerts a
    where a.status in ('pending','failed')
      and a.attempt_count < 3
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
$$;

revoke all on function public.claim_housekeeping_activity_alerts(integer) from public;
revoke all on function public.claim_housekeeping_activity_alerts(integer) from anon;
revoke all on function public.claim_housekeeping_activity_alerts(integer) from authenticated;
grant execute on function public.claim_housekeeping_activity_alerts(integer) to service_role;

-- Create a random cron secret inside Vault. The value is generated by Postgres
-- at migration time and is never committed to source control.
do $$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'housekeeping_activity_worker_secret') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'housekeeping_activity_worker_secret',
      'HotelCare housekeeping activity watchdog cron secret',
      null
    );
  end if;
end
$$;

create or replace function public.get_housekeeping_activity_worker_secret()
returns text
language sql
security definer
set search_path = public, vault
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name = 'housekeeping_activity_worker_secret'
  limit 1;
$$;

revoke all on function public.get_housekeeping_activity_worker_secret() from public;
revoke all on function public.get_housekeeping_activity_worker_secret() from anon;
revoke all on function public.get_housekeeping_activity_worker_secret() from authenticated;
grant execute on function public.get_housekeeping_activity_worker_secret() to service_role;

-- The Edge Function performs custom x-worker-secret validation. Poll every five
-- minutes so a configured 08:45 cutoff is acted on promptly without a browser.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from pg_extension where extname = 'pg_net') then
    if exists (select 1 from cron.job where jobname = 'hotelcare-housekeeping-activity-watchdog') then
      perform cron.unschedule('hotelcare-housekeeping-activity-watchdog');
    end if;
    perform cron.schedule(
      'hotelcare-housekeeping-activity-watchdog',
      '*/5 * * * *',
      $cron$
        select net.http_post(
          url := 'https://pcmszqqklkolvvlabohq.supabase.co/functions/v1/housekeeping-activity-watchdog',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-worker-secret', public.get_housekeeping_activity_worker_secret()
          ),
          body := jsonb_build_object('trigger', 'cron', 'scheduled_at', now())
        ) as request_id;
      $cron$
    );
  end if;
end
$$;
