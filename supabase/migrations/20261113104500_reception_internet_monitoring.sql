-- Smart Internet Monitoring: RD Hotels reception PC heartbeats and admin-only alerts.
-- The Edge Functions are the only Data API entrypoint. No direct client CRUD grants.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create table if not exists public.network_monitors (
  id uuid primary key default gen_random_uuid(),
  organization_slug text not null,
  hotel_id text not null,
  device_label text not null check (char_length(device_label) between 1 and 100),
  token_sha256 text not null check (char_length(token_sha256) = 64),
  enabled boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_heartbeat_at timestamptz not null default now(),
  constraint network_monitors_hotel_fk foreign key (hotel_id)
    references public.hotel_configurations(hotel_id) on update cascade
);
create index if not exists network_monitors_due_idx
  on public.network_monitors (last_heartbeat_at) where enabled;
create index if not exists network_monitors_hotel_idx
  on public.network_monitors (organization_slug, hotel_id);
alter table public.network_monitors enable row level security;
revoke all on public.network_monitors from anon, authenticated;

create table if not exists public.network_monitor_incidents (
  id uuid primary key default gen_random_uuid(),
  monitor_id uuid not null references public.network_monitors(id) on delete cascade,
  started_at timestamptz not null,
  detected_at timestamptz not null default now(),
  recovered_at timestamptz,
  closed_reason text check (closed_reason in ('reconnected', 'disabled'))
);
create unique index if not exists network_monitor_one_open_incident
  on public.network_monitor_incidents (monitor_id) where recovered_at is null;
create index if not exists network_monitor_incident_history
  on public.network_monitor_incidents(monitor_id, detected_at desc);
alter table public.network_monitor_incidents enable row level security;
revoke all on public.network_monitor_incidents from anon, authenticated;

create table if not exists public.network_monitor_alerts (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.network_monitor_incidents(id) on delete cascade,
  kind text not null check (kind in ('outage', 'recovery')),
  status text not null default 'pending'
    check (status in ('pending','sending','sent','failed','cancelled')),
  attempts integer not null default 0,
  next_retry_at timestamptz not null default now(),
  claimed_at timestamptz,
  sent_at timestamptz,
  provider_message_id text,
  last_error text,
  created_at timestamptz not null default now(),
  unique(incident_id, kind)
);
create index if not exists network_monitor_alerts_due
  on public.network_monitor_alerts (status, next_retry_at);
alter table public.network_monitor_alerts enable row level security;
revoke all on public.network_monitor_alerts from anon, authenticated;

-- Only service_role can call worker RPCs. SECURITY INVOKER intentionally keeps
-- permissions with the caller, avoiding a public SECURITY DEFINER bypass.
create or replace function public.network_monitor_prepare_alerts()
returns integer
language plpgsql security invoker
set search_path = ''
as $func$
declare created_count integer := 0;
declare recovered_count integer := 0;
begin
  with new_incidents as (
    insert into public.network_monitor_incidents (monitor_id, started_at, detected_at)
    select m.id, m.last_heartbeat_at, now()
    from public.network_monitors m
    where m.enabled
      and m.last_heartbeat_at < now() - interval '120 seconds'
      and not exists (
        select 1 from public.network_monitor_incidents i
        where i.monitor_id = m.id and i.recovered_at is null
      )
    on conflict do nothing
    returning id
  )
  insert into public.network_monitor_alerts(incident_id, kind)
  select id, 'outage' from new_incidents
  on conflict do nothing;
  get diagnostics created_count = row_count;

  with recovered as (
    update public.network_monitor_incidents i
       set recovered_at = now(), closed_reason = 'reconnected'
      from public.network_monitors m
     where i.monitor_id = m.id
       and m.enabled
       and i.recovered_at is null
       and m.last_heartbeat_at > i.detected_at
       and m.last_heartbeat_at >= now() - interval '120 seconds'
    returning i.id
  )
  insert into public.network_monitor_alerts(incident_id, kind)
  select id, 'recovery' from recovered
  on conflict do nothing;
  get diagnostics recovered_count = row_count;

  return created_count + recovered_count;
end;
$func$;

create or replace function public.network_monitor_claim_alerts(p_limit integer default 30)
returns table (
  alert_id uuid,
  alert_kind text,
  organization_slug text,
  hotel_id text,
  device_label text,
  last_heartbeat_at timestamptz,
  incident_started_at timestamptz,
  incident_detected_at timestamptz,
  incident_recovered_at timestamptz
)
language sql security invoker
set search_path = ''
as $func$
  with picked as (
    select a.id
    from public.network_monitor_alerts a
    join public.network_monitor_incidents i on i.id = a.incident_id
    join public.network_monitors m on m.id = i.monitor_id
    where m.enabled and (
      (a.status in ('pending','failed') and a.next_retry_at <= now())
      or (a.status = 'sending' and a.claimed_at < now() - interval '5 minutes')
    )
    order by a.created_at
    limit least(greatest(p_limit, 1), 100)
    for update of a skip locked
  ),
  claimed as (
    update public.network_monitor_alerts a
       set status='sending', claimed_at=now(), attempts=attempts + 1
     where a.id in (select id from picked)
    returning a.id, a.incident_id, a.kind
  )
  select c.id, c.kind, m.organization_slug, m.hotel_id, m.device_label,
         m.last_heartbeat_at, i.started_at, i.detected_at, i.recovered_at
    from claimed c
    join public.network_monitor_incidents i on i.id = c.incident_id
    join public.network_monitors m on m.id = i.monitor_id;
$func$;

revoke all on function public.network_monitor_prepare_alerts() from public, anon, authenticated;
revoke all on function public.network_monitor_claim_alerts(integer) from public, anon, authenticated;
grant execute on function public.network_monitor_prepare_alerts() to service_role;
grant execute on function public.network_monitor_claim_alerts(integer) to service_role;

-- This job is inert until NETWORK_MONITOR_WORKER_SECRET is configured both as
-- an Edge Function secret and as vault secret 'network_monitor_worker_secret'.
-- Only that narrow-purpose worker secret is sent through pg_net (not service_role).
select cron.schedule(
  'hotelcare-network-monitor-watchdog',
  '30 seconds',
  $job$
    select net.http_post(
      url := 'https://pcmszqqklkolvvlabohq.supabase.co/functions/v1/network-monitor-worker',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-worker-secret', coalesce(
          (select decrypted_secret from vault.decrypted_secrets
           where name = 'network_monitor_worker_secret' limit 1),
          'not-configured'
        )
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 15000
    );
  $job$
);
