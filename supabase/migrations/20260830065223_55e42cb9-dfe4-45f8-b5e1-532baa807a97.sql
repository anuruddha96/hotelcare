
REVOKE EXECUTE ON FUNCTION public.revenue_latest_snapshots(text, date, date) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.revenue_manual_hold_dates(text, timestamptz, text[]) FROM authenticated;
