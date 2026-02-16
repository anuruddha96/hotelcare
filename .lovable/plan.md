

## Plan: Fix Towel Change / Room Cleaning Cycle and Smarter Assignment Weighting

### The Problem

The cleaning cycle logic is inverted. Currently, day 3 of a guest's stay triggers **Room Cleaning (linen change)**, but in practice day 3 should only require a **Towel Change**. The yellow-highlighted rooms in the Excel (3/3, 3/4, 3/5) are all on their 3rd night and should be towel-change-only.

Additionally, the assignment algorithm treats towel-change-only rooms the same as full daily cleaning rooms (15 minutes, same weight), which leads to unfair workload distribution. A towel change takes roughly 5 minutes, not 15.

### Root Cause

In `PMSUpload.tsx` (lines 546-556), the cleaning cycle maps:
- `cyclePosition === 0` (days 3, 9, 15...) to Room Cleaning (linen) -- **should be Towel Change**
- `cyclePosition === 2 or 4` (days 5, 7, 11, 13...) to Towel Change -- **some of these should be Room Cleaning**

### Corrected Cleaning Cycle

Based on standard hotel practice and the user's feedback:

| Day | Type | Rationale |
|-----|------|-----------|
| 3 | Towel Change (T) | First service - light touch |
| 5 | Towel Change (T) | Second towel refresh |
| 7 | Room Cleaning (RC) | Full clean after a week |
| 9 | Towel Change (T) | Light service |
| 11 | Towel Change (T) | Light service |
| 13 | Room Cleaning (RC) | Full clean after two weeks |

Pattern: every 6-day cycle starting from day 3 = **T, T, RC, T, T, RC...**

### Changes

**File 1: `src/components/dashboard/PMSUpload.tsx`**

Fix the cleaning cycle logic (lines 546-556):
- Day 3 (cyclePosition 0): Towel Change (was: Room Cleaning)
- Day 5 (cyclePosition 2): Towel Change (stays same)
- Day 7 (cyclePosition 4): Room Cleaning (was: Towel Change)

```
cyclePosition 0 -> towelChangeRequired = true   (day 3, 9, 15)
cyclePosition 2 -> towelChangeRequired = true   (day 5, 11, 17)
cyclePosition 4 -> linenChangeRequired = true   (day 7, 13, 19)
```

**File 2: `src/lib/roomAssignmentAlgorithm.ts`**

Add towel-change-aware time and weight calculations:
- New constant: `TOWEL_CHANGE_MINUTES = 5`
- `calculateRoomTime`: if room has `towel_change_required` and is NOT checkout, use 5 min base instead of 15
- `calculateRoomWeight`: towel-change-only rooms get weight 0.4 instead of 1.0

This means the algorithm will:
- Assign MORE towel-change rooms per housekeeper (they're quick)
- Balance workloads more fairly by accounting for actual effort
- Show accurate time estimates in the preview

### Technical Details

**Cleaning cycle fix:**
```typescript
if (guestNightsStayed >= 3) {
  const cyclePosition = (guestNightsStayed - 3) % 6;
  if (cyclePosition === 0 || cyclePosition === 2) {
    // Towel Change days: 3, 5, 9, 11, 15, 17...
    towelChangeRequired = true;
    linenChangeRequired = false;
  } else if (cyclePosition === 4) {
    // Room Cleaning days: 7, 13, 19...
    linenChangeRequired = true;
    towelChangeRequired = false;
  }
}
```

**Algorithm time calculation:**
```typescript
export const TOWEL_CHANGE_MINUTES = 5;

export function calculateRoomTime(room: RoomForAssignment): number {
  // Towel-change-only rooms are much faster
  if (room.towel_change_required && !room.is_checkout_room && !room.linen_change_required) {
    return TOWEL_CHANGE_MINUTES;
  }
  let baseTime = room.is_checkout_room ? CHECKOUT_MINUTES : DAILY_MINUTES;
  // ... existing size adjustments
}
```

**Algorithm weight calculation:**
```typescript
export function calculateRoomWeight(room: RoomForAssignment): number {
  // Towel-change-only rooms are lightweight
  if (room.towel_change_required && !room.is_checkout_room && !room.linen_change_required) {
    return 0.4;
  }
  // ... existing weight logic
}
```

### Files to Modify

| File | Changes |
|------|---------|
| `src/components/dashboard/PMSUpload.tsx` | Fix cleaning cycle: day 3 = Towel Change, day 7 = Room Cleaning |
| `src/lib/roomAssignmentAlgorithm.ts` | Add TOWEL_CHANGE_MINUTES (5 min), adjust calculateRoomTime and calculateRoomWeight for towel-change-only rooms |

