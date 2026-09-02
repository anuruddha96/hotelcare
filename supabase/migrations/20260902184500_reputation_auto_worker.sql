alter table public.google_business_locations
  add column if not exists auto_reply_enabled_at timestamptz;

create table if not exists public.google_reputation_worker_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running','completed','partial','failed')),
  connections_checked integer not null default 0,
  locations_checked integer not null default 0,
  reviews_synced integer not null default 0,
  drafts_generated integer not null default 0,
  replies_published integer not null default 0,
  errors jsonb not null default '[]'::jsonb
);

alter table public.google_reputation_worker_runs enable row level security;
revoke all on public.google_reputation_worker_runs from anon, authenticated;

comment on table public.google_reputation_worker_runs is 'Server-only heartbeat and outcome log for the scheduled Google Reputation review processor.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'google_reputation_worker_secret') THEN
    PERFORM vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'google_reputation_worker_secret',
      'Secret used only by pg_cron to authenticate the HotelCare Google Reputation background worker'
    );
  END IF;
END $$;

create or replace function public.get_google_reputation_worker_secret()
returns text
language sql
security definer
set search_path = public, vault
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name = 'google_reputation_worker_secret'
  limit 1;
$$;

revoke all on function public.get_google_reputation_worker_secret() from public, anon, authenticated;
grant execute on function public.get_google_reputation_worker_secret() to service_role;

DO $$
DECLARE
  existing_job bigint;
BEGIN
  SELECT jobid INTO existing_job FROM cron.job WHERE jobname = 'google-reputation-worker-15min' LIMIT 1;
  IF existing_job IS NOT NULL THEN
    PERFORM cron.unschedule(existing_job);
  END IF;
END $$;

select cron.schedule(
  'google-reputation-worker-15min',
  '*/15 * * * *',
  $cron$
  select net.http_post(
    url := 'https://pcmszqqklkolvvlabohq.supabase.co/functions/v1/google-reputation-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-worker-secret', public.get_google_reputation_worker_secret()
    ),
    body := jsonb_build_object('trigger', 'cron', 'scheduled_at', now())
  ) as request_id;
  $cron$
);
