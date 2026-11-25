-- pi_open_conflict_count() reads NAV conflict state for any invoice id and has no access check of its own.
-- Only the SECURITY DEFINER approval guard (which runs as the function owner) and service-role code need it,
-- so signed-in browser sessions must not be able to call it directly.
REVOKE EXECUTE ON FUNCTION public.pi_open_conflict_count(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pi_open_conflict_count(uuid) TO service_role;
