-- Run ONLY on a disposable/staging database after applying migrations through
-- 20260922160400. This file does not change production data or grant access.
BEGIN;
DO $test$
BEGIN
  IF to_regclass('public.property_duty_grants') IS NULL
    OR to_regclass('public.property_duty_sessions') IS NULL THEN
    RAISE EXCEPTION 'Temporary duty tables missing';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.property_duty_grants'::regclass)
    OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.property_duty_sessions'::regclass) THEN
    RAISE EXCEPTION 'Duty tables must have RLS enabled';
  END IF;
  IF has_table_privilege('authenticated', 'public.property_duty_grants', 'INSERT')
    OR has_table_privilege('authenticated', 'public.property_duty_grants', 'UPDATE')
    OR has_table_privilege('authenticated', 'public.property_duty_sessions', 'INSERT')
    OR has_table_privilege('authenticated', 'public.property_duty_sessions', 'UPDATE') THEN
    RAISE EXCEPTION 'Authenticated client unexpectedly has duty table write access';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'tickets'
      AND policyname = 'property_duty_tenant_boundary' AND permissive = 'RESTRICTIVE'
  ) THEN
    RAISE EXCEPTION 'Restrictive ticket organization boundary missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'property_duty_private_ticket_evidence_boundary' AND permissive = 'RESTRICTIVE'
  ) THEN
    RAISE EXCEPTION 'Restrictive private photo access boundary missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE oid = 'public.has_active_property_duty(text,text)'::regprocedure
      AND prosecdef = true
  ) THEN
    RAISE EXCEPTION 'Authoritative active-duty predicate missing';
  END IF;
  IF has_function_privilege('anon', 'public.grant_property_duty(uuid,uuid,boolean)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.start_property_duty(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Anonymous access must be denied for duty functions';
  END IF;
  RAISE NOTICE 'Duty schema, write restrictions and ticket/media RLS structure present.';
END;
$test$;
ROLLBACK;

-- Additional REQUIRED authenticated staging tests (not replaced by schema
-- checks): ordinary RD employee must fail SLNT destination/grant/session,
-- ordinary SLNT employee must fail RD destination/grant/session, forged hotel
-- and user IDs fail, housekeeper denied, expired/revoked sessions cannot view
-- foreign property ticket/photos, legitimate staff can see assigned ticket and
-- original/completion signed photos, manager without management delegation
-- cannot inherit elevated permissions, and no existing RD/SLNT workflows regress.
