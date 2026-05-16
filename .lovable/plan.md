## Plan

1. Remove the remaining automatic release from `previo-poll-checkouts`
   - Change the edge function so it only sets `ready_to_clean = true` when Previo confirms a real departure for that room.
   - Do not auto-release on Previo dirty/untidy status alone.
   - Keep the function hard-scoped to `hotelId = 'previo-test'`.

2. Tighten the global database trigger so live hotels are not affected
   - Update `handle_room_status_change()` so status changes on `rooms` do not automatically mark checkout assignments as ready unless the room is truly eligible.
   - Make the rule explicit: for normal/live hotels like Ottofiori, checkout assignments stay blocked until an eligible staff member manually marks them ready.
   - Preserve the test-hotel exception by relying on the API-driven poll, not generic room-status transitions.

3. Align all frontend/manual readiness entry points with the same rule
   - Review the manager/supervisor ready actions in `HotelRoomOverview`, `PendingRoomsDialog`, and `WorkingRoomDetailDialog` so only manual eligible-staff actions can release rooms outside the test-hotel API flow.
   - Ensure assigning a room never flips it to RTA by itself.

4. Clean up already-misreleased assignments and verify behavior
   - Add a corrective migration/query to re-block any currently open checkout assignments that were auto-released without a real checkout signal.
   - Verify these scenarios:
     - Ottofiori: assignment alone does not make room RTA.
     - Ottofiori: manual eligible-staff release still works.
     - `previo-test`: room becomes RTA only after the 10-minute API poll confirms departure.

## Technical details

- Likely root cause found during review: `supabase/functions/previo-poll-checkouts/index.ts` still updates `room_assignments.ready_to_clean = true` for every candidate room, including Previo-dirty rooms that are not real departures.
- Additional shared risk: the database function `public.handle_room_status_change()` is global, so if it keys off generic room status changes, it can affect hotels beyond `previo-test`, including Ottofiori.
- Files likely involved:
  - `supabase/functions/previo-poll-checkouts/index.ts`
  - new Supabase migration replacing the global trigger logic
  - possibly small guard updates in:
    - `src/components/dashboard/HotelRoomOverview.tsx`
    - `src/components/dashboard/PendingRoomsDialog.tsx`
    - `src/components/dashboard/WorkingRoomDetailDialog.tsx`

## Outcome

After this change, room assignment will never auto-mark rooms as RTA by itself. Ottofiori will require manual eligible-staff release, while `previo-test` will release only from the API-confirmed 10-minute checkout poll.