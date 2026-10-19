-- Supabase's default function ACL can explicitly grant anon EXECUTE.
-- The replacement RPC is only for signed-in hotel managers, never anonymous callers.
REVOKE EXECUTE ON FUNCTION public.replace_released_housekeeping_staff(uuid, uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.replace_released_housekeeping_staff(uuid, uuid, uuid) TO authenticated;
