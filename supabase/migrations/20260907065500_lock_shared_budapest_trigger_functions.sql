-- Trigger functions are invoked by PostgreSQL triggers only. They must not be
-- exposed as callable RPCs to anon or authenticated users.
revoke all on function public.sync_shared_budapest_demand_event() from public, anon, authenticated;
revoke all on function public.seed_shared_budapest_events_for_hotel() from public, anon, authenticated;
