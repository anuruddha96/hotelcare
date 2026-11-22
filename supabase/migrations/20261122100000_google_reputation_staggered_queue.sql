-- One Google Business location at a time, evenly spaced through 180 minutes.
-- With ten connected active venues, they are dispatched at minute 0,18,...162.
-- This is a one-minute DB cron check but creates HTTP requests ONLY at due slots.
-- IDs are stable by UUID order; adding/removing a venue rebalances future slots.
-- Keep the existing private Vault secret and per-venue reply authorization.
DO $$
DECLARE existing_job bigint;
BEGIN
  FOR existing_job IN SELECT jobid FROM cron.job
    WHERE jobname IN (
      'google-reputation-worker-15min',
      'google-reputation-round-robin-2min',
      'google-reputation-worker-3h',
      'google-reputation-staggered-queue-1min'
    )
  LOOP
    PERFORM cron.unschedule(existing_job);
  END LOOP;
END $$;

SELECT cron.schedule(
  'google-reputation-staggered-queue-1min',
  '* * * * *',
  $cron$
  WITH active_locations AS (
    SELECT l.id,
      (row_number() OVER (ORDER BY l.id) - 1)::bigint AS queue_index,
      count(*) OVER ()::bigint AS venue_count
    FROM public.google_business_locations l
    JOIN public.google_business_connections c ON c.id = l.connection_id
    WHERE l.is_active = true AND c.status = 'active'
  ),
  cycle AS (
    SELECT (floor(extract(epoch FROM now()) / 60)::bigint % 180) AS minute_of_cycle
  ),
  due AS (
    SELECT l.id, l.queue_index, l.venue_count
    FROM active_locations l CROSS JOIN cycle c
    WHERE l.venue_count BETWEEN 1 AND 180
      AND l.queue_index = floor(c.minute_of_cycle::numeric * l.venue_count / 180)::bigint
      AND (
        c.minute_of_cycle = 0
        OR l.queue_index <> floor((c.minute_of_cycle - 1)::numeric * l.venue_count / 180)::bigint
      )
  )
  SELECT net.http_post(
    url := 'https://pcmszqqklkolvvlabohq.supabase.co/functions/v1/google-reputation-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-worker-secret', public.get_google_reputation_worker_secret()
    ),
    body := jsonb_build_object(
      'trigger', 'cron',
      'mode', 'queued_location',
      'location_id', due.id,
      'queue_index', due.queue_index,
      'queue_total', due.venue_count,
      'scheduled_at', now()
    )
  ) AS request_id
  FROM due;
  $cron$
);
