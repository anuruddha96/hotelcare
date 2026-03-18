

## Plan: Drag & Drop Room Chips Between Checkout and Daily Sections

### What It Does
Managers/admins can drag a room chip from "Checkout Rooms" to "Daily Rooms" (or vice versa) to instantly switch its type — no need to open the popover and click "Switch to Checkout/Daily."

### Implementation

**File: `src/components/dashboard/HotelRoomOverview.tsx`**

1. **Add HTML5 drag-and-drop to room chips** (no external library needed):
   - In `renderRoomChip`, add `draggable="true"` for managers/admins
   - `onDragStart`: store room ID and current section type (checkout/daily) in `dataTransfer`
   - Style the chip with slight opacity during drag

2. **Make section containers drop targets** in `renderSection`:
   - Add `onDragOver` (prevent default to allow drop) and `onDrop` handlers
   - On drop: if the room's source section differs from the target section, execute the same switch logic already used in the popover (update `rooms.is_checkout_room` + `room_assignments.assignment_type`)
   - Show visual feedback: highlight the section border/background during `onDragEnter`/`onDragLeave`

3. **State for drag feedback**:
   - Add `dragOverSection: 'checkout' | 'daily' | null` state
   - Apply a subtle highlight (`ring-2 ring-primary/30 bg-primary/5`) on the target section during hover

4. **After drop**: update local state optimistically, then call DB update + `fetchData()` for consistency. Show toast: "Room 101 → Checkout" or "Room 101 → Daily".

### No new dependencies needed — uses native HTML5 Drag and Drop API.

### Files Changed

| File | Changes |
|------|---------|
| `src/components/dashboard/HotelRoomOverview.tsx` | Add drag handlers to chips, drop handlers to sections, visual drag-over feedback |

