-- Run only AFTER the Work Schedule draft migrations in an approved test DB.
-- This contract is not a substitute for authenticated, adversarial JWT/RPC tests.
BEGIN;
DO $verify$
DECLARE v_count integer;
BEGIN
  IF to_regclass('public.work_schedule_entries') IS NULL
     OR to_regclass('public.work_schedule_employee_links') IS NULL
     OR to_regclass('public.work_schedule_import_runs') IS NULL
     OR to_regclass('public.work_schedule_pilot_grants') IS NULL THEN
    RAISE EXCEPTION 'Required schedule tables are missing';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class WHERE oid IN (
      'public.work_schedule_entries'::regclass,
      'public.work_schedule_employee_links'::regclass,
      'public.work_schedule_import_runs'::regclass,
      'public.work_schedule_pilot_grants'::regclass
    ) AND NOT relrowsecurity
  ) THEN RAISE EXCEPTION 'Schedule or grant table has RLS disabled'; END IF;

  IF has_table_privilege('authenticated', 'public.work_schedule_entries', 'INSERT')
     OR has_table_privilege('authenticated', 'public.work_schedule_entries', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.work_schedule_entries', 'DELETE')
     OR has_table_privilege('authenticated', 'public.work_schedule_pilot_grants', 'SELECT')
     OR has_table_privilege('authenticated', 'public.work_schedule_pilot_grants', 'INSERT')
     OR has_table_privilege('anon', 'public.work_schedule_entries', 'SELECT')
     OR has_function_privilege('anon', 'public.work_schedule_pilot_has_access(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Unsafe direct grants on work schedule or pilot access function';
  END IF;

  SELECT count(*) INTO v_count FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'work_schedule_entries'
    AND cmd IN ('SELECT', 'ALL');
  IF v_count <> 1 OR NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'work_schedule_entries' AND cmd = 'SELECT'
      AND qual ILIKE '%work_schedule_can_manage%'
      AND qual NOT ILIKE '%staff_id = auth.uid%'
  ) THEN
    RAISE EXCEPTION 'A broad or unexpected schedule SELECT policy is installed';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.work_schedule_pilot_grants g
    JOIN public.hotel_configurations h ON h.hotel_id = g.hotel_id
    JOIN public.organizations o ON o.id = h.organization_id
    JOIN public.profiles p ON p.id = g.profile_id
    WHERE o.slug <> 'rdhotels' OR g.organization_slug <> o.slug
      OR p.organization_slug <> o.slug OR lower(btrim(p.nickname)) <> 'anu_000'
  ) THEN
    RAISE EXCEPTION 'RD pilot grant points to wrong organization, property or account';
  END IF;
  IF EXISTS (SELECT 1 FROM public.work_schedule_pilot_grants
             WHERE organization_slug <> 'rdhotels') THEN
    RAISE EXCEPTION 'An SLNT or unrelated pilot grant exists before isolation approval';
  END IF;
  RAISE NOTICE 'RD work schedule static database grant/RLS contract passed';
END
$verify$;
ROLLBACK;
