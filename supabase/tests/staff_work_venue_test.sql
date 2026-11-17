\set ON_ERROR_STOP on

DO $assert$
BEGIN
  IF has_function_privilege('anon','public.staff_select_work_hotel(text,boolean)'::regprocedure,'EXECUTE')
  THEN RAISE EXCEPTION 'anon can switch hotels'; END IF;
  IF NOT has_function_privilege('authenticated','public.staff_select_work_hotel(text,boolean)'::regprocedure,'EXECUTE')
  THEN RAISE EXCEPTION 'authenticated cannot select a hotel'; END IF;
  IF has_table_privilege('authenticated','public.staff_work_venue_state','UPDATE')
  THEN RAISE EXCEPTION 'staff can bypass state updater'; END IF;
END;
$assert$;

SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',false);
SET ROLE authenticated;
SELECT public.staff_select_work_hotel('ottofiori',false);

DO $test$
DECLARE s public.staff_work_venue_state%ROWTYPE;
BEGIN
  SELECT * INTO s FROM public.staff_work_venue_state
  WHERE user_id = auth.uid();
  IF s.home_hotel <> 'memories-budapest' OR s.last_worked_hotel <> 'ottofiori'
     OR s.prompt_next_day IS DISTINCT FROM true
     OR s.last_switched_on <> (now() AT TIME ZONE 'Europe/Budapest')::date THEN
    RAISE EXCEPTION 'Temporary venue selection or next-day prompt not persisted';
  END IF;
  IF (SELECT assigned_hotel FROM public.profiles WHERE id = auth.uid()) <> 'ottofiori'
  THEN RAISE EXCEPTION 'Current hotel was not updated'; END IF;
  IF (SELECT COUNT(*) FROM public.staff_work_venue_state) <> 1
  THEN RAISE EXCEPTION 'Worker accessed another user venue state'; END IF;
END;
$test$;

DO $test$
DECLARE denied boolean := false;
BEGIN
  BEGIN PERFORM public.staff_select_work_hotel('other-hotel',false);
  EXCEPTION WHEN SQLSTATE '42501' THEN denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Cross-organization hotel switch was allowed'; END IF;

  denied := false;
  BEGIN PERFORM public.staff_select_work_hotel('inactive',false);
  EXCEPTION WHEN SQLSTATE '42501' THEN denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Inactive hotel selection was allowed'; END IF;

  denied := false;
  BEGIN UPDATE public.profiles SET assigned_hotel='other-hotel' WHERE id = auth.uid();
  EXCEPTION WHEN SQLSTATE '42501' THEN denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Direct profile hotel bypass was allowed'; END IF;

  denied := false;
  BEGIN UPDATE public.profiles SET organization_slug='otherorg' WHERE id = auth.uid();
  EXCEPTION WHEN SQLSTATE '42501' THEN denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Own organization escalation was allowed'; END IF;

  denied := false;
  BEGIN UPDATE public.profiles SET role='admin' WHERE id = auth.uid();
  EXCEPTION WHEN SQLSTATE '42501' THEN denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Own role escalation was allowed'; END IF;
END;
$test$;

-- Returning to the home hotel must clear the next-day prompt.
SELECT public.staff_select_work_hotel('memories-budapest',false);
DO $test$
BEGIN
  IF (SELECT prompt_next_day FROM public.staff_work_venue_state WHERE user_id=auth.uid())
  THEN RAISE EXCEPTION 'Return to usual hotel still prompts tomorrow'; END IF;
  IF (SELECT home_hotel FROM public.staff_work_venue_state WHERE user_id=auth.uid()) <> 'memories-budapest'
  THEN RAISE EXCEPTION 'Home hotel unexpectedly overwritten'; END IF;
END;
$test$;

RESET ROLE;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',false);
SET ROLE authenticated;
SELECT public.staff_select_work_hotel('ottofiori',false);
SELECT public.staff_select_work_hotel('ottofiori',true);
DO $test$
BEGIN
  IF (SELECT prompt_next_day FROM public.staff_work_venue_state WHERE user_id=auth.uid())
  THEN RAISE EXCEPTION 'Confirming same venue did not clear reminder'; END IF;
  IF (SELECT COUNT(*) FROM public.staff_work_venue_state) <> 1
  THEN RAISE EXCEPTION 'Housekeeper could read another worker venue'; END IF;
END;
$test$;
RESET ROLE;

SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000004',false);
SET ROLE authenticated;
SELECT public.staff_select_work_hotel('ottofiori',false);
RESET ROLE;
