-- Supabase may retain an explicit anon EXECUTE ACL even after revoking PUBLIC.
-- Ensure this SECURITY DEFINER maintenance workflow is authenticated-only.
REVOKE ALL ON FUNCTION public.work_maintenance_ticket(uuid,text,text,timestamptz,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.work_maintenance_ticket(uuid,text,text,timestamptz,text,text) TO authenticated;
