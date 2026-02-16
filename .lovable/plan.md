

## Plan: Towel/Cleaning Cycle Logic + T/RC Indicators in Auto Assignment Preview

### Background

Hotel Memories Budapest uses a specific cleaning schedule for longer-stay guests:
- **Day 3**: Room Cleaning (RC)
- **Day 5**: Towel Change (T)
- **Day 7**: Towel Change (T)
- **Day 9**: Room Cleaning (RC)
- **Day 11**: Towel Change (T)
- Pattern: if `night/total` where night equals total (e.g., 5/5, 9/9), it's a Towel Change day
- If `night/total` where night is one less than total for certain days (e.g., 9/10), Room Cleaning is required
- More precisely: nights 3, 9 = RC; nights 5, 7, 11 = T (and the pattern repeats)

### Changes

#### 1. Update PMS Upload towel/cleaning logic (`src/components/dashboard/PMSUpload.tsx`)

**Current logic (lines 517-521):**
```
towelChangeRequired = guestNightsStayed >= 2 && guestNightsStayed % 2 === 0;
linenChangeRequired = guestNightsStayed >= 5 && guestNightsStayed % 5 === 0;
```

**New logic:** Replace with Hotel Memories Budapest cycle:
- Towel Change days: 5, 7, 11, 13, 17, 19... (every even position in the 2-day cycle after day 3)
- Room Cleaning days: 3, 9, 15, 21... (every 6th day starting from 3)
- Simplified: use a lookup based on `guestNightsStayed`:
  - RC (Room Cleaning): days where `(night - 3) % 6 === 0` (i.e., 3, 9, 15, 21...)
  - T (Towel Change): days where `(night - 5) % 6 === 0` or `(night - 7) % 6 === 0` (i.e., 5, 7, 11, 13, 17, 19...)

Store result in existing `towel_change_required` and `linen_change_required` fields (repurposing `linen_change_required` as "room_cleaning_required").

Also add a new field `cleaning_type` to the room notes so it's visible: "T" or "RC".

#### 2. Add T/RC indicators in Auto Room Assignment preview (`src/components/dashboard/AutoRoomAssignment.tsx`)

- Extend the `RoomForAssignment` interface to include `towel_change_required` and `linen_change_required` (room cleaning)
- In the room fetch query (line 143), add these fields
- In the preview room badges (around line 648-654), show:
  - A red **T** badge if `towel_change_required` is true
  - A red **RC** badge if `linen_change_required` is true  
  - On hover (title attribute), show full text: "Towel Change" or "Room Cleaning"

#### 3. Update the algorithm interface (`src/lib/roomAssignmentAlgorithm.ts`)

- Add `towel_change_required` and `linen_change_required` to `RoomForAssignment` interface (optional booleans)
- No changes to the algorithm logic itself (these are display-only fields for now)

### Files to modify

| File | Changes |
|------|---------|
| `src/components/dashboard/PMSUpload.tsx` | Replace towel/linen logic with 3-5-7-9-11 day cycle |
| `src/lib/roomAssignmentAlgorithm.ts` | Add `towel_change_required?` and `linen_change_required?` to `RoomForAssignment` |
| `src/components/dashboard/AutoRoomAssignment.tsx` | Fetch towel/linen fields, show T/RC badges on room chips in preview |

### Technical Details

**Cleaning cycle calculation:**
```typescript
// Hotel Memories Budapest cleaning cycle
// Pattern repeats every 6 days starting from day 3:
// Day 3: RC, Day 5: T, Day 7: T, Day 9: RC, Day 11: T, Day 13: T, ...
function getCleaningType(nightsStayed: number): 'towel_change' | 'room_cleaning' | null {
  if (nightsStayed < 3) return null;
  const cyclePosition = (nightsStayed - 3) % 6;
  if (cyclePosition === 0) return 'room_cleaning'; // days 3, 9, 15, 21...
  if (cyclePosition === 2 || cyclePosition === 4) return 'towel_change'; // days 5, 7, 11, 13...
  return null;
}
```

**Preview badge rendering (in room chip):**
```typescript
{room.towel_change_required && (
  <span className="text-[9px] px-1 rounded font-bold bg-red-200 text-red-800" 
        title="Towel Change">T</span>
)}
{room.linen_change_required && (
  <span className="text-[9px] px-1 rounded font-bold bg-red-200 text-red-800" 
        title="Room Cleaning">RC</span>
)}
```
