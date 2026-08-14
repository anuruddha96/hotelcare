REVOKE EXECUTE ON FUNCTION public.rate_cell_markers(text, date, date, timestamptz) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rate_cell_history(text, date, timestamptz, integer) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.rate_cell_markers(text, date, date, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rate_cell_history(text, date, timestamptz, integer) TO authenticated, service_role;