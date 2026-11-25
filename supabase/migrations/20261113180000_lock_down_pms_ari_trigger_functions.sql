-- Trigger functions of the native ARI store run only from their triggers.
-- Applied to production on 2026-11-13 (security advisor: anon_security_definer_function_executable).
REVOKE ALL ON FUNCTION public.pms_ari_reservation_changed() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pms_ari_rates_capture() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pms_ari_availability_capture() FROM PUBLIC, anon, authenticated;
