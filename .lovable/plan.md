## Why 401 (and earlier 201/303/403/404/405/203) show as checked out in HC but not in Previo

Looking at `pms_sync_history`, at **09:15:05 UTC today** the cron ran the *previous* version of `previo-poll-checkouts` and marked 8 Ottofiori rooms as checked out with this diagnostic:

> "scheduled departure room is now Previo dirty/untidy with no active reservation payload"
> `roomCleanStatus: 1`, `reservationPresent: false`, `accepted: true`

That is the old "clean‑status only" fallback that we agreed to remove. It fired one last time (the deploy landed a few minutes later), stamped `rooms.pms_metadata.checkedOutToday=true` / `readyToClean=true` / `checkedOutAt=09:15:04Z` and set `is_checkout_room=true`, and released the `checkout_cleaning` assignment for 401 as ready‑to‑clean.

The **09:22** poll (new strict logic) now correctly rejects those same rooms:

> "no reservation payload from Previo REST; room clean status alone is not enough evidence to mark checked‑out" — `accepted: false`

…but nothing **undoes** the earlier false stamps, so the HC UI keeps showing them as RTC checkouts even though Previo still has them as in‑house.

Room **301** is a slightly different case: `pms_metadata.checkedOutToday=false`, `is_checkout_room=false`, but `room_assignments.ready_to_clean=true` on today's `daily_cleaning` assignment. That's a daily/stay clean marked RTC by the manager (or a prior manual toggle), not a checkout — the RTC pill on the card is coming from the assignment row, not from Previo.

## Fix — self‑healing reconciler in the 5‑min poll

Keep the strict "accept only real checkout evidence" rule we already deployed, and add a symmetric **clear** pass in the same run so wrongly‑stamped rooms recover automatically without any manual DB fix.

### 1. `supabase/functions/previo-poll-checkouts/index.ts` — reconcile pass

After computing `departedRooms` for the hotel, load every local room in the hotel that currently has `pms_metadata->>checkedOutToday = true` OR `is_checkout_room = true`. For each of those rooms:

- Look up the matching Previo REST record by `roomId` / room name.
- If Previo **still returns an active `reservation` whose `departureDate` is in the future** (or `departureDate = today` but the reservation is not in a checked‑out status), that is authoritative evidence the guest has NOT departed. Revert the room:
  - `is_checkout_room = false`, `checkout_time = null`
  - `pms_metadata`: set `checkedOutToday=false`, remove `readyToClean` and `checkedOutAt`, keep `scheduledDepartureToday` as reported by the latest refresh.
  - Do **not** flip `status` back to clean automatically; leave whatever the room currently is (housekeeper may already be working).
  - Cancel/clear any auto‑created `checkout_cleaning` assignment for today that is still `assigned` (status not yet `in_progress`/`completed`) and was created by the poll (`created_by is null` / marker) — so the HK doesn't get sent to a still‑occupied room.
- If Previo returns **no reservation payload** for that room but the room was flagged only by the old clean‑status fallback (detectable because `pms_metadata.checkedOutAt` is set but there is no `pms_change_events` row of source `xml-searchReservations` or `rest-room-reservation` for today's `roomId`), treat it as unverified and clear the same way. This is the pattern that produced today's false positives.
- Log each revert into `result.diagnostics` with `source: "reconcile"`, `accepted: false`, and the reason so future runs are debuggable.

Add counters `revertedCheckedOut` and `clearedAssignments` to the `PollResult` and to the row written into `pms_sync_history`.

### 2. Same run — clean up today's stale rows on first execution

The reconciler above will, on the very next `*/5` tick, automatically restore rooms **201, 303, 401, 403, 404, 405, 203** (still in‑house per Previo) back to non‑checkout, drop the false `readyToClean` flag, and cancel the `checkout_cleaning` assignment on 401. No manual SQL / dashboard action needed — that satisfies "let the system run the cron job automatically".

### 3. Frontend RTC badge — small guard

`CompactRoomCard.tsx` / `HotelRoomOverview.tsx` / `AutoRoomAssignment.tsx` already render RTC from `pms_metadata.checkedOutToday || pms_metadata.readyToClean || room_assignments.ready_to_clean`. Once the poll clears the first two, the checkout card RTC pill disappears on the next Realtime tick. For **301** (daily clean with `ready_to_clean=true`), the RTC pill on a *daily* card is expected — if the user does not want RTC pills to appear on non‑checkout daily assignments, we'd scope the pill to `is_checkout_room || assignment_type === 'checkout_cleaning'`. Flagged as a small optional tweak; will only include if you confirm.

### 4. Verification

- Wait for the next `*/5` cron run and inspect the new `pms_sync_history` row: it should show `revertedCheckedOut: 7` and `clearedAssignments: 1` for Ottofiori.
- Re-query `rooms` for 201/303/401/403/404/405/203 — `pms_metadata.checkedOutToday` should be `false`, no `readyToClean`.
- HC Team View / Auto‑Assign should no longer show RTC pills for those rooms.
- When Previo reception actually checks a guest out (statusId=5 or reservation removed with `roomCleanStatus` dirty AND no active reservation still present in the payload for tomorrow), the accept path already handles it and the room will legitimately flip to RTC within 5 minutes.

### Out of scope (not changing)

- Cron schedule (`*/5`), Previo credentials handling, XML fallback behavior, or any UI polling interval.
- The strict accept rules added yesterday — they stay as‑is.

### Confirm before I build

1. OK to auto‑revert a room from `checkedOutToday=true` back to in‑house when the next Previo REST payload still shows an active reservation? (Yes = self‑healing; No = we'd only clear on explicit "occupied" evidence and stale rows would need a manual fix.)
2. For room **301**‑style cases (daily clean marked RTC, not a checkout), do you want the RTC pill hidden on non‑checkout cards, or leave it as is?
