-- Allow eligible next-day housekeeping planners to read the fresh Previo
-- daily-overview snapshot for hotels they are authorized to manage.
--
-- Previously only admin and top_management could SELECT this table. Manager,
-- housekeeping_manager, supervisor, reception_manager and
-- top_management_manager therefore received an empty array under RLS even
-- after a successful Previo sync, causing the tomorrow planner to show 0 rooms.
--
-- Reuse the existing hotel-scoped authorization function instead of widening
-- access globally. Write permissions remain unchanged and are still protected
-- by the existing RLS/write path.

drop policy if exists "Housekeeping planners can view daily overview snapshots"
  on public.daily_overview_snapshots;

create policy "Housekeeping planners can view daily overview snapshots"
  on public.daily_overview_snapshots
  for select
  to authenticated
  using (
    public.can_manage_next_day_housekeeping_plan(
      daily_overview_snapshots.organization_slug,
      daily_overview_snapshots.hotel_id
    )
  );
