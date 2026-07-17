## Plan

### 1. Add Nykipanchuk_073 to Auto-Assign housekeeper list

**Root cause:** In `src/components/dashboard/AutoRoomAssignment.tsx` (line 245), the staff query filters `assigned_hotel = hotelName` where `hotelName = getManagerHotel()`. Nykipanchuk_073's profile has `assigned_hotel = 'ottofiori'` (the hotel key), but the manager's `getManagerHotel()` typically returns the display name (`'Hotel Ottofiori'`). Rooms use `resolveHotelKeys()` to accept both — the staff query does not, so she's filtered out.

**Fix:** Use `resolveHotelKeys(hotelName)` for the staff query too, using `.in('assigned_hotel', keys)` instead of `.eq('assigned_hotel', hotelName)`.

### 2. Hide "Towel Change" badge on Checkout Clean rooms

**Root cause:** `AssignedRoomCard.tsx` renders the towel-change badge whenever `assignment.rooms?.towel_change_required` is true, regardless of whether the room is a checkout clean. Checkout cleans always include a full towel swap.

**Fix (presentation only):** In `AssignedRoomCard.tsx`, gate every towel-change UI branch (lines ~712, ~799, ~855, ~1572 and the `instructionCount` counter on line 713) behind `!isCheckout`, where `isCheckout = assignment.rooms?.is_checkout_room || assignment.rooms?.pms_metadata?.scheduledDepartureToday === true`. This mirrors the algorithm's own logic in `roomAssignmentAlgorithm.ts` (line 94) which already skips the towel-change time bump on checkouts.

### 3. Root-cause fix for "Room XXX — minibar used" popup on days with no new consumption

**Root cause:** The supervisor's minibar confirmation gate in `SupervisorApprovalView.tsx` (`fetchMinibarForRooms`, line 171) selects all `room_minibar_usage` rows with `is_cleared = false` for the room — **with no date filter**. When the supervisor confirms "refilled + added to Previo" and clicks Confirm & Approve, `performApproval` / `performBulkApprove` (lines 593 / 681) only update `room_assignments`; they never flip `is_cleared` on those minibar rows. So the same uncleared row (e.g. Room 403 Beer from Jul 15, which still shows `is_cleared=false` in the DB) re-triggers the popup on every subsequent day's approval, even though no housekeeper logged anything that day. This matches the user's report — 403's Beer 5€ is exactly what image 2 shows, and the DB confirms it's still uncleared.

**Fix:** After the supervisor passes the gate and approval completes successfully, mark the associated minibar rows as cleared so they don't re-appear:

- Extract the minibar row IDs inside `fetchMinibarForRooms` and pass them through the gate state (`minibarGate.usageIds: string[]`).
- After `performApproval` / `performBulkApprove` succeeds, update those rows with `is_cleared = true, guest_checkout_date = now()`.
- Scope the update to the exact IDs shown in the gate (so items added *after* the gate opened aren't wrongly cleared).

No schema changes; presentation + write already allowed by existing RLS on `room_minibar_usage`.

### Files touched

- `src/components/dashboard/AutoRoomAssignment.tsx` — broaden staff hotel filter with `resolveHotelKeys`.
- `src/components/dashboard/AssignedRoomCard.tsx` — hide towel-change badge/instruction row when checkout clean.
- `src/components/dashboard/SupervisorApprovalView.tsx` — carry minibar row IDs through the gate and mark `is_cleared=true` after supervisor approval.

No DB migrations, no edge-function changes.