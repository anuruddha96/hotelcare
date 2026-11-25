-- Read-only regression assertions. Run AFTER the paired RLS migration.
-- Prevents a future policy rewrite from letting anonymous Realtime subscribers
-- evaluate restricted SECURITY DEFINER organization/role helpers.
DO $test$
DECLARE
  v_correct integer;
  v_expected integer := 6;
BEGIN
  SELECT count(*) INTO v_correct
  FROM (VALUES
    ('break_requests', 'Users can view own break requests'),
    ('dirty_linen_counts', 'Housekeepers and managers can view linen counts by hotel'),
    ('dirty_linen_public_area_counts', 'Public area linen self select'),
    ('early_signout_requests', 'Users can view their own early signout requests'),
    ('housekeeping_notes', 'Housekeeping staff can view notes for their hotels'),
    ('tickets', 'Users can view tickets based on access config')
  ) AS required(tablename,policyname)
  JOIN pg_catalog.pg_policies p
    ON p.schemaname = 'public'
   AND p.tablename = required.tablename
   AND p.policyname = required.policyname
   AND p.cmd = 'SELECT'
   AND p.roles = ARRAY['authenticated']::name[];
  IF v_correct <> v_expected THEN
    RAISE EXCEPTION 'Expected % authenticated Realtime SELECT policies, found %', v_expected, v_correct;
  END IF;
  IF has_function_privilege('anon', 'public.get_user_organization_slug(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.get_user_organization_slug(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Organization helper function permissions changed unexpectedly';
  END IF;
END
$test$;
