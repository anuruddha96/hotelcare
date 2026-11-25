-- Supabase grants EXECUTE to anon explicitly by default on new functions.
-- Revoking PUBLIC alone is insufficient: keep the authenticated role only.
REVOKE ALL ON FUNCTION public.manage_maintenance_ticket(uuid,text,text,timestamptz,text) FROM anon;
REVOKE ALL ON FUNCTION public.manage_maintenance_ticket(uuid,text,text,timestamptz,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.manage_maintenance_ticket(uuid,text,text,timestamptz,text) TO authenticated;
