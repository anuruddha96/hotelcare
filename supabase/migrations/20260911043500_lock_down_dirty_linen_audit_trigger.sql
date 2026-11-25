-- Trigger-only audit function must not be callable through PostgREST RPC.
revoke execute on function public.audit_dirty_linen_count_change() from public;
revoke execute on function public.audit_dirty_linen_count_change() from anon;
revoke execute on function public.audit_dirty_linen_count_change() from authenticated;
