-- Fix 9 Oct 2026 Supabase Realtime replication errors.
--
-- PostgreSQL logs: realtime.apply_rls -> "permission denied for function
-- get_user_organization_slug" (42501), repeatedly during WAL delivery.
-- realtime.subscription contained anonymous listeners for protected tables.
-- Several SELECT policies were declared TO PUBLIC, yet call SECURITY DEFINER
-- helpers intentionally granted only to authenticated/service_role.
-- Realtime evaluates those policies with the subscriber's JWT role and a
-- transient anonymous channel can abort the whole list_changes poll.
--
-- Least-privilege fix: limit the six business-table SELECT policies below to
-- authenticated sessions. Preserve their existing USING expressions/tenant
-- guards exactly. Do NOT grant sensitive organization/role helpers to anon or
-- alter Supabase-owned realtime.list_changes/apply_rls functions.
--
-- This does not disable Realtime or alter INSERT/UPDATE/DELETE RLS.
-- Rows already filtered for logged-in users keep the same authorization.

DO $guard$
DECLARE
  expected record;
BEGIN
  FOR expected IN
    SELECT * FROM (VALUES
      ('break_requests', 'Users can view own break requests'),
      ('dirty_linen_counts', 'Housekeepers and managers can view linen counts by hotel'),
      ('dirty_linen_public_area_counts', 'Public area linen self select'),
      ('early_signout_requests', 'Users can view their own early signout requests'),
      ('housekeeping_notes', 'Housekeeping staff can view notes for their hotels'),
      ('tickets', 'Users can view tickets based on access config')
    ) AS expected(tablename, policyname)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_policies p
      WHERE p.schemaname = 'public'
        AND p.tablename = expected.tablename
        AND p.policyname = expected.policyname
        AND p.cmd = 'SELECT'
        AND p.roles = ARRAY['public']::name[]
    ) THEN
      RAISE EXCEPTION 'Realtime RLS policy % on public.% changed; review before migration',
        expected.policyname, expected.tablename;
    END IF;
  END LOOP;
END
$guard$;

ALTER POLICY "Users can view own break requests"
  ON public.break_requests TO authenticated;
ALTER POLICY "Housekeepers and managers can view linen counts by hotel"
  ON public.dirty_linen_counts TO authenticated;
ALTER POLICY "Public area linen self select"
  ON public.dirty_linen_public_area_counts TO authenticated;
ALTER POLICY "Users can view their own early signout requests"
  ON public.early_signout_requests TO authenticated;
ALTER POLICY "Housekeeping staff can view notes for their hotels"
  ON public.housekeeping_notes TO authenticated;
ALTER POLICY "Users can view tickets based on access config"
  ON public.tickets TO authenticated;
