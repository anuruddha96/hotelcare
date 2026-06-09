# Plan

## What I found
- The manager’s **Room Completion Approvals** screen is `src/components/dashboard/SupervisorApprovalView.tsx`.
- That screen calculates the displayed duration as **`completed_at - started_at`** and shows **“Started HH:mm”** from the same `started_at` field.
- For the exact rooms in the screenshot (302, 305, 401, 403), today’s database rows already contain bad values: `started_at` is around **06:00 UTC** while `completed_at` is around **12:12–12:21 UTC**, which is why the UI shows about **6h**.
- The current DB trigger is too narrow: it only corrects `started_at` when it is impossible relative to `created_at` or far in the future. These bad timestamps are still “plausible,” so they pass through.
- There are also client paths that preserve stale `started_at` instead of resetting it when a fresh work session starts:
  - `src/components/dashboard/AssignedRoomCard.tsx`
  - `src/components/dashboard/HotelRoomOverview.tsx`

## Implementation plan
1. **Fix the start-time write rules at the source**
   - Update the housekeeping start flows so a fresh transition to `in_progress` sets a fresh server-safe start time instead of preserving any old `started_at` from reused rows.
   - Keep true resume behavior only where the same active work session is intentionally resumed.

2. **Strengthen the database guard**
   - Update the `room_assignments` trigger so `started_at` is corrected not only when it is impossible, but also when it is clearly stale for the current work session.
   - Specifically protect cases where a room is marked `in_progress` or completed today but the stored `started_at` is older than the active assignment window.

3. **Clean up today’s bad housekeeping rows**
   - Run a targeted data correction for affected `room_assignments` rows already showing inflated durations so managers immediately stop seeing false 6h times.
   - Limit cleanup to rows that match the bad pattern instead of broad historical rewrites.

4. **Add a UI safety fallback in the manager approvals screen**
   - In `SupervisorApprovalView.tsx`, detect obviously suspicious durations and avoid labeling them as real cleaning speed.
   - If a row is still inconsistent, show a neutral fallback instead of “Very Slow” based on bad source data.

5. **Validate across both manager views**
   - Verify the fix in:
     - `SupervisorApprovalView.tsx` (Room Completion Approvals)
     - `WorkingRoomDetailDialog.tsx` (active working-room modal)
   - Confirm the displayed duration and “Started” time match the corrected assignment data.

## Technical details
- **Files to update**
  - `src/components/dashboard/SupervisorApprovalView.tsx`
  - `src/components/dashboard/AssignedRoomCard.tsx`
  - `src/components/dashboard/HotelRoomOverview.tsx`
  - `src/components/dashboard/WorkingRoomDetailDialog.tsx`
  - new Supabase migration for the trigger refinement and targeted cleanup

- **Data pattern to fix**
  - `room_assignments.status = 'completed'`
  - `assignment_date = current_date`
  - `started_at` much earlier than the real active work window, causing false multi-hour durations on same-day completions

- **Expected result**
  - A room started recently will no longer appear as 6h on the manager approval screen.
  - Reused or reassigned rows will not carry stale start times into new cleaning sessions.
  - Legacy bad rows for today will be corrected immediately.