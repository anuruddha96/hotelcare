

## Plan: Smart Room Zones, Time Estimates, Visual Fixes for Hotel Memories Budapest

### Issue 1: Room-to-Zone Mapping for Hotel Memories Budapest

**Root Cause**: The algorithm currently maps wings (A-J) to zones, but the actual physical layout groups rooms by room number ranges, not wing letters. The wing field in the DB doesn't reflect the real proximity (e.g., rooms 302-308 are physically next to 202-210).

**Fix**: Add a **room-number-based zone mapping** function specifically for Hotel Memories Budapest. Instead of relying on `wing` field from DB, override each room's wing based on its room number before running the algorithm.

Zone definitions (from user):
- **Zone "Ground"**: 002, 004, 006, 008, 010, 032, 034, 036, 038, 040, 042, 044
- **Zone "F1-Left"**: 101-129 (101, 102, 103 near elevator)
- **Zone "F1-Right"**: 130-149 (130, 131, 132 near elevator)
- **Zone "F2-F3"**: 201-217 + 302, 304, 306, 308 (physically adjacent)

This means rooms 302-308 will be treated as the SAME zone as 201-217, allowing them to be assigned together. The `floorFitScore` must also be updated to treat these rooms as "same zone" rather than penalizing floor difference.

**Files**: `src/lib/roomAssignmentAlgorithm.ts`, `src/components/dashboard/AutoRoomAssignment.tsx`

---

### Issue 2: Room Time Estimates by Room Type

**Current**: Time is based on `room_size_sqm` only. User wants it based on room type (capacity).

**Fix**: Update `calculateRoomTime` to use `room_capacity` when `room_size_sqm` is not set:
- **Checkout**: Queen (capacity 2, small) = 45 min; Double/Twin (capacity 2) = 45 min; Triple (capacity 3) = 55 min; Quad (capacity 4+) = 60 min
- **Daily**: 15 min for all
- **Towel change**: 10 min
- **Clean Room (C)**: 15 min (not daily 15 + linen 10; just 15 total)

**File**: `src/lib/roomAssignmentAlgorithm.ts`

---

### Issue 3: Distinct Colors for T and C Indicators

**Current**: Both T and C show in `text-red-600`.

**Fix**: 
- **T (Towel)**: Blue (`text-blue-600`)
- **C (Clean Room)**: Orange (`text-orange-600`)

Update in `renderRoomChip` and `renderSummaryTable` in `AutoRoomAssignment.tsx`, and in `HotelRoomOverview.tsx` room chips.

**File**: `src/components/dashboard/AutoRoomAssignment.tsx`, `src/components/dashboard/HotelRoomOverview.tsx`

---

### Issue 4: Regenerate Button Not Working

**Root Cause**: `handleGeneratePreview` is `async` and calls `getManagerHotel()` + DB queries. When called from the preview step, it works correctly in code, but likely the issue is that the algorithm is **deterministic** — regenerating with the same inputs produces the same output. 

**Fix**: Add a randomization seed to the algorithm. When regenerating, introduce slight random perturbation to candidate scoring so different but still fair assignments are produced. Also add a loading indicator during regeneration.

**File**: `src/lib/roomAssignmentAlgorithm.ts`, `src/components/dashboard/AutoRoomAssignment.tsx`

---

### Issue 5: Pre-process Hotel Memories Budapest Map Visually

**Fix**: In `HotelFloorMap.tsx`, add a hardcoded layout preset for Hotel Memories Budapest that groups rooms into the 4 zones with visual labels, showing the physical proximity of F2-F3 rooms and elevator positions. This renders automatically when the hotel is detected.

**File**: `src/components/dashboard/HotelFloorMap.tsx`

---

### Summary

| File | Changes |
|------|---------|
| `src/lib/roomAssignmentAlgorithm.ts` | Room-number-based zone mapping for Memories; updated time estimates; randomization seed for regenerate; zone-aware floor scoring |
| `src/components/dashboard/AutoRoomAssignment.tsx` | Apply room-number zones before calling algorithm; distinct T/C colors; loading state on regenerate; pass randomize flag |
| `src/components/dashboard/HotelRoomOverview.tsx` | Distinct T/C colors on room chips |
| `src/components/dashboard/HotelFloorMap.tsx` | Pre-built visual layout for Hotel Memories Budapest zones |

