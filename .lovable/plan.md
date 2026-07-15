## Fix: cron isn't marking 305 as RTC even though Previo shows it checked out

### Diagnosis (from live poll diagnostics, hotel `ottofiori`)

Every room in Ottofiori's `/rest/rooms` response comes back **without any reservation payload** (`reservationPresent: false`). Example rows from the latest poll:

- `DB/TW-305 → localScheduledDepartureToday=true, roomCleanStatus=1, reservationPresent=false → accepted=false`
- `DB/TW-401 → localScheduledDepartureToday=true, localIsCheckoutRoom=true, reservationPresent=false → accepted=false` (401 is RTC only because a manager toggled it manually)

Meanwhile Ottofiori's XML `searchReservations` returns 401 (ApiKey tenant, XML endpoint refuses). So today's poll has **zero signals** it accepts, `departed=0`, `marked=0`. That is why 305 sits at `pms_hold=true, ready_to_clean=false` forever — not a bug in the assignment or UI, but a missing signal path in the poller for this tenant class.

The rule in the current code is "reservation payload required to accept a checkout". That rule can never be satisfied on Ottofiori, so cron never marks RTC on its own for any Ottofiori checkout room.

### Fix (poller-only; no manual data changes, no schema changes)

Add a third checkout signal to `supabase/functions/previo-poll-checkouts/index.ts` — the one the earlier plan already described but that never landed. Keep the two existing signals unchanged.

**New signal (c) — "scheduled departure + guest no longer in Previo":**

For each Previo REST room where:
1. `localScheduledDepartureToday === true` on the mapped local room, AND
2. There is a matching **local `checkout_cleaning` assignment today with `ready_to_clean=false`** (this is the guard — we only ever act on rooms already scoped as today's checkouts), AND
3. Previo's REST payload for that room has **no active reservation object** (or the reservation's `departureDate` is today and `arrivalDate <= today`, meaning the stay has ended),

→ treat this as `checkout_confirmed`, source `poll_checkouts_rest_scheduled_gone`.

Rationale: on Ottofiori the reservation object drops off `/rest/rooms` the moment reception completes the checkout in Previo. Combined with the local "scheduled to depart today + still waiting for RTC" guard, this cannot mark unrelated in-house rooms — those rooms don't have a not-yet-RTC checkout_cleaning assignment today.

Signals (a) statusId=5/9 in REST reservation and (b) XML `searchReservations` remain as-is for tenants where they do fire (Privio-test etc.).

### Explicit non-changes

- Do **not** manually flip 305 in the DB — the user asked for cron to do it.
- Do **not** touch the "never auto-revert RTC" rule or the stale-cleanup filter — 401 must stay RTC.
- Do **not** widen the signal to any room with `roomCleanStatusId=1` — that would false-positive on in-house rooms. The guard is the local `checkout_cleaning + ready_to_clean=false` assignment today.
- No cron schedule change (already every 5 min); early-exit stays in place so once all today's checkouts are RTC the run is a no-op.

### Verification

1. After deploy, invoke `previo-poll-checkouts` with `{hotelId:"ottofiori"}` and confirm 305 diagnostic flips to `accepted: true, source: "rest-room-scheduled-gone"`, `marked >= 1`, and `pms_change_events` gets a new `checkout_confirmed` row for 305.
2. Requery `room_assignments` for 305 today: expect `ready_to_clean=true, pms_hold=false`.
3. Requery 401: still `ready_to_clean=true` (untouched — reconcile is still deleted).
4. Second run 5 min later: early-exit fires for Ottofiori if all remaining checkouts are RTC (`marked=0`, diagnostics = `early-exit`).

### Technical notes

- File touched: `supabase/functions/previo-poll-checkouts/index.ts` only.
- Load the pending checkout_cleaning assignments once at the top of `pollOneHotel` (already loaded for early-exit — reuse the set of `room_id`s).
- In the `for (const r of rooms)` loop, when `!res` and `localMatch` and `localMatch.id ∈ pendingCheckoutRoomIds`, call `addCheckoutSignal(r.name, r.roomId, "", "rest-room-scheduled-gone")` and add a matching diagnostic with `accepted: true`.
- No change to Section 3 (per-departed-room processing), Section 3.5 (still removed), or Section 4 (stale cleanup).