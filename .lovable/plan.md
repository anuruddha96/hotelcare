

## Plan: Draggable and Rotatable Wing Containers in Map View

### Overview

Enable admins to drag, rotate, and reposition wing containers in the Hotel Room Overview Map view so the digital layout matches the physical hotel floor plan. Room numbers and text inside wings always remain upright and readable.

### Approach

Use a free-form canvas where each wing container is absolutely positioned. Admins can:
- **Drag** wing containers to any position on the canvas
- **Rotate** wing containers via a small rotation handle (or rotation controls)
- Room numbers, badges, and text inside wings **counter-rotate** so they always read normally

Layout is saved per hotel per floor to the database so all managers see the same map.

### Database Storage

Add a new table `hotel_floor_layouts` to persist wing positions and rotations:

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| hotel_name | text | Hotel identifier |
| floor_number | integer | Floor (0, 1, 2, 3) |
| wing | text | Wing letter (A, B, etc.) |
| x | numeric | X position (percent of canvas) |
| y | numeric | Y position (percent of canvas) |
| rotation | numeric | Rotation in degrees |
| updated_by | uuid | Last editor |
| updated_at | timestamptz | Last update time |

Unique constraint on `(hotel_name, floor_number, wing)`.

### UI Design

**For admins in Map view:**
1. An "Edit Layout" toggle button appears next to the Map/List toggle
2. When enabled:
   - Wing containers become draggable (cursor changes to grab)
   - A small rotation handle appears on each wing (circular arrow icon)
   - Click+drag the rotation handle to rotate the wing
   - A "Save Layout" button appears to persist changes
   - A "Reset" button restores default positions
3. When disabled (normal mode):
   - Wings display at their saved positions/rotations
   - Room cards are clickable as before (for editing size/category)

**Counter-rotation of content:**
- The wing container div gets `transform: rotate(Xdeg)`
- All inner content (room chips, wing label, view text) gets `transform: rotate(-Xdeg)` so text stays upright
- This is applied via inline styles

### Default Positions

When no saved layout exists, wings use a grid-based default layout (similar to current flex layout but converted to x/y coordinates). This ensures the map looks normal before any admin customization.

### Files to Create/Modify

| File | Changes |
|------|---------|
| `supabase/migrations/...` | Create `hotel_floor_layouts` table with RLS |
| `src/components/dashboard/HotelFloorMap.tsx` | Major rewrite: canvas-based layout, drag/rotate support, load/save layout, counter-rotation for text |
| `src/components/dashboard/HotelRoomOverview.tsx` | Pass `hotelName` and `isManagerOrAdmin` to HotelFloorMap |

### Technical Details

**Drag implementation:** Use native pointer events (`onPointerDown`, `onPointerMove`, `onPointerUp`) on wing containers. Track delta from initial click position and update x/y state. No external drag library needed.

**Rotation implementation:** A small circular handle at the corner of each wing. On pointer-down+move, calculate the angle from the wing center to the pointer position using `Math.atan2`. Update rotation state in real-time.

**Counter-rotation CSS pattern:**
```typescript
// Wing container
<div style={{ transform: `rotate(${rotation}deg)`, position: 'absolute', left: `${x}%`, top: `${y}px` }}>
  {/* Wing label - counter-rotated */}
  <div style={{ transform: `rotate(${-rotation}deg)` }}>
    <span>Wing D (Synagogue View)</span>
  </div>
  {/* Room chips - each counter-rotated */}
  <div style={{ transform: `rotate(${-rotation}deg)` }}>
    {rooms.map(room => renderRoom(room))}
  </div>
</div>
```

**Save/Load flow:**
1. On mount, fetch `hotel_floor_layouts` for the current hotel
2. Build a map: `{ "0-A": { x, y, rotation }, "1-D": { x, y, rotation }, ... }`
3. If no saved layout exists for a wing, use default position
4. On "Save Layout" click, upsert all wing positions to the database
5. Layout is shared across all users viewing that hotel

**Canvas sizing:** Each floor section is a relative-positioned container with a fixed minimum height (e.g., 200px). Wing containers are absolutely positioned within it using percentage-based x and pixel-based y coordinates.

**Non-admin users:** See the saved layout but cannot drag or rotate. The edit controls are hidden.

