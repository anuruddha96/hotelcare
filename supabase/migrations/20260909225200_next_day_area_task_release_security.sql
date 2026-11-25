-- Keep the new next-day area-task table consistent with the rest of the
-- housekeeping automation security model: signed-in planners use RLS, while
-- internal trigger helpers are not directly executable as RPCs.

revoke all on function public.materialize_released_next_day_area_tasks() from public, anon, authenticated;
revoke all on function public.validate_next_day_housekeeping_area_task() from public, anon, authenticated;

grant execute on function public.materialize_released_next_day_area_tasks() to service_role;

grant select, insert, update, delete on public.next_day_housekeeping_plan_area_tasks to authenticated;
grant all on public.next_day_housekeeping_plan_area_tasks to service_role;
