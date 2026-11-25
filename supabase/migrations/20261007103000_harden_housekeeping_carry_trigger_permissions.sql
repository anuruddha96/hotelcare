-- Harden housekeeping carry-forward trigger helpers after restoring the feature.
-- Trigger execution is driven by PostgreSQL; client roles do not need direct
-- EXECUTE permission on these SECURITY DEFINER trigger functions.

REVOKE ALL ON FUNCTION public.hc_attach_memories_missed_service_carry()
FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.hc_attach_portfolio_missed_service_carry()
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.hc_attach_memories_missed_service_carry()
TO service_role;

GRANT EXECUTE ON FUNCTION public.hc_attach_portfolio_missed_service_carry()
TO service_role;
