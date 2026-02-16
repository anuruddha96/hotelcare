

## Plan: Fix Wing Rotation and Use Map Layout for Smart Assignments

### Problem 1: Rotation Not Working

The rotation handle exists but doesn't function. The bug is in `setPointerCapture`: it's called on `e.target` (which resolves to the inner SVG icon element), but the `onPointerMove`/`onPointerUp` handlers are on the parent div. Events get captured by the icon but never reach the div's handlers.

**Fix:** Change `e.target` to `e.currentTarget` in both the drag and rotation pointer capture calls. This ensures the correct element receives subsequent pointer events.

### Problem 2: Map Layout Should Inform Assignment Algorithm

When admins arrange wings on the map to match the physical hotel, the saved x/y positions encode real spatial relationships. The assignment algorithm should use this data to understand which wings are physically close and assign rooms more intelligently.

### Changes

#### File: `src/components/dashboard/HotelFloorMap.tsx`

**Bug fix -- pointer capture on correct element:**
- Line 162: Change `(e.target as HTMLElement)` to `(e.currentTarget as HTMLElement)` in `handleDragStart`
- Line 198: Change `(e.target as HTMLElement)` to `(e.currentTarget as HTMLElement)` in `handleRotateStart`

**Better canvas height for rotation space:**
- Increase minimum canvas height in edit mode from 220px to 300px so rotated wings don't overlap floor boundaries

**On save, compute and store wing adjacency data:**
- After saving layout positions, compute pairwise distances between wings on the same floor using their x/y coordinates
- Store this as a JSON record in `hotel_floor_layouts` or a new `wing_adjacency` column so the algorithm can query it

#### File: `src/lib/roomAssignmentAlgorithm.ts`

**Use saved layout proximity when available:**
- Add an optional `wingProximityMap` parameter to `autoAssignRooms`
- When assigning wings, check the map-based distances between wings instead of only using `elevator_proximity`
- Prefer assigning physically adjacent wings (close x/y on the map) to the same housekeeper

#### File: `src/components/dashboard/HotelRoomOverview.tsx`

- When calling the assignment algorithm, fetch saved wing layout positions and pass them as the proximity map

### Technical Details

**Pointer capture fix (the core rotation bug):**
```typescript
// BEFORE (broken - icon captures events, div never gets them)
(e.target as HTMLElement).setPointerCapture(e.pointerId);

// AFTER (fixed - the div with handlers captures events)
(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
```

**Wing distance calculation from map positions:**
When the admin saves a layout, compute distances between all wing pairs on the same floor:
```typescript
// After saving, compute wing-to-wing distances
const wingPositions = Object.entries(layouts);
const adjacency: Record<string, Record<string, number>> = {};
for (const [keyA, layoutA] of wingPositions) {
  for (const [keyB, layoutB] of wingPositions) {
    if (keyA === keyB) continue;
    const dist = Math.sqrt((layoutA.x - layoutB.x) ** 2 + (layoutA.y - layoutB.y) ** 2);
    adjacency[keyA] = adjacency[keyA] || {};
    adjacency[keyA][keyB] = Math.round(dist);
  }
}
```

**Algorithm enhancement:**
When choosing which housekeeper gets a wing, factor in map-based distance to wings they already have:
```typescript
// Current: uses elevator_proximity average
// Enhanced: also considers map distance to already-assigned wings
const aMapDist = getMapDistanceToAssignedWings(a[0], wingEntry.wing, wingProximityMap);
const bMapDist = getMapDistanceToAssignedWings(b[0], wingEntry.wing, wingProximityMap);
```

### Files to modify

| File | Changes |
|------|---------|
| `src/components/dashboard/HotelFloorMap.tsx` | Fix pointer capture bug (e.target to e.currentTarget), increase canvas height, compute wing adjacency on save |
| `src/lib/roomAssignmentAlgorithm.ts` | Accept optional wing proximity map, use map distances for smarter assignment |
| `src/components/dashboard/HotelRoomOverview.tsx` | Pass layout-based proximity data to algorithm when available |

