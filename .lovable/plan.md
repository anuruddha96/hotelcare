

## Plan: Fix Auto-Assignment Dialog Layout & Room Priority

### Problem 1: Layout — All housekeepers should be visible without scrolling
The dialog opens at `max-h-[90vh]` with the content area using `overflow-y-auto`. The housekeeper columns have `minHeight: 300px` and `maxHeight: 50vh` for the room chips area, plus the summary bar and info bar add height. On the user's 762px viewport, this forces scrolling.

**Fix in `AutoRoomAssignment.tsx`**:
- Remove the summary table (`renderSummaryTable`) from below the columns — it's redundant since each column header already shows CO/daily counts, time, and workload bar
- Remove the info bar at the bottom of preview step (line 1301-1305) or make it a single-line inline note
- Change the housekeeper columns container from `minHeight: 300px` to use `flex-1 min-h-0` so it fills available space without forcing a minimum
- Change room chips area `maxHeight: 50vh` to `flex-1 overflow-y-auto` so it adapts to available space
- This ensures all housekeeper columns are visible in one screen with the summary in each column header

### Problem 2: Priority — All rooms set as sequential, not real priority
In `handleConfirmAssignment` (line 467-477), rooms are sorted checkout-first then by floor/number, but priority is just `index + 1`. This means room #1 in the list gets priority 1, room #2 gets priority 2, etc. — no distinction between checkout-ready, daily, and checkout-not-ready.

**Fix in `AutoRoomAssignment.tsx` (`handleConfirmAssignment`)**:
- Assign priority based on room type, not sequential index:
  - **Priority 1**: Early checkout rooms (checkout + ready_to_clean = true) — immediate attention
  - **Priority 2**: Ready-to-clean checkout rooms (checkout + ready_to_clean)
  - **Priority 3**: Daily cleaning rooms
  - **Priority 4**: Checkout rooms not yet ready (guest still in room)
- Sort rooms in this order within each housekeeper's assignment before inserting
- This ensures housekeepers see the most urgent rooms first in their cards

### Files Changed

| File | Changes |
|------|---------|
| `AutoRoomAssignment.tsx` | Remove redundant summary/info below columns, make column heights adaptive, fix priority assignment logic |

