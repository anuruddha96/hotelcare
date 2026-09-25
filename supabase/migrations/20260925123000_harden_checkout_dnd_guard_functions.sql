-- Trigger functions are internal database guards, not RPC endpoints.
-- Keep them callable only through their triggers.
REVOKE EXECUTE ON FUNCTION public.hc_forbid_checkout_room_dnd() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.hc_forbid_checkout_assignment_dnd() FROM PUBLIC, anon, authenticated;
