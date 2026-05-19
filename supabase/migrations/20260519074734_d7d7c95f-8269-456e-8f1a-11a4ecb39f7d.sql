
-- Retention: purge old Previo-synced daily overview rows (>540 days)
CREATE OR REPLACE FUNCTION public.purge_old_daily_overview_snapshots()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  removed integer;
BEGIN
  DELETE FROM public.daily_overview_snapshots
   WHERE source = 'previo'
     AND business_date < (CURRENT_DATE - INTERVAL '540 days');
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;

-- Schedule daily at 03:15 UTC (extension already enabled by previous cron jobs)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid)
      FROM cron.job
     WHERE jobname = 'purge-daily-overview-snapshots';
    PERFORM cron.schedule(
      'purge-daily-overview-snapshots',
      '15 3 * * *',
      $cron$ SELECT public.purge_old_daily_overview_snapshots(); $cron$
    );
  END IF;
END $$;
