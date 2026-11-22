-- Review each active Google Business listing once every three hours.
-- Replaces the 2-minute one-location round-robin schedule. Every eligible
-- 4-5 star low-risk review is drafted and answered by the authenticated worker;
-- old reviews and 1-3 star reviews still require manager approval.
-- Safe to reapply; preserves the private Vault-backed cron authentication.
DO $$
DECLARE
  existing_job bigint;
BEGIN
  FOR existing_job IN
    SELECT jobid FROM cron.job
    WHERE jobname IN (
      'google-reputation-worker-15min',
      'google-reputation-round-robin-2min',
      'google-reputation-worker-3h'
    )
  LOOP
    PERFORM cron.unschedule(existing_job);
  END LOOP;
END $$;

SELECT cron.schedule(
  'google-reputation-worker-3h',
  '0 */3 * * *',
  $cron$
    SELECT net.http_post(
      url := 'https://pcmszqqklkolvvlabohq.supabase.co/functions/v1/google-reputation-worker',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-worker-secret', public.get_google_reputation_worker_secret()
      ),
      body := jsonb_build_object(
        'trigger', 'cron',
        'mode', 'all',
        'scheduled_at', now()
      )
    ) AS request_id;
  $cron$
);
