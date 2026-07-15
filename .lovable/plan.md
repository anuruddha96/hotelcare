Current findings:
- Hotel Ottofiori currently has 10 `checkout_cleaning` assignments, matching your memory: 102, 104, 201, 203, 303, 305, 401, 403, 404, 405.
- The wrong extra room is not in the checkout-assignment count; it is the room-level PMS checkout flags on 301 and 401.
- 301 is incorrectly flagged as `is_checkout_room=true` / `checkedOutToday=true` even though Previo metadata says it is not scheduled for departure today.
- 401 is also flagged as checked out, but you clarified it is still occupied and must not be RTC.
- The latest cron runs are reading Previo REST room data, but that payload has no reservation checkout payload; the function is therefore not safely correcting these two occupied rooms.

Plan:
1. Correct the live Ottofiori state immediately:
   - Clear room-level checkout/RTC flags for 301 and 401.
   - Clear `checkout_time` for 301 and 401.
   - Set today’s assignments for 301 and 401 to not `ready_to_clean`.
   - Keep 301 as daily cleaning and change 401 away from checkout/RTC so it does not appear in the checkout RTC list.

2. Preserve the real checkout list:
   - Keep the checkout-cleaning rooms that are valid RTC: 102, 104, 201, 203, 303, 305, 403, 404, 405.
   - After removing 401 from checkout, Ottofiori will show 9 checkout rooms unless another room is confirmed from Previo as checkout. If you still expect exactly 10 after excluding 301 and 401, I will verify which missing room should be the 10th from the assignment/Previo data before changing it.

3. Fix the cron logic so this does not recur:
   - Update `previo-poll-checkouts` so room-clean-status alone cannot mark or preserve checkout/RTC.
   - Add a room-specific correction path for Previo REST diagnostics: if a local room is marked checkout/RTC but Previo does not provide a valid checkout/departure confirmation, the cron clears those flags instead of keeping stale RTC.
   - Ensure assignments are reconciled too, not only `rooms` table fields.

4. Verify after implementation:
   - Run the edge function once and check `pms_sync_history`.
   - Query Ottofiori rooms and today’s assignments to confirm 301 and 401 are not RTC.
   - Confirm the checkout list count and room numbers shown by the database match the intended current state.