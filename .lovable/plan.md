## What I verified in the live data (Hotel Ottofiori, 2026-08-03)

- **Room 401**: `guest_count = 1`, `scheduledDepartureToday = false`, `isNoShow = false`, assignment `daily_cleaning`, `ready_to_clean = true`. So it is currently treated as an occupied stayover, not a no-show.
- **No-show rule is too narrow.** In `previo-pms-sync`, a reservation is flagged no-show only when `arrivalDate === today` **and** `statusId === 8` (or the note literally says "no show"). A guest who never arrived on an earlier date, or whose reservation carries a different Previo status, is silently counted as in-house — which is exactly the 401 case.
- **RTC is wrong on real checkouts.** Today 7 checkout assignments (102, 103, 104, 202, 404, 405, 406) have `ready_to_clean = true` while the room's own `pms_metadata.readyToClean` is not set (guest not confirmed departed). Only 105, 202, 402, 406 rooms carry a PMS `readyToClean` flag. Creation paths disagree: `RoomAssignmentDialog` and `SimpleRoomAssignment` block checkouts correctly, but `pmsRefresh`'s assignment-type reconciliation sets `ready_to_clean = true` for anything it re-types to daily, and once a checkout flag flips the row keeps a stale `true`. Nothing re-blocks a checkout assignment when PMS says the guest has not left.
- **Previo clean-status push has never logged a single run.** `pms_sync_history` has **zero** rows with `sync_type = 'room_status_update'` (all time), and `previo-update-room-status` has no edge-function logs — despite 15 approvals yesterday. Config is fine (`status_push_enabled = true`, `outbound_kill_switch = false`, no allowlist for `ottofiori`), so the break is on the invocation side, not the gate. Root cause still to be confirmed by an instrumented test call.
- **Petra is right about checkout → daily.** The Team View "Switch to Daily" button only sets `rooms.is_checkout_room = false` and the assignment type. But the bucketing function treats `pms_metadata.scheduledDepartureToday === true` as authoritative checkout, and that flag is untouched — so the room instantly snaps back to Checkout Rooms. The drag-and-drop path writes a `manual_checkout` override, the button does not, and neither clears `scheduledDepartureToday`.

## The fix

**1. Manual no-show from a room chip (admins + managers)**
- Add "Mark as No-Show" / "Clear No-Show" to the room chip popover in `HotelRoomOverview.tsx` (same permission gate as the other manager actions).
- Writes `pms_metadata.manualNoShow = { value, at, by }` and surfaces the room in the existing No-Show section with the red ring and an "M" manual marker.
- Marking a no-show removes it from Daily/Arrival buckets, cancels/parks today's not-yet-started assignment for that room, and logs a `pms_change_events` entry (`no_show_marked_manual`) with user + Budapest timestamp.
- Manual marks survive the next PMS refresh for the rest of the day (same stale-override expiry already used for `manual_checkout`).

**2. Better API-side no-show detection**
- In `previo-pms-sync`, widen the rule: flag no-show when the reservation covers today and Previo reports a no-show status, regardless of whether `arrivalDate === today`; keep the note-text fallback.
- Add a corroborating signal: reservation not checked in (never reached status 5/6) while its arrival date is already in the past → no-show candidate.
- No-show rooms report `Occupied = "No"`, `People = 0`, no departure — so `pmsRefresh` stops writing a phantom `guest_count` (401's "1 guest").

**3. Fix RTC (ready to clean)**
- Single rule everywhere: a `checkout_cleaning` assignment is ready to clean **only** when PMS confirms departure (`pms_metadata.readyToClean` / `checkedOutToday`) or a manager releases it manually; `daily_cleaning` is always ready.
- In `pmsRefresh.ts`, apply that rule on every refresh to today's not-started assignments — including re-blocking rows that are wrongly `true` — not only when the assignment type changes.
- Correct today's 7 wrong rows as a one-off so the board is right immediately.

**4. Verify and repair the Previo clean-status push**
- Instrument `pushCleanStatusToPrevio` so failures are visible: log every attempt to `pms_sync_history` (including invocation failures, which currently vanish), and surface a toast with the reason.
- Run a controlled test invoke of `previo-update-room-status` against one mapped Ottofiori room to determine whether the break is the function invocation, hotel resolution, room mapping, or the Previo endpoint itself, then fix the identified cause.
- Fall back to the existing `previo-outbound-worker` queue when the direct call fails, so an approval is never silently lost.

**5. Make manual checkout → daily stick**
- The "Switch to Daily" chip button and the drag-drop path share one helper that: sets `is_checkout_room`, writes the `manual_checkout` override with user + timestamp, **clears `scheduledDepartureToday` / `checkedOutToday`** for the day, updates the assignment type, and resets `ready_to_clean` per rule 3.
- The override is respected by the next PMS refresh for the rest of the day and shows the amber "M" badge so it is auditable.

## Technical notes
Files touched: `src/components/dashboard/HotelRoomOverview.tsx`, `src/lib/pmsRefresh.ts`, `src/components/dashboard/SupervisorApprovalView.tsx`, `src/components/dashboard/AutoRoomAssignment.tsx`, `supabase/functions/previo-pms-sync/index.ts`, and possibly `supabase/functions/previo-update-room-status/index.ts`. Plus translation keys for the new no-show actions across all supported languages, and a one-off data correction for today's RTC rows. No schema change is expected.
