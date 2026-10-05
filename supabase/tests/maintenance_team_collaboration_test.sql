\set ON_ERROR_STOP on
DO $security$
BEGIN
  IF has_function_privilege(
    'anon',
    'public.work_maintenance_ticket(uuid,text,text,timestamp with time zone,text,text)'::regprocedure,
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Anonymous role can execute maintenance collaboration RPC';
  END IF;
  IF NOT has_function_privilege(
    'authenticated',
    'public.work_maintenance_ticket(uuid,text,text,timestamp with time zone,text,text)'::regprocedure,
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Authenticated role cannot execute maintenance collaboration RPC';
  END IF;
  IF has_function_privilege(
    'anon',
    'public.get_maintenance_property_teammates()'::regprocedure,
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Anonymous role can execute maintenance teammate lookup';
  END IF;
  IF NOT has_function_privilege(
    'authenticated',
    'public.get_maintenance_property_teammates()'::regprocedure,
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Authenticated role cannot execute maintenance teammate lookup';
  END IF;
END;
$security$;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', false);
SET ROLE authenticated;

DO $team$
BEGIN
  IF (SELECT count(*) FROM public.get_maintenance_property_teammates()) <> 2 THEN
    RAISE EXCEPTION 'Property teammate lookup returned the wrong number of users';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.get_maintenance_property_teammates()
    WHERE id='00000000-0000-4000-8000-000000000001' AND full_name='Worker One'
  ) THEN
    RAISE EXCEPTION 'Assigned teammate is missing from property lookup';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.get_maintenance_property_teammates()
    WHERE id IN (
      '00000000-0000-4000-8000-000000000003',
      '00000000-0000-4000-8000-000000000004'
    )
  ) THEN
    RAISE EXCEPTION 'Property teammate lookup leaked another hotel or organization';
  END IF;
END;
$team$;

SELECT public.work_maintenance_ticket(
  '00000000-0000-4000-8000-000000000010',
  'start',
  NULL,
  '2026-10-05T06:30:00Z',
  NULL,
  NULL
);

DO $test$
DECLARE t public.tickets%ROWTYPE;
BEGIN
  SELECT * INTO t FROM public.tickets WHERE id='00000000-0000-4000-8000-000000000010';
  IF t.status <> 'in_progress' OR t.assigned_to <> '00000000-0000-4000-8000-000000000001' THEN
    RAISE EXCEPTION 'Same-property teammate start did not preserve assignment';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.comments c
    WHERE c.ticket_id=t.id
      AND c.user_id='00000000-0000-4000-8000-000000000002'
      AND c.content LIKE '%Assisting ticket assigned to Worker One%'
      AND c.content LIKE '%Work started%'
  ) THEN
    RAISE EXCEPTION 'Same-property teammate action was not auditable';
  END IF;
END;
$test$;

SELECT public.work_maintenance_ticket(
  '00000000-0000-4000-8000-000000000011',
  'hold',
  'Need replacement part',
  '2026-10-05T06:31:00Z',
  'parts_pending',
  NULL
);

DO $test$
DECLARE t public.tickets%ROWTYPE;
BEGIN
  SELECT * INTO t FROM public.tickets WHERE id='00000000-0000-4000-8000-000000000011';
  IF t.on_hold IS DISTINCT FROM true OR t.hold_reason <> 'parts_pending'
     OR t.assigned_to <> '00000000-0000-4000-8000-000000000001' THEN
    RAISE EXCEPTION 'Shared ticket hold failed or reassigned ticket';
  END IF;
END;
$test$;

SELECT public.work_maintenance_ticket(
  '00000000-0000-4000-8000-000000000011',
  'resume',
  NULL,
  (SELECT updated_at FROM public.tickets WHERE id='00000000-0000-4000-8000-000000000011'),
  NULL,
  NULL
);

SELECT public.work_maintenance_ticket(
  '00000000-0000-4000-8000-000000000011',
  'submit',
  'Replaced the failed part and tested operation.',
  (SELECT updated_at FROM public.tickets WHERE id='00000000-0000-4000-8000-000000000011'),
  NULL,
  '00000000-0000-4000-8000-000000000011/completion-test.jpg'
);

DO $test$
DECLARE t public.tickets%ROWTYPE;
BEGIN
  SELECT * INTO t FROM public.tickets WHERE id='00000000-0000-4000-8000-000000000011';
  IF t.pending_supervisor_approval IS DISTINCT FROM true
     OR t.resolution_text <> 'Replaced the failed part and tested operation.'
     OR t.completion_photos[1] <> '00000000-0000-4000-8000-000000000011/completion-test.jpg'
     OR t.assigned_to <> '00000000-0000-4000-8000-000000000001' THEN
    RAISE EXCEPTION 'Shared completion submission failed or changed assignment';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.comments c
    WHERE c.ticket_id=t.id
      AND c.user_id='00000000-0000-4000-8000-000000000002'
      AND c.content LIKE '%Completion submitted for supervisor approval%'
  ) THEN
    RAISE EXCEPTION 'Completion submission audit is missing';
  END IF;
END;
$test$;

DO $test$
DECLARE denied boolean;
BEGIN
  denied := false;
  BEGIN
    PERFORM public.work_maintenance_ticket(
      '00000000-0000-4000-8000-000000000012','start',NULL,'2026-10-05T06:32:00Z',NULL,NULL
    );
  EXCEPTION WHEN SQLSTATE '42501' THEN denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Cross-property update was not denied'; END IF;

  denied := false;
  BEGIN
    PERFORM public.work_maintenance_ticket(
      '00000000-0000-4000-8000-000000000013','start',NULL,'2026-10-05T06:33:00Z',NULL,NULL
    );
  EXCEPTION WHEN SQLSTATE '42501' THEN denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Cross-organization update was not denied'; END IF;

  denied := false;
  BEGIN
    PERFORM public.work_maintenance_ticket(
      '00000000-0000-4000-8000-000000000010','resume',NULL,'2026-10-05T06:30:00Z',NULL,NULL
    );
  EXCEPTION WHEN SQLSTATE '40001' THEN denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Stale concurrent update was not denied'; END IF;
END;
$test$;

RESET ROLE;
