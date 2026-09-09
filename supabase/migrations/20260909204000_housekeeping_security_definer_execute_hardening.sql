-- Minimize the RPC attack surface of the next-day housekeeping automation.
--
-- PostgreSQL functions are executable by PUBLIC unless privileges are revoked.
-- Most of these SECURITY DEFINER functions exist only as trigger helpers or
-- server-worker internals and must never be callable through PostgREST by anon
-- or ordinary signed-in users.

-- Authenticated API entry points. These functions enforce their own hotel/user
-- authorization and are intentionally available to signed-in users only.
revoke all on function public.can_access_guest_request_room(uuid) from public, anon, authenticated, service_role;
grant execute on function public.can_access_guest_request_room(uuid) to authenticated;

revoke all on function public.can_manage_next_day_housekeeping_plan(text,text) from public, anon, authenticated, service_role;
grant execute on function public.can_manage_next_day_housekeeping_plan(text,text) to authenticated;

revoke all on function public.mark_housekeeping_presence(text,text,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.mark_housekeeping_presence(text,text,jsonb) to authenticated;

-- Service-worker-only RPCs.
revoke all on function public.claim_due_next_day_housekeeping_release_plans(integer) from public, anon, authenticated, service_role;
grant execute on function public.claim_due_next_day_housekeeping_release_plans(integer) to service_role;

revoke all on function public.claim_housekeeping_activity_alerts(integer) from public, anon, authenticated, service_role;
grant execute on function public.claim_housekeeping_activity_alerts(integer) to service_role;

revoke all on function public.expire_stranded_next_day_housekeeping_releases() from public, anon, authenticated, service_role;
grant execute on function public.expire_stranded_next_day_housekeeping_releases() to service_role;

revoke all on function public.get_housekeeping_activity_worker_secret() from public, anon, authenticated, service_role;
grant execute on function public.get_housekeeping_activity_worker_secret() to service_role;

revoke all on function public.get_housekeeping_release_worker_secret() from public, anon, authenticated, service_role;
grant execute on function public.get_housekeeping_release_worker_secret() to service_role;

revoke all on function public.prepare_due_housekeeping_activity_alerts() from public, anon, authenticated, service_role;
grant execute on function public.prepare_due_housekeeping_activity_alerts() to service_role;

revoke all on function public.release_next_day_housekeeping_plan(uuid) from public, anon, authenticated, service_role;
grant execute on function public.release_next_day_housekeeping_plan(uuid) to service_role;

-- Trigger/internal helpers. Trigger execution does not require callers to retain
-- EXECUTE on the trigger function, so keep these owner-only.
revoke all on function public.capture_housekeeping_assignment_learning_event() from public, anon, authenticated, service_role;
revoke all on function public.guard_next_day_housekeeping_child_write() from public, anon, authenticated, service_role;
revoke all on function public.guard_next_day_housekeeping_plan_mutation() from public, anon, authenticated, service_role;
revoke all on function public.next_day_housekeeping_staff_matches_hotel(uuid,uuid) from public, anon, authenticated, service_role;
revoke all on function public.prepare_next_day_housekeeping_plan() from public, anon, authenticated, service_role;
revoke all on function public.refresh_housekeeping_assignment_learning_profile(text,text) from public, anon, authenticated, service_role;
revoke all on function public.refresh_housekeeping_learning_after_plan_status_change() from public, anon, authenticated, service_role;
revoke all on function public.reset_next_day_release_revalidation_on_plan_change() from public, anon, authenticated, service_role;
revoke all on function public.validate_guest_request_initial_events() from public, anon, authenticated, service_role;
revoke all on function public.validate_guest_request_note() from public, anon, authenticated, service_role;
revoke all on function public.validate_housekeeping_automation_settings() from public, anon, authenticated, service_role;
revoke all on function public.validate_next_day_housekeeping_plan_item() from public, anon, authenticated, service_role;
revoke all on function public.validate_next_day_housekeeping_plan_staff() from public, anon, authenticated, service_role;
revoke all on function public.validate_next_day_learning_metadata() from public, anon, authenticated, service_role;
revoke all on function public.validate_next_day_plan_structure_on_approval() from public, anon, authenticated, service_role;