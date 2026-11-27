BEGIN;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM cron.job WHERE jobname='rd-attendance-auto-signout-budapest' AND schedule='* * * * *' AND command='SELECT public.run_rd_attendance_auto_signout();') THEN RAISE EXCEPTION 'Missing RD cron registration'; END IF;
 IF NOT EXISTS(SELECT 1 FROM cron.job WHERE jobname='auto-signout-daily' AND schedule='50 23 * * *') THEN RAISE EXCEPTION 'Legacy cron modified'; END IF;
 IF has_function_privilege('authenticated','public.run_auto_signout()','execute') OR has_function_privilege('anon','public.run_auto_signout()','execute') THEN RAISE EXCEPTION 'Unsafe legacy cron grants'; END IF;
END $$;
INSERT INTO public.staff_attendance(id,user_id,organization_slug,work_date,check_in_time,status,break_duration) VALUES
 ('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','rdhotels',current_date,current_date+time '07:00','checked_in',0),
 ('40000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000005','slnt',current_date,current_date+time '07:00','checked_in',0);
DO $$ BEGIN
 IF public.run_auto_signout()<>1 THEN RAISE EXCEPTION 'Legacy job did not close precisely the non-RD record'; END IF;
 IF EXISTS(SELECT 1 FROM public.staff_attendance WHERE id='40000000-0000-0000-0000-000000000001' AND check_out_time IS NOT NULL) THEN RAISE EXCEPTION 'Legacy job closed RD record'; END IF;
END $$;
ROLLBACK;
