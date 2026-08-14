-- Legacy revenue cron safety cleanup.
-- 1) Remove duplicate/legacy price-decision schedules.
SELECT cron.unschedule('revenue-engine-decrease-12h');
SELECT cron.unschedule('revenue-autopilot-hourly');

-- 2) Keep the hourly engine tick, but rename + make it explicitly sync-only.
--    The deployed revenue-engine-tick only produces recommendations when the
--    caller passes generate_recommendations = true, which cron never does.
SELECT cron.unschedule('revenue-engine-30min');

SELECT cron.schedule(
  'revenue-previo-sync-hourly',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url:='https://pcmszqqklkolvvlabohq.supabase.co/functions/v1/revenue-engine-tick',
    headers:='{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBjbXN6cXFrbGtvbHZ2bGFib2hxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM4NjgxMDEsImV4cCI6MjA2OTQ0NDEwMX0.1PrIMW4wOXdmDNW6SrlBJa68H0k20n68hHy9PYOEvVo"}'::jsonb,
    body:='{"trigger":"sync_only"}'::jsonb
  ) AS request_id;
  $$
);