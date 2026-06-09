## Goal
Fix the housekeeping room timer so it always reflects the real start time and never shows stale multi-hour durations for newly started rooms.

## What I found
- The timer itself is reading from the saved `started_at` field, so the bad duration is coming from stored data rather than simple display math.
- For room 406 today, the assignment was created later than the saved `started_at`, which means the row already contained an old start time.
- This points to a stale data / assignment lifecycle problem, not just a formatting issue.

## Plan
1. Trace and fix every room-assignment path that can carry over or preserve an old `started_at` when a room is newly assigned or restarted.
2. Tighten the start-room logic so `started_at` is only preserved for a true resume of the same active assignment, and is reset when a fresh assignment should begin.
3. Audit manager-side and mobile-side room start flows so they follow the same timestamp rules as the main housekeeper card.
4. Add a safety guard in the UI for impossible timer states so obviously wrong durations do not show if bad legacy data slips through.
5. Clean up existing bad `room_assignments` records causing active or recently-created rooms to have stale `started_at` values.
6. Validate the affected screens, especially Working Room Details and housekeeper in-progress cards, against current-day assignment data.

## Technical details
- Files likely involved:
  - `src/components/dashboard/AssignedRoomCard.tsx`
  - `src/components/dashboard/MobileHousekeepingView.tsx`
  - `src/components/dashboard/HotelRoomOverview.tsx`
  - `src/components/dashboard/WorkingRoomDetailDialog.tsx`
  - relevant assignment-creation components if they can reuse stale rows
- Data validation target:
  - `room_assignments.started_at`
  - `room_assignments.assignment_date`
  - `room_assignments.status`
  - assignment creation vs. first transition to `in_progress`
- I will also include a targeted data correction for existing broken rows so the Friday issue is resolved, not just prevented going forward.