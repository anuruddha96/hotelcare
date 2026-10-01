-- Lock SLNT Team B SECURITY DEFINER RPCs to the roles that actually use them.
-- The function bodies already verify auth.uid(), organization and manager/team
-- membership; these grants also prevent unauthenticated API invocation.

begin;

revoke all on function public.prepare_slnt_team_b_tasks(date, jsonb) from public;
revoke execute on function public.prepare_slnt_team_b_tasks(date, jsonb) from anon;
grant execute on function public.prepare_slnt_team_b_tasks(date, jsonb) to authenticated;

revoke all on function public.claim_housekeeping_team_task(uuid) from public;
revoke execute on function public.claim_housekeeping_team_task(uuid) from anon;
grant execute on function public.claim_housekeeping_team_task(uuid) to authenticated;

revoke all on function public.set_slnt_housekeeping_team_members(text, uuid[]) from public;
revoke execute on function public.set_slnt_housekeeping_team_members(text, uuid[]) from anon;
grant execute on function public.set_slnt_housekeeping_team_members(text, uuid[]) to authenticated;

-- Trigger-only helper: API roles never need to call it directly.
revoke all on function public.materialize_slnt_team_b_queue_after_plan_release() from public;
revoke execute on function public.materialize_slnt_team_b_queue_after_plan_release() from anon;
revoke execute on function public.materialize_slnt_team_b_queue_after_plan_release() from authenticated;

commit;
