-- Archive yesterday's rate calendar before the early-morning dashboard is viewed.
-- Previously the only run was 05:30 UTC (06:30 Budapest in winter), so
-- yesterday's three-day read-only columns appeared empty before that time.
--
-- 00:30 UTC = 01:30 CET / 02:30 CEST, after the Budapest business day ends.
-- Keep 05:30 UTC as a recovery pass for late-arriving source snapshots.
-- archive_revenue_calendar_days() is insert-only on conflict and cannot
-- overwrite historical prices or publish rates to Previo.

SELECT cron.alter_job(
  job_id := (
    SELECT jobid FROM cron.job
    WHERE jobname = 'revenue-calendar-history-daily'
  ),
  schedule := '30 0,5 * * *'
);

DO $verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM cron.job
    WHERE jobname = 'revenue-calendar-history-daily'
      AND schedule = '30 0,5 * * *'
      AND active = TRUE
  ) THEN
    RAISE EXCEPTION 'Rate calendar historical archive cron was not updated';
  END IF;
END;
$verify$;
