## Root causes

I checked the sync function code, the live DB for `previo-test`, and the most recent Previo edge-function logs. Three independent bugs.

### 1. "Issues Found" in PMS upload (Single 901, Single 902, hk202)

Confirmed via DB query: `Single 901`, `Single 902`, `hk202`, `Onity 101`, `Salto 101`, `Deluxe 1..4`, `Room 1..4`, etc. are **all present** in the `rooms` table for `previo-test` — they were imported correctly with the full Previo room name as `room_number`.

The error comes from the upload pipeline:
- `previo-pms-sync` emits each row with `Room: r.name` (e.g. `"Single 901"`).
- `PMSUpload.extractRoomNumber()` is built for legacy Excel formats (`Q-101`, `DB/TW-102`, `7TWIN-034SH`, …) and reduces `"Single 901"` → `"901"`.
- The matcher then runs `.eq('room_number', '901')` — and 901 is not a room number, `Single 901` is. Match fails → "not found".

This affects every room whose Previo `name` doesn't reduce cleanly to digits.

### 2. Onity 101 "missing" in the app

It is **not** missing from the DB — it's there as `room_number = 'Onity 101'`. So this is the same root cause as #1: any view that runs PMS data through `extractRoomNumber` and then looks up by digits will silently drop it. The Rooms › Room Status Overview list itself includes it (RoomManagement does not filter alpha names). Once #1 is fixed, the Issues panel will stop reporting it, and any housekeeping rows that depend on the upload-derived status will populate.

### 3. Room 106 checkout not captured

Confirmed from `previo-sync-rooms` edge logs (sample row from today's sync):

```
{ "roomId": 699176, "name": "201", "roomKindName": "...", "roomCleanStatusId": 1, ... }
```

There is **no `reservation` field** on the rooms returned by Previo `/rest/rooms` for this hotel. `previo-pms-sync` decides checkouts purely from `r.reservation.departureDate === today`, so with no reservation block it always emits `Departure: null` → 0 checkout rooms forever, regardless of what Previo actually shows on the calendar. (Same reason `previo-poll-checkouts` has nothing to mark.)

Today's checkouts have to come from a reservations endpoint, not `/rest/rooms`.

## Plan (test hotel only — `previo-test` / 730099)

### Fix A — Match rooms by full Previo name in the upload pipeline

File: `src/components/dashboard/PMSUpload.tsx`, around lines 555–580.

Change the lookup to a 2-step match (still hotel-scoped via `hotelKeys`):

1. First try `.eq('room_number', rawRoomVal.trim())` (exact, case-sensitive — Previo names are stable).
2. If 0 rows, try `.ilike('room_number', rawRoomVal.trim())` for case-insensitive safety.
3. Only if both fail, fall back to the existing `extractRoomNumber(...)` digit match (keeps legacy Excel uploads for OttoFiori etc. working).
4. Update the error message to show both values: `Room "<raw>" (also tried extracted "<num>") not found in <hotel>`.

This fixes Single 901 / 902 / hk202 / Onity 101 / Salto 101 / Deluxe N / Room N etc. in one shot, and does not touch logic for any other hotel because OttoFiori room numbers are pure digits and step 1 will simply find them too.

### Fix B — Pull today's checkouts from Previo and inject them into the synthesized rows

File: `supabase/functions/previo-pms-sync/index.ts`.

After fetching `/rest/rooms`, also call Previo's reservations endpoint for today (still hard-gated to `previo-test`):

- `GET /rest/reservations?dateFrom=<today>&dateTo=<today>` (or the equivalent `arrivalDate` / `departureDate` query the Previo REST docs document — `_shared/previoAuth.ts` already handles auth).
- Build two maps keyed by `roomId` (and fallback by room name):
  - `departuresToday` = reservations where `departureDate === today`
  - `arrivalsToday` = reservations where `arrivalDate === today`
- When emitting each row, override:
  - `Departure: "12:00"` if room is in `departuresToday`
  - `Arrival: "15:00"` if room is in `arrivalsToday`
  - `Occupied: "Yes"` if either, or if the room currently has an in-house reservation `arrivalDate <= today < departureDate`
  - `People`, `Note`, `Night / Total` from the matched reservation when available

This is the only behavioral change needed — `PMSUpload` already converts `Departure != null` into `is_checkout_room = true` (lines 644–671), so room 106 will start landing in the checkout list automatically once the field is populated.

If Previo's reservation endpoint isn't available or returns an error, log it and emit the rows with empty Departure/Arrival as today (no regression).

### Fix C — Stop the false "Issues Found" noise after Fix A

After Fix A succeeds, only genuine misses (a Previo room with no matching local row) should appear. Add a small note to the Issues panel header clarifying that successful matches via either the raw name or extracted digit count as found.

### Out of scope (not changing now)

- `previo-poll-checkouts` — same root cause (no reservation in `/rest/rooms`), but the upload-driven path above is enough to surface today's checkouts. We can revisit polling once the reservations endpoint is wired in.
- Live hotels (OttoFiori etc.). All changes remain gated by `selectedHotel === 'previo-test'` for the sync flow; Fix A's raw-name match is harmless for digit-only room numbers.
- Revenue / dashboards / additional Previo endpoints.

## Acceptance checks

1. Run "Sync with Previo" on `previo-test`. Issues Found = 0 (or only truly orphaned Previo rooms).
2. Housekeeping › Team View › Hotel Room Overview shows room 106 (and any other rooms departing today) as a checkout room.
3. Onity 101, Salto 101, Single 901/902, hk202 all show their PMS-derived status (no longer reported as "not found").
4. No changes observed for any non-`previo-test` hotel.
