-- Fully lock down the trigger-only SECURITY DEFINER helper. The function is
-- executed by the room_assignments trigger and must not be exposed as an RPC.
REVOKE ALL ON FUNCTION public.enforce_room_assignment_tenant_integrity() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_room_assignment_tenant_integrity() FROM anon;
REVOKE ALL ON FUNCTION public.enforce_room_assignment_tenant_integrity() FROM authenticated;
REVOKE ALL ON FUNCTION public.enforce_room_assignment_tenant_integrity() FROM service_role;
