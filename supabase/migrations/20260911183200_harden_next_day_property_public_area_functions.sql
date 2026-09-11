-- Trigger functions are never meant to be callable through the exposed RPC API.
revoke all on function public.validate_next_day_property_public_area_assignment() from public;
revoke all on function public.validate_next_day_property_public_area_assignment() from anon;
revoke all on function public.validate_next_day_property_public_area_assignment() from authenticated;

-- The save RPC is intentionally available only to signed-in users. It performs
-- its own organization/hotel manager authorization before changing any rows.
revoke all on function public.save_next_day_housekeeping_public_area_assignments(text, text, date, jsonb) from public;
revoke all on function public.save_next_day_housekeeping_public_area_assignments(text, text, date, jsonb) from anon;
grant execute on function public.save_next_day_housekeeping_public_area_assignments(text, text, date, jsonb) to authenticated;
