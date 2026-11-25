# Unified tomorrow Auto Assign

Tomorrow planning uses the same Auto Room Assignment board and 4-step flow as the live-day workflow:

1. Staff
2. Preview
3. Confirm
4. Public Areas

Key differences are intentionally backend-only:

- a complete Previo snapshot from the last 15 minutes is reused; otherwise the planner refreshes Previo first;
- tomorrow staff defaults come from `staff_schedules`, not today's attendance;
- selected-date `daily_overview_snapshots` are the authoritative room workload for standard Previo hotels;
- Confirm does not create live `room_assignments`;
- the final Public Areas step saves one approved `next_day_housekeeping_plan` containing rooms, shared helpers, mapped public areas and one-off public areas;
- approved plans remain hidden from housekeepers until the protected 08:00 release worker succeeds;
- the release worker still performs its own fresh PMS revalidation before publishing rooms;
- public-area plan rows materialize to `general_tasks` only after the parent plan reaches `released`.

Team View also treats `rooms.status = clean` as clean when today's fresh PMS metadata confirms that state, without rewriting `last_cleaned_at`.
