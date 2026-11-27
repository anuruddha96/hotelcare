BEGIN;
DO $$ BEGIN
 IF attendance_internal.rd_cutoff('10000000-0000-0000-0000-000000000001','2026-11-27','2026-11-27 07:00+00') IS DISTINCT FROM '2026-11-27 16:00+00'::timestamptz THEN RAISE EXCEPTION 'Winter cutoff'; END IF;
 IF attendance_internal.rd_cutoff('10000000-0000-0000-0000-000000000001','2026-07-27','2026-07-27 06:00+00') IS DISTINCT FROM '2026-07-27 15:00+00'::timestamptz THEN RAISE EXCEPTION 'Summer cutoff'; END IF;
 IF attendance_internal.rd_cutoff('10000000-0000-0000-0000-000000000002','2026-11-27','2026-11-27 11:00+00') IS DISTINCT FROM '2026-11-27 19:30+00'::timestamptz THEN RAISE EXCEPTION 'Published extension'; END IF;
 IF attendance_internal.rd_cutoff('10000000-0000-0000-0000-000000000003','2026-11-26','2026-11-26 19:00+00') IS DISTINCT FROM '2026-11-27 07:00+00'::timestamptz THEN RAISE EXCEPTION 'Overnight published snapshot'; END IF;
 IF attendance_internal.rd_cutoff('10000000-0000-0000-0000-000000000003','2026-11-27','2026-11-27 07:00+00') IS NOT NULL THEN RAISE EXCEPTION 'Unscheduled reception'; END IF;
 IF attendance_internal.rd_cutoff('10000000-0000-0000-0000-000000000001','2026-11-27','2026-11-27 17:00+00') IS NOT NULL THEN RAISE EXCEPTION 'Late start'; END IF;
 IF attendance_internal.rd_cutoff('10000000-0000-0000-0000-000000000005','2026-11-27','2026-11-27 07:00+00') IS NOT NULL THEN RAISE EXCEPTION 'Foreign employee'; END IF;
 IF NOT attendance_internal.rd_overnight_active('10000000-0000-0000-0000-000000000003','2026-11-26','2026-11-26 19:00+00','2026-11-27 03:00+00') THEN RAISE EXCEPTION 'Active overnight shift lost'; END IF;
 IF attendance_internal.rd_overnight_active('10000000-0000-0000-0000-000000000003','2026-11-26','2026-11-26 19:00+00','2026-11-27 08:00+00') THEN RAISE EXCEPTION 'Expired overnight shift is still live'; END IF;
 IF attendance_internal.rd_overnight_active('10000000-0000-0000-0000-000000000001','2026-11-26','2026-11-26 07:00+00','2026-11-27 03:00+00') THEN RAISE EXCEPTION 'Old daytime shift appears active'; END IF;
 IF has_function_privilege('authenticated','public.run_rd_attendance_auto_signout()','EXECUTE') OR has_function_privilege('anon','public.rd_attendance_forgot_checkout(uuid)','EXECUTE') THEN RAISE EXCEPTION 'Bad RPC grant'; END IF;
END $$;
INSERT INTO public.staff_attendance(id,user_id,organization_slug,work_date,check_in_time,status,break_duration) VALUES
 ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','rdhotels','2026-11-27','2026-11-27 07:00+00','checked_in',30),
 ('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','rdhotels','2026-11-27','2026-11-27 11:00+00','checked_in',0),
 ('30000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003','rdhotels','2026-11-26','2026-11-26 19:00+00','checked_in',0),
 ('30000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000004','rdhotels','2026-11-27','2026-11-27 07:00+00','on_break',15),
 ('30000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000005','slnt','2026-11-27','2026-11-27 07:00+00','checked_in',0),
 ('30000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000001','rdhotels','2026-10-01','2026-10-01 06:00+00','checked_in',0),
 ('30000000-0000-0000-0000-000000000007','10000000-0000-0000-0000-000000000007','rdhotels','2026-11-27','2026-11-27 07:00+00','checked_in',0);
UPDATE public.staff_attendance SET break_started_at='2026-11-27 15:45+00' WHERE id='30000000-0000-0000-0000-000000000004';
INSERT INTO public.early_signout_requests VALUES('30000000-0000-0000-0000-000000000007','rdhotels','pending');
DO $$ BEGIN
 IF attendance_internal.rd_close_due('scheduler',NULL,NULL,'2026-11-27 15:59+00')<>0 THEN RAISE EXCEPTION 'Early close'; END IF;
 IF attendance_internal.rd_close_due('scheduler',NULL,NULL,'2026-11-27 16:00+00')<>2 THEN RAISE EXCEPTION 'Wrong daily closure count'; END IF;
 IF attendance_internal.rd_close_due('scheduler',NULL,NULL,'2026-11-27 16:01+00')<>0 THEN RAISE EXCEPTION 'Non-idempotent closure'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.staff_attendance WHERE id='30000000-0000-0000-0000-000000000001' AND status='auto_signout' AND total_hours=8.5 AND check_out_time='2026-11-27 16:00+00') THEN RAISE EXCEPTION 'Auto status or net hours'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.staff_attendance WHERE id='30000000-0000-0000-0000-000000000004' AND status='auto_signout' AND break_duration=30 AND break_ended_at='2026-11-27 16:00+00') THEN RAISE EXCEPTION 'Open break'; END IF;
 IF EXISTS(SELECT 1 FROM public.staff_attendance WHERE id IN ('30000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000003','30000000-0000-0000-0000-000000000005','30000000-0000-0000-0000-000000000006','30000000-0000-0000-0000-000000000007') AND check_out_time IS NOT NULL) THEN RAISE EXCEPTION 'Protected row changed'; END IF;
 IF (SELECT count(*) FROM public.rd_attendance_auto_checkout_events)<>2 THEN RAISE EXCEPTION 'Audit missing or duplicate'; END IF;
 IF attendance_internal.rd_close_due('scheduler',NULL,NULL,'2026-11-27 19:30+00')<>1 THEN RAISE EXCEPTION 'Extended shift due'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
SET LOCAL ROLE authenticated;
INSERT INTO public.staff_attendance(id,user_id,organization_slug,check_in_time,status,work_hotel_id) VALUES('30000000-0000-0000-0000-000000000008','10000000-0000-0000-0000-000000000001','rdhotels',now(),'checked_in','foreign');
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.staff_attendance WHERE id='30000000-0000-0000-0000-000000000008' AND work_hotel_id='mika-downtown' AND work_date=(now() AT TIME ZONE 'Europe/Budapest')::date) THEN RAISE EXCEPTION 'Property snapshot not canonical'; END IF;
 BEGIN UPDATE public.staff_attendance SET work_hotel_id='foreign' WHERE id='30000000-0000-0000-0000-000000000008'; RAISE EXCEPTION 'Mutable snapshot'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN UPDATE public.staff_attendance SET check_out_time='2026-11-27 17:00+00' WHERE id='30000000-0000-0000-0000-000000000001'; RAISE EXCEPTION 'Closed session editable'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 IF EXISTS(SELECT 1 FROM public.rd_attendance_auto_checkout_events) THEN RAISE EXCEPTION 'Ordinary staff audit disclosure'; END IF;
 IF EXISTS(SELECT 1 FROM public.rd_hr_active_overnight_ids()) THEN RAISE EXCEPTION 'Non-HR overnight disclosure'; END IF;
END $$;
RESET ROLE;
INSERT INTO public.hotel_configurations VALUES('ottofiori','Ottofiori','aaaaaaaa-0000-0000-0000-000000000001',true);
UPDATE public.profiles SET assigned_hotel='ottofiori' WHERE id='10000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
INSERT INTO public.staff_attendance(id,user_id,organization_slug,check_in_time,status,work_hotel_id) VALUES('30000000-0000-0000-0000-000000000009','10000000-0000-0000-0000-000000000001','rdhotels',now(),'checked_in','mika-downtown');
DO $ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.staff_attendance WHERE id='30000000-0000-0000-0000-000000000009' AND work_hotel_id='ottofiori') THEN RAISE EXCEPTION 'New switched work property not captured'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.staff_attendance WHERE id='30000000-0000-0000-0000-000000000008' AND work_hotel_id='mika-downtown') THEN RAISE EXCEPTION 'Prior property changed'; END IF;
END $;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000006',true);
DO $$ BEGIN IF (SELECT count(*) FROM public.rd_attendance_auto_checkout_events)<>3 THEN RAISE EXCEPTION 'HR audit inaccessible'; END IF; END $$;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000005',true);
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.rd_attendance_auto_checkout_events) THEN RAISE EXCEPTION 'Foreign audit disclosure'; END IF; END $$;
ROLLBACK;
