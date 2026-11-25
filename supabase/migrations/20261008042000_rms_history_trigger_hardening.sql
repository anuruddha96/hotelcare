-- RMS #510 / Phase 02A — keep the internal snapshot trigger off the REST/RPC surface.
-- Trigger execution does not require client roles to have EXECUTE on the trigger function.

revoke all on function public.upsert_revenue_historical_daily_from_snapshot() from public;
revoke execute on function public.upsert_revenue_historical_daily_from_snapshot() from anon;
revoke execute on function public.upsert_revenue_historical_daily_from_snapshot() from authenticated;
revoke execute on function public.upsert_revenue_historical_daily_from_snapshot() from service_role;
