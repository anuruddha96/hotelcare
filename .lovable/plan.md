## Fix Previo cron sync + let managers toggle RTC

### Root cause (why 401 keeps flipping off RTC)

Timeline for 401 today (from `pms_change_events`):
- 09:34 poll marked 401 checkout_confirmed → RTC.
- 09:43 manager reverted (manual clarification).
- 09:36 manager re-verified → RTC.
- **10:00 cron reconcile step (3.5) reverted again** with reason "no reservation payload from Previo and no confirming checkout event today".

Ottofiori's Previo REST returns **no reservation payload** on `/rest/rooms`, and its XML `searchReservations` fails with 401. The reconcile step therefore reverts every legitimately-RTC checkout room on every 5-min run. Same story for 305 (it stays on hold, which is correct, but for the wrong reason — it's held by reconcile, not by real Previo data).

### Requirements from user

1. Cron every 5 min pulls Previo, marks checkout rooms RTC when Previo confirms. Once all today's checkout rooms are RTC → cron becomes a no-op (still scheduled, just returns early).
2. Trust Previo, not manual data — but never remove an RTC flag automatically.
3. Managers/admins can click a room chip to manually toggle RTC on/off.

### Changes

#### 1. `supabase/functions/previo-poll-checkouts/index.ts` — rewrite the pipeline

- **Early exit**: at the top of `pollOneHotel`, load today's `room_assignments` for the hotel where `assignment_type='checkout_cleaning'` and `ready_to_clean=false`. If zero rows → return an "idle" result immediately. This satisfies "cron doesn't need to run after all are RTC".
- **Signal sources for RTC** (any one is sufficient for a room already scoped as a checkout):
  a. Previo REST reservation `statusId=5/9` or checked-out tokens (existing).
  b. Previo XML `searchReservations` departure today with checked-out status (existing).
  c. Previo REST `roomCleanStatusId` transitioning to a "guest gone" value (typically 1/dirty after reception clears the room). This is scoped **only to rooms whose local assignment is a not-yet-RTC checkout_cleaning today** — so it cannot mark unrelated in-house rooms as checked out (the earlier false-positive class stays impossible).
- **Never revert RTC**: delete the reconcile step (3.5) that flips `ready_to_clean` back to false and re-applies `pms_hold` based on missing reservation payloads. Reconcile is the exact code that breaks Ottofiori and violates "don't auto-remove RTC".
- **Never clear checkout flag** on rooms that have an `checkout_confirmed` / `manager_verified_previo` event today — tighten step 4 (stale cleanup) accordingly.
- Keep `pms_hold` behavior for **not-yet-RTC** rooms: if Previo actively reports the reservation is still in-house (departure > today, or reservation present without departed status), keep the hold reason updated. Do not touch RTC rooms.

#### 2. `HotelRoomOverview.tsx` — manager/admin RTC toggle from chip popover

- Below the existing "Mark ready to clean" button, add a "Revert ready to clean" button visible only to admin / manager / housekeeping_manager / top_management when `assignment?.ready_to_clean === true`.
- Handler: update `room_assignments.ready_to_clean = false`, `pms_hold = false`, insert a `pms_change_events` row (`event_type='rtc_reverted_manual'`, source='manager_ui') so cron won't immediately re-flip and there's an audit trail.
- Wrap both buttons so admin/manager can toggle RTC either direction from the chip popover.

#### 3. No schema changes, no cron schedule change (already every 5 min)

### Verification

1. Deploy edge function → invoke once via `supabase--curl_edge_functions` with `{trigger:"cron"}` and confirm 401 flips to RTC and stays RTC across two consecutive runs.
2. Query `room_assignments` for Ottofiori today: expect 401 RTC, 305 held (not RTC).
3. In the UI as admin: open room chip → toggle RTC off → wait 5 min → confirm it does NOT get auto-restored (only re-flipped when Previo reports checkout again OR admin toggles it back).
4. Confirm the 9 other Ottofiori checkout rooms remain RTC unchanged.
