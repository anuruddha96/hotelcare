

## Plan: Auto-Assign Towel Change, Custom Bed Types, Improved Sorting, and Housekeeper Card Visibility

### Summary of Changes (4 areas)

---

### 1. Auto-Assign: Manual Towel Change Toggle Before Assignment

**File: `src/components/dashboard/AutoRoomAssignment.tsx`**

In Step 1 (select-staff), after the staff grid, add a new section "Pre-Assignment Room Settings" that lists all dirty rooms and allows managers to toggle `towel_change_required` for each room before generating the preview. This lets managers plan towel changes in the morning.

- Add a collapsible section below staff selection showing all `dirtyRooms` in a compact grid
- Each room chip has a small towel icon toggle button (T) that updates the local state and the DB `rooms.towel_change_required`
- When toggled, the room's towel status flows into the algorithm (already supported via `calculateRoomTime` and `calculateRoomWeight`)
- Also add a "Select All Towel Change" button for bulk toggling

---

### 2. Custom Bed Requirements (Budapest Hotel Use Case)

**Database Migration:** Add a `bed_configuration` text column to `rooms` table (nullable). This stores the specific bed arrangement set by managers (e.g., "Twin beds separated", "Double bed", "Extra cot"). The existing `bed_type` column has limited values (`single`, `double`, `queen`, `triple`, `shabath`) — this new column stores the **current guest requirement** which can change per stay.

```sql
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS bed_configuration text DEFAULT NULL;
```

**File: `src/components/dashboard/HotelRoomOverview.tsx`** — In the room chip dialog, add a "Bed Configuration" field (text input or dropdown with common options + custom) under Room Settings. Only managers/admins can set it. Options: "Double Bed", "Twin Beds", "Twin Beds Separated", "Extra Cot Added", "Single Bed", or custom text.

**File: `src/components/dashboard/AutoRoomAssignment.tsx`** — Fetch `bed_configuration` in the rooms query. Show it on room chips in the preview (small icon/label like "🛏️ Twin Sep").

**File: `src/components/dashboard/AssignedRoomCard.tsx`** — Display `bed_configuration` prominently in a dedicated info row (alongside floor number) so housekeepers clearly see what bed arrangement the guest needs. Show it with a bed icon and distinct styling.

**File: `src/components/dashboard/MobileHousekeepingView.tsx`** — Include `bed_configuration` in the rooms query.

**File: `src/components/dashboard/HousekeepingStaffView.tsx`** — Include `bed_configuration` in the rooms query.

**File: `src/lib/roomAssignmentAlgorithm.ts`** — Add `bed_configuration` to `RoomForAssignment` interface.

---

### 3. Fix Room Priority/Sorting Order

Current sorting logic in `HousekeepingStaffView.tsx` and `MobileHousekeepingView.tsx` is almost correct but has issues:
- Checkout rooms waiting for guest (`ready_to_clean=false`) should sort AFTER daily rooms that are ready
- Ready-to-clean checkout rooms should be first
- Same floor rooms should be grouped together
- High priority rooms should always be at top (after in-progress)

**New sort order (all 3 files + PendingRoomsDialog):**

1. `in_progress` always first
2. High priority rooms (`priority >= 3`) — regardless of type
3. Ready checkout rooms (`checkout_cleaning` + `ready_to_clean=true`)
4. Daily rooms — grouped by floor, then room number
5. Checkout rooms waiting (`checkout_cleaning` + `ready_to_clean=false`) — at bottom
6. Completed rooms last

**Files to update sorting:**
- `src/components/dashboard/HousekeepingStaffView.tsx` (lines 174-208)
- `src/components/dashboard/MobileHousekeepingView.tsx` (lines 189-223)
- `src/components/dashboard/PendingRoomsDialog.tsx` (lines 86-91) — replace simple numeric sort with the same priority logic

---

### 4. Redesign AssignedRoomCard Special Instructions Visibility

**File: `src/components/dashboard/AssignedRoomCard.tsx`**

Currently, towel/linen badges are small badges in the header. Bed configuration doesn't exist yet. Manager notes are shown but could be more prominent. Redesign the top of the card to have a **"Special Instructions" banner** that consolidates:

- Towel change required → prominent yellow banner with icon
- Linen change required → prominent purple banner with icon  
- Bed configuration → prominent blue banner with bed icon and the configuration text
- Manager notes → already amber banner (keep as-is)

Move these from small header badges to a dedicated, unmissable section right after the card header, before room details. Use larger text and bolder styling.

---

### Files Changed Summary

| File | Changes |
|------|---------|
| **Migration** | Add `bed_configuration` column to `rooms` |
| `AutoRoomAssignment.tsx` | Add towel change toggle section in Step 1, fetch `bed_configuration`, show on preview chips |
| `HotelRoomOverview.tsx` | Add bed configuration selector in room chip dialog |
| `AssignedRoomCard.tsx` | Redesign special instructions section with prominent banners for towel/linen/bed config |
| `HousekeepingStaffView.tsx` | Fix sorting, add `bed_configuration` to query |
| `MobileHousekeepingView.tsx` | Fix sorting, add `bed_configuration` to query |
| `PendingRoomsDialog.tsx` | Fix sorting to match housekeeper priority order, fetch `bed_configuration` and show it |
| `roomAssignmentAlgorithm.ts` | Add `bed_configuration` to `RoomForAssignment` interface |

