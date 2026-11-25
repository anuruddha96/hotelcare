BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','90000000-0000-0000-0000-000000000001',true);
DO $$ DECLARE s json; BEGIN
 s:=public.get_attendance_summary_secure(NULL,'2025-11-01','2025-11-03');
 IF (s->>'total_days')::int<>3 OR (s->>'scheduled_days')::int<>1 OR (s->>'punctual_days')::int<>1 OR (s->>'no_schedule_days')::int<>2 THEN RAISE EXCEPTION 'Wrong summary %',s; END IF;
 IF (SELECT count(*) FROM public.hr_attendance_open_records())<>2 THEN RAISE EXCEPTION 'Wrong open scope'; END IF;
 PERFORM public.attendance_correct('92000000-0000-0000-0000-000000000001','2025-11-04 07:00+00','2025-11-04 15:00+00',30,'checked_out','Fixture correction');
 IF NOT EXISTS(SELECT 1 FROM public.attendance_corrections WHERE action='correct' AND (after_values->>'total_hours')::numeric=7.5) THEN RAISE EXCEPTION 'Audit missing'; END IF;
 BEGIN PERFORM public.attendance_delete('92000000-0000-0000-0000-000000000002','cross tenant'); RAISE EXCEPTION 'Cross-tenant delete allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.attendance_delete('92000000-0000-0000-0000-000000000003','self'); RAISE EXCEPTION 'Self delete allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.attendance_delete('92000000-0000-0000-0000-000000000001',''); RAISE EXCEPTION 'Empty reason allowed'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 PERFORM public.attendance_manual_add('10000000-0000-0000-0000-000000000009','2025-11-05','2025-11-05 07:00+00','2025-11-05 15:00+00',0,'test','manual fixture');
 PERFORM public.attendance_delete('92000000-0000-0000-0000-000000000001','fixture delete');
 IF (SELECT count(*) FROM public.attendance_corrections)<>3 THEN RAISE EXCEPTION 'Audit count wrong'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','90000000-0000-0000-0000-000000000002',true);
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.attendance_corrections) THEN RAISE EXCEPTION 'Audit cross-org read'; END IF; END $$;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000009',true);
DO $$ BEGIN
 BEGIN PERFORM public.attendance_delete('92000000-0000-0000-0000-000000000003','staff'); RAISE EXCEPTION 'Staff delete allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 IF EXISTS(SELECT 1 FROM public.attendance_corrections) THEN RAISE EXCEPTION 'Staff audit read'; END IF;
END $$;
ROLLBACK;
