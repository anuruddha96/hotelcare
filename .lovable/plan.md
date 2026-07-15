## Goal

Fix the automatic Ready To Clean flow so the 5-minute cron detects newly checked-out rooms from Previo and the app refreshes/render RTC badges without manual room changes.

## What is wrong now

- The 5-minute cron is already active and running.
- The poll function is executing successfully, but for Ottofiori it records `departed: 0` every run.
- The latest poll diagnostics show Previo `/rest/rooms` returns the scheduled checkout rooms, but their `reservation` payload is missing, so the current code refuses to mark them RTC.
- The XML fallback also fails for Ottofiori with `401 Invalid login or password`, so the poll has no accepted departure signal.
- UI rendering is mostly wired, but Auto-Assign only treats `checkedOutToday` as RTC in some places, while other places also accept `readyToClean`. This can hide RTC for rooms manually or server-marked with only `readyToClean=true`.
- Room overview realtime refresh subscribes to all room changes and assignment changes, but it does not filter by hotel and its fallback is 60 seconds. It should reliably refetch when cron updates the current hotel's checkout metadata.

## Fix plan

1. **Make cron checkout detection use the working Previo clean-status signal**
   - Update `supabase/functions/previo-poll-checkouts/index.ts` so Ottofiori/API-key tenants do not depend only on missing REST reservation payloads or the failing XML reservation search.
   - Treat a local scheduled checkout room as RTC when Previo's room clean/status payload indicates the room is ready/dirty after checkout, using the same infrastructure already available in `/rest/rooms`.
   - Keep the current safeguards: only scheduled/current checkout rooms are eligible, never daily rooms, and never mark rooms RTC from a scheduled departure time alone.
   - Add clearer diagnostics for why each candidate was accepted or rejected (`accepted: true`, source, room clean status, local room number).

2. **Keep assignment status in sync after cron marks a room RTC**
   - Ensure when a room is accepted as checked out, the function writes both:
     - `rooms.pms_metadata.checkedOutToday=true` and `readyToClean=true`
     - today's active checkout assignment `room_assignments.ready_to_clean=true`
   - This preserves both room-card and already-assigned HK views.

3. **Make Auto-Assign use one RTC rule everywhere**
   - In `AutoRoomAssignment.tsx`, update the preview rebalance and assignment confirmation logic to treat a room as PMS-confirmed RTC if either `pms_metadata.checkedOutToday === true` OR `pms_metadata.readyToClean === true`.
   - This matches the chip rendering and avoids RTC rooms being hidden or not prioritized when only `readyToClean` is present.

4. **Make room cards refresh reliably after cron updates**
   - In `HotelRoomOverview.tsx`, tighten the realtime subscription callback so it refetches when `rooms` rows for the selected hotel change and today's `room_assignments` change.
   - Dispatch/consume the existing refresh path so manager screens update shortly after cron writes the DB, without requiring manual refresh.
   - Keep the existing 60-second visible-tab fallback as a safety net.

5. **Fix manual PMS refresh post-checkout poll gate**
   - In `src/lib/pmsRefresh.ts`, remove the old `hotelId === "previo-test"` condition so after a manager runs PMS sync, the checkout poll runs for their actual hotel too.
   - This does not manually mark rooms; it only lets the automated detection run immediately after PMS sync.

6. **Verification**
   - Check latest `pms_sync_history` after the next cron run: Ottofiori should show accepted diagnostics and nonzero `departed` when Previo reports newly checked-out rooms.
   - Verify the relevant room rows have `pms_metadata.readyToClean=true` / `checkedOutToday=true`.
   - Verify room cards and Auto-Assign chips show the RTC badge after data refresh.

## Not included

- No manual DB updates to mark specific rooms RTC.
- No cron schedule changes; it is already every 5 minutes.
- No schema changes.