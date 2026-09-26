-- Keep trigger-only functions out of PostgREST RPC and ensure the RLS helper is
-- available only to signed-in users.

revoke all on function public.can_manage_maintenance_escalation(text, text) from public, anon;
grant execute on function public.can_manage_maintenance_escalation(text, text) to authenticated;

revoke all on function public.apply_maintenance_sla_deadline() from public, anon, authenticated;
revoke all on function public.touch_maintenance_escalation_updated_at() from public, anon, authenticated;
