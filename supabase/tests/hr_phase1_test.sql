\set ON_ERROR_STOP on
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','90000000-0000-0000-0000-000000000001',true);
DO $$ BEGIN
  IF NOT public.is_hr_manager(auth.uid()) OR (SELECT count(*) FROM public.break_requests) <> 3 THEN RAISE EXCEPTION 'HR tenant read scope failed'; END IF;
  UPDATE public.break_requests SET reason='must not change' WHERE id='91000000-0000-0000-0000-000000000001';
  IF FOUND THEN RAISE EXCEPTION 'HR direct write succeeded'; END IF;
  PERFORM public.hr_decide_break_request('91000000-0000-0000-0000-000000000001','approved',NULL);
  IF NOT EXISTS (SELECT 1 FROM public.break_requests WHERE id='91000000-0000-0000-0000-000000000001' AND status='approved' AND approved_by=auth.uid()) THEN RAISE EXCEPTION 'HR decision failed'; END IF;
  BEGIN
    PERFORM public.hr_decide_break_request('91000000-0000-0000-0000-000000000002','approved',NULL);
    RAISE EXCEPTION 'Cross-tenant decision succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.hr_decide_break_request('91000000-0000-0000-0000-000000000003','approved',NULL);
    RAISE EXCEPTION 'Self decision succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','90000000-0000-0000-0000-000000000003',true);
DO $$ BEGIN
  IF NOT public.is_hr_manager(auth.uid()) THEN RAISE EXCEPTION 'Labelled HR not recognized'; END IF;
  DELETE FROM public.break_requests WHERE id='91000000-0000-0000-0000-000000000004';
  IF FOUND THEN RAISE EXCEPTION 'Labelled HR deleted break'; END IF;
  UPDATE public.break_requests SET reason='must not change' WHERE id='91000000-0000-0000-0000-000000000004';
  IF FOUND THEN RAISE EXCEPTION 'Labelled HR direct update succeeded'; END IF;
  PERFORM public.hr_decide_break_request('91000000-0000-0000-0000-000000000004','rejected','Fixture reason');
END $$;
SELECT set_config('request.jwt.claim.sub','90000000-0000-0000-0000-000000000002',true);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.break_requests) <> 1 THEN RAISE EXCEPTION 'Other HR tenant scope failed'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000009',true);
DO $$ BEGIN
  IF public.is_hr_manager(auth.uid()) THEN RAISE EXCEPTION 'Housekeeper got HR access'; END IF;
  BEGIN
    PERFORM public.hr_decide_break_request('91000000-0000-0000-0000-000000000001','approved',NULL);
    RAISE EXCEPTION 'Housekeeper decided break';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
DO $$ BEGIN
  IF public.is_hr_manager(auth.uid()) THEN RAISE EXCEPTION 'Manager got HR access'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
DO $$ BEGIN
  IF public.is_hr_manager(auth.uid()) THEN RAISE EXCEPTION 'Top management got HR helper'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000011',true);
DO $$ BEGIN
  IF NOT public.is_hr_manager(auth.uid()) THEN RAISE EXCEPTION 'Admin missing HR helper'; END IF;
END $$;
ROLLBACK;
