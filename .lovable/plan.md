## What's actually broken

The poll function (`previo-poll-checkouts`) detects departures by calling Previo's **XML** endpoint `api.previo.app/x1/hotel/searchReservations/`. Ottofiori's stored credential is a Previo **REST ApiKey**, which the XML endpoint rejects with `401 Invalid login or password`. That's why the credential "works for everything else" — every other feature (PMS Refresh `/rest/rooms`, the manager-approve push in `previo-update-room-status`) uses the **REST** endpoint with `Authorization: ApiKey …`, which the same key accepts.

So the credential is fine. The poll is simply asking the wrong endpoint.

## Fix

Stop using the XML endpoint for departure detection. Use the same `/rest/rooms` call that manual PMS Refresh already uses — its response includes each room's `reservation.statusId` and `reservation.departureDate`, which is exactly what we need to identify today's `statusId === 5` departures.

### Steps

1. In `supabase/functions/previo-poll-checkouts/index.ts`:
   - Always fetch `/rest/rooms` via `fetchPrevioWithAuth` (drop the XML-only branch that skipped this for Ottofiori).
   - Build `checkedOutByObjId` / `checkedOutByName` from `room.reservation` where `statusId === 5` and `departureDate === today`, using `roomId` and `name` — no `reservationId` is exposed by `/rest/rooms`, so store an empty string (downstream code already treats it as optional and just logs it into `pms_change_events`).
   - Remove the `callPrevioXml({ method: "searchReservations" })` call and its `loadPrevioCredentials` import if no longer needed. Keep the rest of the pipeline (room lookup by `hotelKeys`, `is_checkout_room` update, `room_assignments.ready_to_clean=true`, `pms_change_events`, stale-flag cleanup) exactly as it is.
   - Keep the `pms_sync_history` `checkouts_poll` row and the error-collection behavior.

2. Do **not** touch:
   - `previo-update-room-status` (manager-approve → Previo push) — user confirmed this works, leave untouched.
   - `previo-pms-sync` — its XML `searchReservations` call is best-effort and already tolerates failure; unrelated to the RTC bug.
   - `_shared/previoCredentials.ts` and `_shared/previoAuth.ts` — no credential-format change.
   - The cron schedule / auth gate — already fixed in the prior turn.

3. Deploy `previo-poll-checkouts`, trigger it once, and verify against the Ottofiori test hotel:
   - `pms_sync_history` shows a fresh `checkouts_poll` row with `errors=[]`.
   - Any room whose `/rest/rooms` reservation reports `statusId=5` + departure=today flips `rooms.is_checkout_room=true` and `room_assignments.ready_to_clean=true` (RTC badge appears in Team View).
   - Function logs no longer contain `401 Invalid login or password`.

### Notes for the reviewer

- Ottofiori's `/rest/rooms` response is already known to work — it's what powers the working manual PMS Refresh, so no new secrets, no XML login/password needed.
- If the Previo test hotel currently has no `statusId=5` rooms, the poll will simply report `checked=<N>, updated=0, errors=[]` — that's the correct "nothing to do" outcome and confirms auth is healthy.
