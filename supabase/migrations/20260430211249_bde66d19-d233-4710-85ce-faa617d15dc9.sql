-- Enable extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Seed revenue settings for RD Hotels
INSERT INTO public.hotel_revenue_settings (hotel_id, organization_slug)
VALUES
  ('mika-downtown', 'rdhotels'),
  ('memories-budapest', 'rdhotels'),
  ('gozsdu-court', 'rdhotels'),
  ('ottofiori', 'rdhotels')
ON CONFLICT (hotel_id) DO NOTHING;

-- Seed breakfast codes
INSERT INTO public.hotel_breakfast_codes (hotel_id, organization_slug, code)
VALUES
  ('mika-downtown',     'rdhotels', 'mika-2026'),
  ('memories-budapest', 'rdhotels', 'mem-2026'),
  ('gozsdu-court',      'rdhotels', 'gozsdu-2026'),
  ('ottofiori',         'rdhotels', 'otto-2026')
ON CONFLICT (hotel_id) DO NOTHING;

-- Schedule engine every 30 min (increase pass) and decrease pass twice a day
SELECT cron.schedule(
  'revenue-engine-30min',
  '*/30 * * * *',
  $$
  SELECT net.http_post(
    url:='https://pcmszqqklkolvvlabohq.supabase.co/functions/v1/revenue-engine-tick',
    headers:='{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBjbXN6cXFrbGtvbHZ2bGFib2hxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM4NjgxMDEsImV4cCI6MjA2OTQ0NDEwMX0.1PrIMW4wOXdmDNW6SrlBJa68H0k20n68hHy9PYOEvVo"}'::jsonb,
    body:='{"trigger":"cron"}'::jsonb
  ) AS request_id;
  $$
);

SELECT cron.schedule(
  'revenue-engine-decrease-12h',
  '0 */12 * * *',
  $$
  SELECT net.http_post(
    url:='https://pcmszqqklkolvvlabohq.supabase.co/functions/v1/revenue-engine-tick',
    headers:='{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBjbXN6cXFrbGtvbHZ2bGFib2hxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM4NjgxMDEsImV4cCI6MjA2OTQ0NDEwMX0.1PrIMW4wOXdmDNW6SrlBJa68H0k20n68hHy9PYOEvVo"}'::jsonb,
    body:='{"trigger":"decrease"}'::jsonb
  ) AS request_id;
  $$
);