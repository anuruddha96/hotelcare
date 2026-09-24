-- Post-deployment hardening for the SECURITY DEFINER trigger helper.
-- It is invoked by the room_assignments trigger and must not be callable as RPC.
REVOKE ALL ON FUNCTION public.enforce_room_assignment_tenant_integrity() FROM PUBLIC;
