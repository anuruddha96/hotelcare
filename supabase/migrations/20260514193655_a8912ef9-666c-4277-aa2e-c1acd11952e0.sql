SELECT cron.schedule(
  'revenue-autopilot-hourly',
  '0 * * * *',
  $$select net.http_post(
    url:='https://pcmszqqklkolvvlabohq.supabase.co/functions/v1/revenue-autopilot-tick',
    headers:='{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBjbXN6cXFrbGtvbHZ2bGFib2hxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM4NjgxMDEsImV4cCI6MjA2OTQ0NDEwMX0.1PrIMW4wOXdmDNW6SrlBJa68H0k20n68hHy9PYOEvVo"}'::jsonb,
    body:='{"trigger":"cron"}'::jsonb
  ) as request_id;$$
);