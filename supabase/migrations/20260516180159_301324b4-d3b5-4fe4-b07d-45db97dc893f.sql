
-- Ensure required extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove any prior version of this job
DO $$
BEGIN
  PERFORM cron.unschedule('previo-poll-checkouts-10min');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'previo-poll-checkouts-10min',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://pcmszqqklkolvvlabohq.supabase.co/functions/v1/previo-poll-checkouts',
    headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBjbXN6cXFrbGtvbHZ2bGFib2hxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM4NjgxMDEsImV4cCI6MjA2OTQ0NDEwMX0.1PrIMW4wOXdmDNW6SrlBJa68H0k20n68hHy9PYOEvVo"}'::jsonb,
    body := jsonb_build_object('triggered_at', now(), 'source', 'cron')
  );
  $$
);
