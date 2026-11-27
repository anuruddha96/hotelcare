-- REVIEW / production rollout only. Must be in the same migration as
-- hr-attendance-rd-backend.review.sql after scratch tests and preflight.
-- Preserve the existing daily cron and behavior for non-RD tenants.
CREATE OR REPLACE FUNCTION public.run_auto_signout()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
DECLARE n integer;
BEGIN
 UPDATE public.staff_attendance sa
 SET check_out_time=(sa.work_date+time '16:30')::timestamptz,status='auto_signout',
 total_hours=greatest(0,round(extract(epoch from ((sa.work_date+time '16:30')::timestamptz-sa.check_in_time))/3600.0-coalesce(sa.break_duration,0)/60.0,2)),
 notes='Auto signed out',updated_at=now()
 WHERE sa.organization_slug IS DISTINCT FROM 'rdhotels' AND sa.work_date=CURRENT_DATE
 AND sa.status IN ('checked_in','on_break') AND sa.check_out_time IS NULL;
 GET DIAGNOSTICS n=ROW_COUNT; RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.run_auto_signout() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.run_auto_signout() TO service_role;
-- Named scheduling is idempotent and uses the Budapest-aware SQL cutoff,
-- independent of the cron host timezone. No historical catch-up.
SELECT cron.schedule('rd-attendance-auto-signout-budapest','* * * * *','SELECT public.run_rd_attendance_auto_signout();');
