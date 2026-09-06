-- Internal snapshot writers are invoked by database triggers / cron only.
-- Do not expose SECURITY DEFINER writers through the REST RPC surface.
revoke execute on function public.capture_housekeeping_room_snapshot(uuid,date,boolean) from public, anon, authenticated;
revoke execute on function public.capture_all_housekeeping_rooms_for_date(date) from public, anon, authenticated;
revoke execute on function public.trg_capture_housekeeping_room_history() from public, anon, authenticated;
revoke execute on function public.trg_capture_housekeeping_assignment_history() from public, anon, authenticated;

grant execute on function public.capture_housekeeping_room_snapshot(uuid,date,boolean) to service_role;
grant execute on function public.capture_all_housekeeping_rooms_for_date(date) to service_role;
