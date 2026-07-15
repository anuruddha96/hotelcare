## Goal

Make PMS-confirmed "Ready To Clean" (RTC) status visible on both room cards and the Auto-Assign room chips, and keep the app actively polling Previo for new checkouts until every checkout room for the day is RTC — so HK managers no longer need to open Previo.

## 1. Show RTC on the Auto-Assign room chips

File: `src/components/dashboard/AutoRoomAssignment.tsx` (`renderRoomChip`, ~L839)

- Compute `isRtc = room.is_checkout_room && (room.pms_metadata?.checkedOutToday === true || room.pms_metadata?.readyToClean === true)`.
- When true, append a small green `RTC` pill inside the chip (same green as the room-card RTC badge: `bg-green-600 text-white text-[9px] font-extrabold px-0.5 rounded`).
- Update the chip `title` to include "· RTC" when applicable.
- No change to assignment logic — RTC is already written to `room_assignments.ready_to_clean` in `handleConfirmAssignment`.

## 2. Show RTC on the room cards before assignment exists

Today the green `RTC` badge in `HotelRoomOverview.tsx` only renders when `assignment?.ready_to_clean` is true. Between a PMS sync and Auto-Assign confirmation, PMS-confirmed departures already carry `pms_metadata.checkedOutToday=true` / `readyToClean=true` on the `rooms` row but no chip is shown.

Files:
- `src/components/dashboard/HotelRoomOverview.tsx`
  - Extend the RTC render condition (~L632) to also fire when there's no assignment yet and `room.pms_metadata?.checkedOutToday === true` (or `readyToClean === true`) and `room.is_checkout_room`.
  - Make sure the `select('...')` on `rooms` includes `pms_metadata` (already does).
- `src/components/dashboard/CompactRoomCard.tsx`
  - Add the same small `RTC` pill next to the "Checkout Room" badge when `room.is_checkout_room` and `room.pms_metadata?.checkedOutToday === true`.
  - Add `pms_metadata?: any` to the local `Room` interface.

Legend entry in `HotelRoomOverview.tsx` (already present) stays unchanged.

## 3. Proactive checkout polling until all RTC

File: `src/contexts/LiveSyncContext.tsx` (`runCheckouts`, useEffect at ~L228)

Current behavior: `runCheckouts` is hard-gated to `hotelId === "previo-test"` and runs every 10 min. We remove the test-hotel gate for enabled hotels with an active Previo config, and add an adaptive interval:

- Keep the existing `previo-poll-checkouts` edge function call (it already flips `pms_metadata.readyToClean` + `room_assignments.ready_to_clean`, and emits `pms_change_events`).
- Remove the `hotelId !== "previo-test"` guard.
- After each poll, query how many `is_checkout_room=true` rooms for today are NOT yet RTC (either `pms_metadata->>readyToClean != 'true'` OR no matching row in `room_assignments` with `ready_to_clean=true` for `assignment_date=today, assignment_type='checkout_cleaning'`). Store this count in the `checkouts` task meta so we can show it later if needed.
- Interval logic:
  - If `pendingCheckouts > 0`: poll every 5 min.
  - If `pendingCheckouts === 0`: stop the interval (clear it) and only re-poll on window focus or manual PMS refresh.
  - Recreate the interval whenever the pending count transitions back above 0 (e.g. after a new PMS sync brings in fresh checkouts).
- Also trigger `runCheckouts(true)` immediately after a successful manual `runPms` finishes, so managers see RTC updates without waiting for the next tick.

No schema changes. No new edge function.

## 4. Verification

- `bunx vitest run` for any affected tests.
- Manual: on a hotel with pending checkouts, confirm the auto-assign chip shows `RTC` for departed rooms, the room card shows the `RTC` badge before assignment, and the `LiveSyncIndicator` "checkouts" task ticks every ~5 min until all checkout rooms are RTC, then goes quiet.

## Technical notes

- RTC source of truth on the `rooms` row: `pms_metadata.checkedOutToday === true` (set by `previo-poll-checkouts` and by `pmsRefresh` when PMS reports the guest has departed). `readyToClean` mirror kept for backwards compatibility.
- RTC source of truth on `room_assignments`: `ready_to_clean=true` (already written by both flows).
- Polling stop condition is calculated after each poll from a lightweight `select('id, pms_metadata')` on `rooms` filtered by `hotel = profile.assigned_hotel` and `is_checkout_room = true` for today.
