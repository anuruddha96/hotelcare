
DO $$
DECLARE jid bigint;
BEGIN
  SELECT jobid INTO jid FROM cron.job WHERE jobname = 'previo-poll-checkouts-10min';
  IF jid IS NOT NULL THEN PERFORM cron.unschedule(jid); END IF;
  SELECT jobid INTO jid FROM cron.job WHERE jobname = 'previo-poll-checkouts-5min';
  IF jid IS NOT NULL THEN PERFORM cron.unschedule(jid); END IF;
END $$;

SELECT cron.schedule(
  'previo-poll-checkouts-5min',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://pcmszqqklkolvvlabohq.supabase.co/functions/v1/previo-poll-checkouts',
    headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBjbXN6cXFrbGtvbHZ2bGFib2hxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM4NjgxMDEsImV4cCI6MjA2OTQ0NDEwMX0.1PrIMW4wOXdmDNW6SrlBJa68H0k20n68hHy9PYOEvVo"}'::jsonb,
    body := '{"trigger":"cron"}'::jsonb
  );
  $$
);
