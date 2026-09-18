-- Each physical Previo hotel and each active SLNT Previo account is claimed once
-- per Budapest business day. Do not change the independent pre-release PMS
-- preflight, checkout polling, or revenue-engine schedules.
create table if not exists public.pms_morning_sync_runs (
  business_date date not null,
  target_key text not null,
  slot integer not null check (slot between 0 and 17),
  status text not null check (status in ('running', 'success', 'partial', 'failed')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  error_message text,
  result jsonb not null default '{}'::jsonb,
  primary key (business_date, target_key)
);

alter table public.pms_morning_sync_runs enable row level security;
revoke all on public.pms_morning_sync_runs from public, anon, authenticated;
grant select, insert, update on public.pms_morning_sync_runs to service_role;
create index if not exists pms_morning_sync_runs_status_idx
  on public.pms_morning_sync_runs (business_date desc, status);

-- Avoid a duplicate morning run from the previous independent five-minute
-- RD and SLNT schedules. Only these two jobs are replaced.
do $$
declare current_job record;
begin
  for current_job in
    select jobid from cron.job where jobname in (
      'hotelcare-housekeeping-pms-morning-warmup',
      'hotelcare-slnt-pms-morning-sync',
      'hotelcare-pms-morning-sequence'
    )
  loop
    perform cron.unschedule(current_job.jobid);
  end loop;
end $$;

-- pg_cron uses UTC. 04:00-08:59 UTC covers 06:00-08:59 Europe/Budapest
-- in both summer and winter; the protected worker checks actual local time.
-- A single invocation processes exactly one venue/account, per ten-minute slot.
select cron.schedule(
  'hotelcare-pms-morning-sequence',
  '*/10 4-8 * * *',
  $cron$
    select net.http_post(
      url := 'https://pcmszqqklkolvvlabohq.supabase.co/functions/v1/hotelcare-pms-morning-sequence',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-worker-secret', public.get_housekeeping_release_worker_secret()
      ),
      body := jsonb_build_object('trigger', 'cron', 'scheduled_at', now()),
      timeout_milliseconds := 120000
    ) as request_id;
  $cron$
);
