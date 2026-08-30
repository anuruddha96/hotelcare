REVOKE EXECUTE ON FUNCTION public.revenue_seasonal_anchor(text, integer) FROM authenticated, anon, public;
REVOKE EXECUTE ON FUNCTION public.revenue_manual_hold_state(text, timestamptz, text[]) FROM authenticated, anon, public;
REVOKE EXECUTE ON FUNCTION public.revenue_latest_snapshots(text, date, date) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.revenue_seasonal_anchor(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.revenue_manual_hold_state(text, timestamptz, text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.revenue_latest_snapshots(text, date, date) TO authenticated, service_role;