

## Plan: Minibar Tracking Visibility, Guest Item Blocking, Supervisor Refill Flow, and Multi-Day Stay Aggregation

This plan addresses 4 interconnected issues with the minibar system.

---

### Problem 1: Minibar Usage Not Appearing in Tracking View

**Root cause**: The `MinibarTrackingView` query filters by the selected date using `startOfDay(selectedDate)` to `endOfDay(selectedDate)`. However, the housekeeper records minibar usage via `RoomDetailDialog`, which sets `usage_date: new Date().toISOString()` -- this uses the current timestamp. If the manager views a different date, or if the `is_cleared` flag was set prematurely (e.g., during PMS upload the previous night), records won't appear.

Additionally, the `RoomDetailDialog` inserts records WITHOUT a `source` field, so they default to `'staff'` in the database. This is correct behavior, but the insert also doesn't set `organization_slug`, which could cause filtering issues.

**Fix in `src/components/dashboard/RoomDetailDialog.tsx`**:
- Add `source: 'staff'` and `organization_slug` to the minibar usage insert call (line 237-245)
- This ensures records are properly attributed and visible

**Fix in `src/components/dashboard/MinibarTrackingView.tsx`**:
- The hotel filtering logic (lines 398-410) does a secondary query to resolve hotel name. This async resolution might fail silently. Simplify it to filter directly using `rooms.hotel` from the joined data, which is already fetched.

---

### Problem 2: Guest Item Blocking (QR Scanned Items Should Be Locked for Housekeepers)

**Current state**: When a guest scans the QR and submits usage, the housekeeper still sees all items as addable in `RoomDetailDialog`. There's no indication that a guest already reported an item.

**Changes in `src/components/dashboard/RoomDetailDialog.tsx`**:
- When displaying minibar items, check if each item already has a usage record with `source: 'guest'`
- If yes, show the item as "already reported by guest" with a distinct visual indicator (amber/locked badge) instead of the +/- buttons
- The housekeeper can see what the guest reported but cannot double-add it
- Staff can still override guest records (existing dedup logic handles this)

**Changes in `src/pages/GuestMinibar.tsx`**:
- Before rendering items, fetch existing usage for this room today (using the room token lookup)
- Items already recorded (by guest or staff) should show as "Already recorded" with a checkmark, preventing duplicate submissions
- This gives guests clear feedback that their previous scan was successful

---

### Problem 3: Supervisor Approval Triggers Minibar Refill (Reset for Daily Rooms)

**Current state**: When a supervisor approves a completed room, there is no minibar reset logic. For daily rooms (non-checkout), the guest stays another night, and the minibar should be considered "refilled" so the guest can report usage again the next day.

**The system already handles this correctly by design**: Each day's usage is filtered by date (`usage_date` within that day's range), so a new day automatically allows new records. The `is_cleared` flag is only set during PMS upload or manual clearing, which handles checkout rooms.

However, for the guest QR page, the duplicate check uses `is_cleared: false` for the current day -- if a guest stays multiple days, each new day they can submit again because old records are from previous days. This already works.

**No code change needed** for the refill flow -- the date-based filtering inherently resets availability each day.

---

### Problem 4: Multi-Day Stay Aggregation for Reception

**Current state**: The `MinibarTrackingView` only shows a single selected day's data. For guests staying multiple days, reception cannot see the total minibar consumption across the entire stay.

**Changes in `src/components/dashboard/MinibarTrackingView.tsx`**:
- Add a "Stay View" toggle next to the date picker for reception/manager users
- When toggled ON, for each room with usage, look up `guest_nights_stayed` from the `rooms` table
- Expand the date range query to cover the last N days (where N = `guest_nights_stayed`) instead of just the selected date
- Show aggregate totals per room across the entire stay period with a "Full Stay" badge
- Reception can then see "Room 205: Guest stayed 3 nights, total minibar: EUR 15.00"

---

### Technical Summary

| File | Changes |
|------|---------|
| `src/components/dashboard/RoomDetailDialog.tsx` | Add `source: 'staff'` and `organization_slug` to insert. Show guest-reported items as locked/indicated. |
| `src/components/dashboard/MinibarTrackingView.tsx` | Add "Stay View" toggle for multi-day aggregation. Fix hotel filtering reliability. |
| `src/pages/GuestMinibar.tsx` | Fetch existing usage for the room; show already-recorded items as checked/locked. |

