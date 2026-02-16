

## Plan: Room Parameters, Categories, Wing-Based Assignment, and Floor Map

This is the largest remaining item from your original request. It adds room metadata (wing/unit, category, elevator proximity), a visual floor map, room category selection, and smarter auto-assignment that groups rooms by physical proximity rather than just floor number.

### Overview

Hotel Memories Budapest has rooms spread across multiple wings on each floor. The current algorithm only groups by floor, but rooms on the same floor can be far apart. This plan introduces a **wing** concept so rooms that are physically close are assigned together, and considers elevator proximity for efficiency.

### Room Wing Layout (from your description)

Based on the attached map and your description:

```text
GROUND FLOOR (F0):
  Wing A: 002-010 (near elevator)
  Wing B: 032-036 (near elevator)  
  Wing C: 038-044

1ST FLOOR (F1):
  Wing D (Synagogue view): 101,103,105,107,109,115,117,119,121,123,125,127
  Wing E (Courtyard inner): 102,104,106,108,110,111,112,113,114
  Wing F (Courtyard): 130,132,134,136
  Wing G (Courtyard): 138,140,142,144
  Wing H (Street view): 131,133,135,137,139,141,143,145,147

2ND FLOOR (F2):
  Wing I: 202,204,206,208,210
  Wing J (Synagogue): 201,203,205,207,209,211,213,215,217
  Wing K (Courtyard): 212,214,216

3RD FLOOR (F3):
  Wing L: 302,304,306,308
```

### Changes

#### 1. Database: Add new columns to `rooms` table

Add 3 new columns via SQL migration:
- `wing` (text, nullable) -- e.g., "A", "B", "C"
- `room_category` (text, nullable) -- e.g., "Deluxe Double or Twin Room with Synagogue View"
- `elevator_proximity` (integer, nullable) -- 1=near, 2=medium, 3=far

Then seed the wing and elevator proximity data for all Hotel Memories Budapest rooms based on the layout described above.

#### 2. Room Category Selector in Hotel Room Overview (`HotelRoomOverview.tsx`)

- Expand the room click dialog to include a **Room Category** dropdown alongside the existing room size selector
- Categories: Deluxe Double or Twin Room with Synagogue View, Deluxe Double or Twin Room, Deluxe Queen Room, Deluxe Triple Room, Deluxe Quadruple Room, Comfort Quadruple Room, Comfort Double Room with Small Window, Deluxe Single Room
- Saving updates `rooms.room_category`
- Show the category abbreviation on the room chip tooltip

#### 3. Visual Floor Map (`HotelFloorMap.tsx` -- new component)

A simple, clean visual representation of the hotel layout shown in Hotel Room Overview:
- Each floor is a horizontal section
- Rooms are arranged in their wing groups with visual separators
- Elevator icon shown between Wing A and Wing B on ground floor
- Color-coded by room status (same palette as existing room chips)
- Clicking a room opens the same size/category editor dialog
- Wings labeled with their view type (Synagogue, Courtyard, Street)

#### 4. Update Auto-Assignment Algorithm (`roomAssignmentAlgorithm.ts`)

Current behavior: groups rooms by **floor** only.

New behavior: groups rooms by **wing** (floor + wing combo), which keeps physically adjacent rooms together.

- Add `wing` and `elevator_proximity` to the `RoomForAssignment` interface
- Replace `groupRoomsByFloor` with `groupRoomsByWing` in the daily room distribution step
- When assigning a wing's rooms to a housekeeper, prefer wings that are near the same elevator (low proximity score) to reduce walking time
- Wing-based grouping means a housekeeper gets rooms like "all of Wing D on Floor 1" instead of "random rooms from Floor 1"

#### 5. Fetch wing data in AutoRoomAssignment (`AutoRoomAssignment.tsx`)

- Add `wing`, `room_category`, `elevator_proximity` to the room fetch query
- Pass wing data through to the algorithm
- Show wing label in preview room chips (small badge)

### Files to create/modify

| File | Action | Changes |
|------|--------|---------|
| SQL migration | Create | Add `wing`, `room_category`, `elevator_proximity` columns; seed Hotel Memories Budapest data |
| `src/lib/roomAssignmentAlgorithm.ts` | Modify | Add wing/proximity to interface; replace floor grouping with wing grouping; proximity-aware assignment |
| `src/components/dashboard/HotelRoomOverview.tsx` | Modify | Add room category selector in dialog; show wing info; add floor map toggle |
| `src/components/dashboard/HotelFloorMap.tsx` | Create | Visual floor map component with wing layout for Hotel Memories Budapest |
| `src/components/dashboard/AutoRoomAssignment.tsx` | Modify | Fetch wing/category/proximity fields; show wing badges in preview |

### Technical Details

**Wing-based grouping in algorithm:**
```typescript
// Instead of groupRoomsByFloor, use groupRoomsByWing
function groupRoomsByWing(rooms: RoomForAssignment[]): Map<string, RoomForAssignment[]> {
  const wingMap = new Map<string, RoomForAssignment[]>();
  rooms.forEach(room => {
    const key = room.wing || `floor-${room.floor_number ?? 0}`;
    if (!wingMap.has(key)) wingMap.set(key, []);
    wingMap.get(key)!.push(room);
  });
  return wingMap;
}
```

**Proximity-aware assignment:**
When choosing which housekeeper gets a wing, prefer assigning wings with similar elevator proximity scores to the same housekeeper. This keeps their work area compact. For example, Wing A (elevator_proximity=1) and Wing B (elevator_proximity=1) would ideally go to the same person.

**Wing data seeding SQL (example):**
```sql
-- Ground floor wings
UPDATE rooms SET wing = 'A', elevator_proximity = 1 
WHERE hotel = 'Hotel Memories Budapest' AND room_number IN ('002','004','006','008','010');
UPDATE rooms SET wing = 'B', elevator_proximity = 1 
WHERE hotel = 'Hotel Memories Budapest' AND room_number IN ('032','034','036');
-- ... etc for all wings
```

**Room categories list:**
```typescript
const ROOM_CATEGORIES = [
  'Deluxe Double or Twin Room with Synagogue View',
  'Deluxe Double or Twin Room',
  'Deluxe Queen Room',
  'Deluxe Triple Room',
  'Deluxe Quadruple Room',
  'Comfort Quadruple Room',
  'Comfort Double Room with Small Window',
  'Deluxe Single Room',
];
```

**Floor map layout:** A simple CSS grid per floor showing room numbers arranged by wing, with elevator markers and wing labels. Not a pixel-perfect architectural drawing, but a functional interactive map that makes the spatial layout clear.

