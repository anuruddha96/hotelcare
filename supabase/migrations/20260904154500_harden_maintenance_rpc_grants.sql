-- SECURITY DEFINER functions default to PUBLIC execute in PostgreSQL.
-- Only the two authenticated client entry points should be callable directly.

revoke all on function public.maintenance_hotel_matches(text, text, text) from public, anon, authenticated;
revoke all on function public.pick_active_maintenance_staff(text, text) from public, anon, authenticated;

revoke all on function public.get_maintenance_staff_for_hotel(text, boolean) from public, anon, authenticated;
grant execute on function public.get_maintenance_staff_for_hotel(text, boolean) to authenticated;

revoke all on function public.create_housekeeping_maintenance_ticket(uuid, uuid, text, text, text[]) from public, anon, authenticated;
grant execute on function public.create_housekeeping_maintenance_ticket(uuid, uuid, text, text, text[]) to authenticated;
