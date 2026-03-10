

## Plan: 4 Improvements

### 1. Supervisor Approval Cards — Better Container Fit

**Problem**: Cards don't fit well in their container, especially on mobile (see screenshot).

**Changes in `SupervisorApprovalView.tsx`**:
- Replace the outer `space-y-3` card list with a tighter layout using `gap-3`
- Make the 4-stat grid (`Cleaned by / Started / Completed / Duration`) use `grid-cols-2` on mobile instead of wrapping randomly
- Constrain the hotel group container to use `w-full` and remove excessive padding
- Make the hotel group header more compact: inline the hotel name, pending count, and Approve All button on one row
- Reduce card padding from `p-4` to `p-3` on mobile, and tighten the inner spacing
- Wrap the assignment card content in a responsive container that doesn't overflow

### 2. Hide PMS Navigation for Non-Admins

**Problem**: PMS nav (Front Desk, Reservations, Guests, Channel Manager) is visible to managers, reception, etc. — should be admin-only while under development.

**Change in `PMSNavigation.tsx`**:
- Add an early return: if `profile?.role !== 'admin'`, return `null`
- This hides the entire PMS sub-navigation bar for all non-admin users
- The route-level access control in each PMS page remains unchanged (they already check `has_pms_access`)

### 3. Hotel Memories Budapest — Zone-Based Assignment

**Problem**: The hotel has 10 wings (A–J), causing the algorithm to fragment assignments across too many tiny wing groups. Eva manually groups rooms into logical zones.

**Analysis of Eva's confirmed patterns (last 14 days):**
```text
Zone 1 "Ground":     002-044 (wings A/B/C, 12 rooms) → always 1 person
Zone 2 "F1-Left":    101,103,105,107,109,115,117,119,121,123,125,127 (wing D, 12 rooms)
Zone 3 "F1-Right":   102,104,106,108,110,111,112,113,114 (wing E, 9 rooms)
Zone 4 "F1-Back":    130-147 (wings F/G/H, 16 rooms) → always 1 person
Zone 5 "F2+F3":      201-217 + 302-308 (wings I/J + F3, 21 rooms)
```

**Solution**: Add a hotel-specific zone mapping override in the algorithm. When the hotel is "Hotel Memories Budapest", remap the wing field to merge related wings into Eva's preferred zones before the grouping step runs.

**Changes in `roomAssignmentAlgorithm.ts`**:
- Add `HotelAssignmentConfig.wingZoneMapping?: Record<string, string>` — maps original wing to zone name
- Before `groupRoomsByWing()`, apply zone mapping if provided: override `room.wing` to the zone
- This collapses 10 wings into 5 zones, producing better groupings

**Changes in `AutoRoomAssignment.tsx`**:
- When generating preview for "Hotel Memories Budapest", pass the zone mapping config:
```typescript
const memoriesZoneMap = {
  'A': 'ground', 'B': 'ground', 'C': 'ground',
  'D': 'f1-left',
  'E': 'f1-right',
  'F': 'f1-back', 'G': 'f1-back', 'H': 'f1-back',
  'I': 'f2-f3', 'J': 'f2-f3',
};
```

### 4. Room Chip Hover Popover with Quick Actions (Replace Tooltip)

**Problem**: Currently hovering shows a read-only tooltip with room info. Clicking opens a dialog. User wants hover to show the actionable options (same as the dialog) to save a click.

**Solution**: Replace the `Tooltip` on room chips with a `Popover` that opens on hover and contains the same quick actions from the dialog — with auto-save on each toggle.

**Changes in `HotelRoomOverview.tsx`**:
- Replace `TooltipProvider > Tooltip > TooltipTrigger/Content` with `Popover` using `open` state controlled by `onMouseEnter`/`onMouseLeave` (with a small delay to prevent flicker)
- The popover content is a compact card with:
  - Room number + status badge (header)
  - Towel toggle (auto-saves on click)
  - Linen toggle (auto-saves on click)
  - Ready to Clean button (auto-saves)
  - Switch Type button (auto-saves)
  - Mark Dirty/Clean button (auto-saves)
  - Manager Notes (textarea with debounced auto-save)
- Remove the click-to-open dialog for room chips (the popover replaces it)
- Keep the dialog only for Room Settings (size, category, bed config) — accessible via a small "⚙️ Settings" link at the bottom of the popover (managers only)
- All actions auto-save immediately with toast feedback
- Popover stays open while cursor is inside it (standard hover popover pattern)
- On mobile: fall back to click-to-open (since hover doesn't exist on touch)

**UI Design**:
```text
┌─────────────────────────┐
│ Room 406  [CLEAN]       │
├─────────────────────────┤
│ 🔄 Towel: Not Required  │  ← toggle, auto-saves
│ 🛏️ Linen: Not Required  │  ← toggle, auto-saves
├─────────────────────────┤
│ ✅ Mark Ready to Clean   │  ← button (checkout only)
│ ⇄  Switch to Daily      │  ← button
│ Mark as Dirty            │  ← status change
├─────────────────────────┤
│ 📝 Notes: [________]    │  ← auto-save on blur
│ ⚙️ Room Settings...      │  ← opens full dialog
└─────────────────────────┘
```

### Files Changed Summary

| File | Changes |
|------|---------|
| `SupervisorApprovalView.tsx` | Tighter card layout, responsive grid, compact hotel headers |
| `PMSNavigation.tsx` | Early return for non-admin users |
| `roomAssignmentAlgorithm.ts` | Add `wingZoneMapping` to config, apply before grouping |
| `AutoRoomAssignment.tsx` | Pass Memories Budapest zone mapping config |
| `HotelRoomOverview.tsx` | Replace tooltip with hover popover + quick actions, auto-save |

