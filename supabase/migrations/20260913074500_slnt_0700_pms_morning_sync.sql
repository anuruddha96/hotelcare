-- Daily SLNT server-side PMS synchronization.
--
-- The cron runs across both possible UTC hours that map to 07:00 in Budapest
-- (CET/CEST). The Edge Function performs the authoritative Europe/Budapest
-- local-time gate, so only the 07:00 local window does work.
--
-- Active SLNT Previo accounts are ordered by label and processed one at a time:
--   slot 0 -> 07:00 Budapest
--   slot 1 -> 07:05 Budapest
--   ...future accounts continue every five minutes.
--
-- This is intentionally separate from RD Hotels' 06:00 morning PMS warm-up.

do $$
declare
  existing_job bigint;
begin
  select jobid into existing_job
  from cron.job
  where jobname = 'hotelcare-slnt-pms-morning-sync'
  limit 1;

  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;
end $$;

select cron.schedule(
  'hotelcare-slnt-pms-morning-sync',
  '*/5 5-6 * * *',
  $cron$
    select net.http_post(
      url := 'https://pcmszqqklkolvvlabohq.supabase.co/functions/v1/slnt-pms-morning-sync',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-worker-secret', public.get_housekeeping_release_worker_secret()
      ),
      body := jsonb_build_object(
        'mode', 'scheduled',
        'trigger', 'cron',
        'scheduled_at', now()
      ),
      timeout_milliseconds := 60000
    ) as request_id;
  $cron$
);
