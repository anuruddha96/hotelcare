## Goal
Make the existing 5-minute `previo-poll-checkouts` job detect room 104’s real Previo checkout signal and flip its Hotel Care checkout-cleaning assignment to RTC automatically. Do not manually update room 104 or its assignment.

## What I found
- The cron is running: `checkouts_poll` rows exist every 5 minutes for `previo-test`, with successful `/rest/rooms` authentication and no errors.
- Room 104 in `previo-test` is currently a checkout room, but its assignment still has `ready_to_clean = false`.
- The poll currently only marks RTC when `/rest/rooms` includes `reservation.statusId === 5` and `reservation.departureDate === today`.
- For room 104, Hotel Care metadata still shows `scheduledDepartureToday: true` but `checkedOutToday: false`, and each poll reports `marked: 0`, which means the code is not recognizing the real checkout state from the current Previo response.

## Likely root cause
The `/rest/rooms` response used by the poll is not enough for the Previo test account checkout confirmation path. It authenticates, but the embedded `reservation` payload either does not expose the updated checkout status consistently, or the status/date shape differs from the assumed `statusId === 5` + `departureDate === today` format. The function therefore completes successfully but silently sees “nothing to mark RTC”.

## Implementation plan
1. **Add diagnostics without changing room state manually**
   - Temporarily enrich `previo-poll-checkouts` result data for departed/scheduled rooms in the target hotel: room name, roomId, reservation status/date fields, and why the room was or was not considered checked out.
   - Keep this in `pms_sync_history.data` so we can verify cron behavior without touching the room assignment.

2. **Fix checkout detection to match PMS Refresh logic more safely**
   - Keep `/rest/rooms` as the primary source so Ottofiori’s working manager approval flow remains untouched.
   - Treat a room as eligible for RTC when:
     - it is already known locally as `scheduledDepartureToday: true` or `is_checkout_room: true`, and
     - Previo now indicates the departed/checked-out state via any known REST shape (`reservation.statusId`, reservation status field variants, or checked-out/departed flags), and
     - the room matches by Previo roomId or normalized room name.
   - Do not auto-mark RTC just because it is a scheduled departure; require an actual checkout/departed signal from Previo.

3. **Preserve the working manager-approved clean push**
   - Do not edit `previo-update-room-status`.
   - Do not change Previo credentials or shared auth behavior.
   - Only adjust the automatic checkout poll.

4. **Deploy and verify through the system only**
   - Deploy `previo-poll-checkouts`.
   - Do not manually update room 104.
   - Wait for the next 5-minute cron tick.
   - Confirm from `pms_sync_history` that the cron ran, identified room 104 as checked out, and updated `marked` from `0` to `1`.
   - Confirm room 104’s `room_assignments.ready_to_clean` changed to `true` as a result of the poll.

## Safety guardrails
- No manual RTC update for room 104.
- No changes to the manager approval flow that sends clean-room status back to Previo.
- No credential changes.
- No broad database/schema changes unless logs prove the existing sync history constraint blocks the poll.