
CREATE OR REPLACE FUNCTION public.run_auto_signout()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer;
BEGIN
  UPDATE public.staff_attendance sa
  SET check_out_time = (sa.work_date + time '16:30')::timestamptz,
      status = 'auto_signout',
      total_hours = GREATEST(
        0,
        ROUND(
          (EXTRACT(EPOCH FROM ((sa.work_date + time '16:30')::timestamptz - sa.check_in_time)) / 3600.0)
          - (COALESCE(sa.break_duration, 0) / 60.0)
        , 2)
      ),
      notes = 'Auto signed out',
      updated_at = now()
  WHERE sa.work_date = CURRENT_DATE
    AND sa.status IN ('checked_in', 'on_break')
    AND sa.check_out_time IS NULL;

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.run_auto_signout() FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.run_auto_signout() TO service_role;

SELECT cron.unschedule('auto-signout-daily')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto-signout-daily');

SELECT cron.schedule('auto-signout-daily', '50 23 * * *', $$SELECT public.run_auto_signout();$$);
