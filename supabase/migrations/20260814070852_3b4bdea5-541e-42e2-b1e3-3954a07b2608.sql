REVOKE ALL ON FUNCTION public.claim_publisher_lock(text, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.release_publisher_lock(text) FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.claim_publisher_lock(text, integer) IS 'DEPRECATED: superseded by claim_publisher_lease(token). Execute revoked from all app roles.';
COMMENT ON FUNCTION public.release_publisher_lock(text) IS 'DEPRECATED: could release a token-owned lease it does not own. Execute revoked from all app roles; use release_publisher_lease(token).';