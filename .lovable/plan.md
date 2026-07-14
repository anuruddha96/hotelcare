## Root cause of the wrong "C/O+1" badges

`previo-pms-sync` (used by the blue **PMS Sync** button) has a fallback that runs when Previo's XML reservation feed returns empty. It rebuilds today's picture from `pms_upload_summary` — but throws away the real `currentNight`/`totalNights` stored there and synthesizes every daily row as `arrivalDate = today-1`, `departureDate = tomorrow`. That's why every daily room in the DB now shows `guest_nights_stayed=2` and `scheduledDepartureTomorrow=true` (101 2/3, 202 2/3, 301 2/4, 403 4/4 all look identical: `C/O+1`).

The XLS upload path itself is correct — the summary rows already contain the real nights (verified: 101→2/3, 301→2/4, 403→4/4). Only the sync fallback is discarding them.

Separately, you want checkout auto-detection: when Previo marks a room "checked out" (Occupied=No + a status/departure signal), the app should auto-flip the room to *Ready to Clean* without touching housekeeper assignments.

---

## Changes

### 1. Fix `supabase/functions/previo-pms-sync/index.ts` fallback (lines ~289–348)

Use the real per-row fields already stored in `pms_upload_summary`:

- For each daily row, compute `arrivalDate = today − (currentNight − 1)` and `departureDate = today + (totalNights − currentNight + 1)` using the stored `currentNight`/`totalNights` (fallback to today/tomorrow only when missing).
- For each checkout row, keep `departureDate = today`, but derive `arrivalDate` from `totalNights` when present.
- Pass through `guestCount` and `notes` unchanged.

Result: after sync, `Night / Total` and `DepartureTomorrow` mirror the last real XLS upload instead of collapsing everything to 2/2 + depart-tomorrow.

### 2. Harden the row emitter (same file, ~line 384–397)

Even when the fallback path runs, only set `DepartureTomorrow: true` when `departureDate === tomorrow` (already true) AND `currentNight === totalNights`. Belt-and-braces so a stale/short reservation can never mark a mid-stay room as C/O+1.

### 3. Backfill today's Ottofiori rooms (one-shot SQL)

Reset the wrongly-flagged daily rooms so today's Team View is correct without waiting for the next sync:

```sql
-- For each currently-daily room, restore night data from today's upload summary
-- and clear scheduledDepartureTomorrow unless currentNight === totalNights.
```

Runs once, targeted to Ottofiori, only touches PMS fields (`guest_nights_stayed`, `pms_metadata.scheduledDepartureTomorrow`, `pms_metadata.departureTime`). No `room_assignments` writes.

### 4. Auto-mark checkout rooms Ready-to-Clean from Previo

Add a lightweight poller that runs on Previo XML tenants (Ottofiori today) every ~5 min:

- **Edge function:** extend `previo-poll-checkouts` (already exists) to run for all XML hotels, not just `previo-test`. It calls `searchReservations` for `[today, today+1)`, and for each reservation with `statusId = 5` (checked-out) OR whose object's live occupancy flips to "no" while `departureDate === today`, it:
  - Finds the matching `rooms` row (same lookup used elsewhere).
  - Updates ONLY: `is_checkout_room = true`, `pms_metadata.checkedOutToday = true`, `pms_metadata.readyToClean = true`, `pms_metadata.checkedOutAt = now()`.
  - **Does NOT touch `status`** if there's an active `room_assignments` row (`assigned` / `in_progress`) — that's the housekeeper's workflow. It only writes a `pms_change_events` row of type `checkout_confirmed` so the manager sees it in the PMS drawer.
  - **Only when there is no active assignment** does it also set `status = 'dirty'` so the room appears in the "checkout / ready to clean" bucket automatically.
- **Scheduler:** add a Supabase cron (`pg_cron` via migration) hitting the function every 5 minutes.
- **Idempotent:** each run is a diff — rooms already flagged `checkedOutToday=true` today are skipped, so no repeated writes and no assignment churn.

### 5. Assignment-safety guarantees (called out in code comments)

Neither the fallback fix nor the auto-checkout poller ever:
- writes to `room_assignments`
- clears `assigned_to` / `assigned_housekeeper_id` on `rooms`
- flips `status` on a room with an active assignment

The only field that can transition against an in-progress assignment is `is_checkout_room = true` (with a `pms_hold` event queued) — exactly the same protection the manual PMS Sync already uses.

### 6. Small UI polish

`HotelRoomOverview.tsx`: the C/O+1 chip already gates on `scheduledDepartureTomorrow && !scheduledDepartureToday`. Add one more gate: `pms_metadata.currentNight === pms_metadata.totalNights` when both are present, so even a bad upstream flag can't paint a mid-stay room.

---

## Verification

1. Backfill runs → Team View for Ottofiori shows only 403 / 305 / 404 / 203 with `C/O+1` (their real 2/2, 3/3, 4/4 rows), while 101/202/301/302/304 are plain daily.
2. Click **PMS Sync** → the same picture holds. `pms_change_events` shows no spurious `status_changed` rows.
3. On Previo, mark a room checked-out → within 5 min the room's chip flips to Checkout / Ready to Clean; if a housekeeper was mid-cleaning, the assignment stays intact and a `pms_change_events` row appears in the manager's drawer.

## Not doing

- No changes to the PMS Upload XLS parser (already correct).
- No changes to the blue PMS Sync button, admin toggle, or existing checkout badges.
- No schema changes beyond enabling the cron.
