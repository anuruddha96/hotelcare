## Root cause

Previo reservation `statusId` values are being misinterpreted. Previo's actual reservation states are:

- `4` = confirmed
- `5` = **checked-in** (guest in-house)
- `6` = **checked-out**
- `8` = no-show

But our code treats `statusId === 5` as checked-out in three places:

1. `supabase/functions/previo-pms-sync/index.ts` line 113 → `isCheckedOutStatus(statusId) { return statusId === 5 || statusId === 9; }`
2. `supabase/functions/previo-poll-checkouts/index.ts` lines 74–79 → same 5/9 test plus a token list containing `"5"` and `"9"`.
3. `src/lib/pmsClassification.ts` line 54 → `s === "5" || s === "9"` in `statusLooksCheckedOut`.

Because of this, every guest who is currently **checked in and scheduled to depart today** (statusId 5, departureDate = today) gets `CheckedOut: true` from the sync. That flips `pms_metadata.checkedOutToday`, `readyToClean`, and auto‑releases the `checkout_cleaning` assignment to RTC. That is why 15 rooms show RTC today when Previo's own "checked-out" filter only lists 5 (Q‑101, DB/TW‑102, DB/TW‑302, DB/TW‑304, QRP‑406).

The `is_checkout_room` flag itself is not wrong for today — every one of those 15 rooms does depart today (`isCheckoutRoom = isCheckedOut || isDeparture`). The bug is specifically the **premature RTC / checked-out flip** for guests still in-house.

## Fix

### 1. Correct the Previo status mapping (3 files)

Treat only `6` (Previo "checked out") as checked-out. Keep `9` as a legacy alias just in case some tenants still emit it, but remove `5` everywhere.

- `supabase/functions/previo-pms-sync/index.ts`
  ```ts
  function isCheckedOutStatus(statusId: number): boolean {
    return statusId === 6 || statusId === 9;
  }
  ```
- `supabase/functions/previo-poll-checkouts/index.ts` — update the `n === 5 || n === 9` check to `n === 6 || n === 9`, and drop `"5"` from the token list (keep `"6"`, `"9"`, `"checkedout"`, `"departed"`, …).
- `src/lib/pmsClassification.ts` — in `statusLooksCheckedOut`, replace `s === "5"` with `s === "6"`.

### 2. Persist the raw reservation statusId for auditability

Currently `pms_metadata.reservationStatusId` is null on every synced room (see the query I just ran). Add it in `src/lib/pmsRefresh.ts` alongside the existing metadata write:

```ts
updateData.pms_metadata.reservationStatusId = row.ReservationStatusId ?? null;
```

The sync already emits `ReservationStatusId` in each row (line 673 of `previo-pms-sync/index.ts`), so this is a one-line addition. This makes future incidents diagnosable from the DB without re-reading Previo.

### 3. Revert today's incorrect RTC / checked-out flags

Ten Ottofiori rooms are currently wrongly flagged as checked-out for today (`checkedOutToday=true` and RTC). Revert only these — keep the 5 that Previo truly reports as checked out (101, 102, 302, 304, 406):

Rooms to revert: **103, 105, 201, 202, 205, 305, 402, 403, 404, 405**

For each:
- `rooms`: set `is_checkout_room = false`, `checkout_time = NULL`; in `pms_metadata` remove `checkedOutToday`, `readyToClean`, `checkedOutAt`; keep `scheduledDepartureToday = true` (they still depart today) and set `status = 'dirty'` only if the room already had housekeeping activity — otherwise leave `status` as-is.
- `room_assignments` where `assignment_date = today`, `assignment_type = 'checkout_cleaning'`, `room_id` in the reverted set: set `ready_to_clean = false`.
- Insert a `pms_change_events` row per reverted room with `event_type = 'checkout_cleared'`, `source = 'manual_correction'` for audit.

These will be executed as a single SQL update via the insert/update tool after code changes land, scoped to `hotel = 'Hotel Ottofiori'` and today's date.

### 4. Verification

After the code fix and revert:

- Query `rooms` where `pms_metadata->>'checkedOutToday' = 'true'` → must equal exactly the 5 Previo-confirmed checkouts.
- Query `room_assignments` where `ready_to_clean = true AND assignment_date = today AND assignment_type = 'checkout_cleaning'` → same 5 rooms.
- Trigger a manual PMS Refresh and re-run the same two queries — count must not grow.

## Out of scope

- No change to the "departs today" bucket logic (`is_checkout_room` remains driven by `isCheckoutRoom = isCheckedOut || isDeparture`), so the Checkout Rooms list on the housekeeping board still correctly shows all 15 rooms departing today. Only the RTC / physically-checked-out signal is being corrected.
- No change to `isNoShowStatus` (statusId 8 is correct).
