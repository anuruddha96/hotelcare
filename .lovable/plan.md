## What I found

- Room `201` already exists and is marked as checkout/dirty in `rooms`, but it does not show `RTC` because today’s `room_assignments.ready_to_clean` is still `false`.
- The checkout poll is not writing `checkouts_poll` history because `pms_sync_history.sync_type` only allows older values (`rooms`, `reservations`, etc.), so `checkouts_poll` violates the table constraint.
- The poll also looks up rooms with `.eq('hotel', 'ottofiori')`, but Ottofiori room rows are stored as `Hotel Ottofiori`; this can prevent the poll from finding and updating room `201`.

## Plan

1. **Fix the checkout poll room lookup**
   - Update `previo-poll-checkouts` so it resolves both hotel keys: the PMS config slug (`ottofiori`) and display hotel name (`Hotel Ottofiori`).
   - Use those keys when loading and matching local rooms, the same way the manual PMS refresh already does.

2. **Fix poll history inserts**
   - Add `checkouts_poll` to the allowed `pms_sync_history.sync_type` values.
   - This makes future 5-minute poll runs visible in history and prevents silent insert failures.

3. **Make RTC reflect PMS confirmation**
   - When the poll confirms a room checked out, update today’s checkout assignment for that room to `ready_to_clean=true`.
   - This is what the UI uses to show the `RTC` badge.

4. **Repair room 201 immediately**
   - Update today’s assignment for Ottofiori room `201` to `ready_to_clean=true` so it appears as RTC now, without waiting for another cron cycle.

5. **Verify**
   - Check `rooms` and `room_assignments` for 201 after the change.
   - Trigger or observe the checkout poll and confirm a new `checkouts_poll` history row appears.