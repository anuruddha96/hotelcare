

## Plan: Drag-and-Drop Room Reassignment + Room Size Configuration

### Change 1: Drag-and-Drop in Auto Room Assignment Preview

**File:** `src/components/dashboard/AutoRoomAssignment.tsx`

Replace the current click-to-select-then-click-to-move flow with native HTML5 drag and drop:

- Each room chip becomes `draggable`, with `onDragStart` setting the room ID and source staff ID
- Each staff Card becomes a drop zone with `onDragOver` (allow drop) and `onDrop` (execute move)
- Visual feedback: highlight the drop target card with a blue dashed border when dragging over it
- Keep the existing click-to-reassign as fallback for mobile (touch devices don't support HTML5 drag well)
- Show a small "drag rooms to reassign" hint text instead of "click on a room to reassign it"
- Room chips show size indicator: "S" (under 20m2), "M" (20-27m2), "L" (28-39m2), "XL" (40m2+) so managers can see weight at a glance
- Show the room's estimated clean time below each chip on hover (already in title, make it visible)

**Preview UI Improvements:**
- Simplify the per-staff justification section -- collapse into a single line: "6 CO + 8 Daily | Floors 1,2,3 | Weight: 17.0 (Fair)"
- Make the Fairness Summary card more compact
- Add room count and time summary inline with staff name instead of separate badges

### Change 2: Room Size Configuration in Room Management

**Files:** `src/components/dashboard/RoomDetailDialog.tsx`, `src/components/dashboard/RoomManagement.tsx`

Add room size (sqm) and capacity fields so admins can configure them:

**RoomDetailDialog.tsx:**
- Add `room_size_sqm` and `room_capacity` fields to the Room interface
- Fetch these fields from the room data
- Add editable number inputs for "Room Size (m2)" and "Room Capacity" in the room status section (visible to admin/manager only)
- Save changes when status is updated, or add a separate "Save Room Details" button
- The DB column `room_size_sqm` already exists, so no migration needed

**RoomManagement.tsx (create form):**
- Add "Room Size (m2)" and "Room Capacity" number inputs to the create room dialog (lines 560-570 area)
- Include `room_size_sqm` and `room_capacity` in the insert payload

### Change 3: Bulk Room Size Update

**File:** `src/components/dashboard/RoomDetailDialog.tsx`

Since configuring 69+ rooms one by one is tedious, add a note in the Room Detail dialog suggesting bulk edit. The actual bulk editing can be done through the existing Bulk Room Creation or a future feature -- for now, individual room editing is the starting point.

### Summary of Changes

| File | Change |
|------|--------|
| `AutoRoomAssignment.tsx` | Add HTML5 drag-and-drop for room chips; visual size indicators (S/M/L/XL); simplified staff card layout; drop zone highlighting |
| `RoomDetailDialog.tsx` | Add room_size_sqm and room_capacity editable fields for admin/manager; save on update |
| `RoomManagement.tsx` | Add room_size_sqm and room_capacity to create room form and insert payload |

### Technical Details

**Drag-and-Drop implementation (AutoRoomAssignment.tsx):**

```text
// On room chip:
draggable
onDragStart={(e) => {
  e.dataTransfer.setData('roomId', room.id);
  e.dataTransfer.setData('fromStaffId', preview.staffId);
}}

// On staff Card:
onDragOver={(e) => e.preventDefault()} // allow drop
onDrop={(e) => {
  const roomId = e.dataTransfer.getData('roomId');
  const fromStaffId = e.dataTransfer.getData('fromStaffId');
  if (fromStaffId !== preview.staffId) {
    moveRoom(previews, roomId, fromStaffId, preview.staffId);
  }
}}
```

State for drag visual feedback:
- `dragOverStaffId: string | null` -- set on dragEnter/dragLeave to highlight the target card

**Room size indicators on chips:**
- Under 20m2: no indicator (standard)
- 20-27m2: "M" badge
- 28-39m2: "L" badge (amber)
- 40m2+: "XL" badge (red)

**RoomDetailDialog room size fields:**
- Two new `Input type="number"` fields in the Room Status card
- On save, update `room_size_sqm` and `room_capacity` alongside status/notes
- Add local state: `roomSize` and `roomCapacity` initialized from room data
- Requires updating the Room interface to include these fields
- The select query in RoomManagement already fetches `*` so the data is available

**RoomManagement create form:**
- Add to `newRoom` state: `room_size_sqm: ''` and `room_capacity: ''`
- Add two Input fields after "Floor Number"
- Include in insert: `room_size_sqm: newRoom.room_size_sqm ? parseFloat(newRoom.room_size_sqm) : null`
