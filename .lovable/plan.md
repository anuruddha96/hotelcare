

## Plan: Enhanced Map Layout Builder with Smart Proximity

### Problems to Fix

1. **Rotation conflicts with drag**: Both drag and rotate share pointer events on the same element tree, causing the rotation handle to not work reliably. The `onPointerMove` on the parent wing container intercepts events meant for the rotation handle.
2. **Counter-rotation hides the visual rotation**: Currently, the wing border rotates but inner content counter-rotates, making it look like nothing moved. The wing shape/border should rotate visually to represent the physical corridor orientation, while only the text/numbers counter-rotate.
3. **No precision controls**: Only a drag-to-rotate handle exists. Need explicit rotation buttons (+/- 15 degrees) for precise control.
4. **Canvas too cramped**: Wings overlap and can't be spread out properly.
5. **Proximity not saved to memory**: After layout save, wing distances should be computed and stored for the assignment algorithm.

### Solution

#### 1. Separate drag and rotate into independent interaction modes

Instead of both happening simultaneously on the same element, add an explicit **toolbar per wing** in edit mode with:
- A **drag handle** (Move icon) -- only this initiates dragging
- **Rotate left/right buttons** (-15 degrees / +15 degrees) for precise rotation
- Keep the corner rotation handle but isolate its events completely from the parent drag

#### 2. Fix the visual rotation pattern

Change the CSS so:
- The **outer wrapper** (border, background, shadow) rotates with the wing -- this shows the corridor orientation
- Only the **inner text elements** (wing label, room number chips, badges) counter-rotate to stay readable
- This means the rectangular wing card itself will appear rotated on screen

```
Outer div: rotate(45deg) -- the card border/background rotates
  Inner content wrapper: rotate(-45deg) -- text stays upright
```

#### 3. Add precision rotation controls

In edit mode, each wing gets small +/- rotation buttons:
- -15 degrees (rotate left)
- +15 degrees (rotate right)  
- Reset to 0 degrees
- Current angle display

#### 4. Larger canvas with grid background

- Increase canvas min-height to 400px in edit mode
- Add a subtle grid/dot pattern background to help with alignment
- Allow scroll overflow so wings can be placed anywhere

#### 5. Compute and save wing proximity on layout save

After saving positions, compute pairwise Euclidean distances between all wings across all floors and store them as a `wing_adjacency` JSON column on the `hotel_floor_layouts` table (one row per hotel, or as a separate lightweight table). This data feeds into the assignment algorithm.

Since we already have `buildWingProximityMap` in the algorithm file and `AutoRoomAssignment.tsx` fetches it, we just need to ensure the data is actually persisted and loaded properly.

### Files to Modify

| File | Changes |
|------|---------|
| `src/components/dashboard/HotelFloorMap.tsx` | Major rewrite: separate drag/rotate handlers, fix CSS rotation pattern, add precision rotation buttons, larger canvas with grid, compute proximity on save |
| `src/lib/roomAssignmentAlgorithm.ts` | No changes needed (already has `buildWingProximityMap` and proximity-aware assignment) |

### Technical Details

**Isolated drag vs rotate events:**
- The wing container div only handles drag (onPointerDown for drag)
- The rotation handle div uses `e.stopPropagation()` AND captures pointer to itself
- Additionally, add clickable rotate buttons that simply increment/decrement rotation by 15 degrees (no pointer tracking needed)

**Fixed CSS rotation pattern:**
```typescript
// Outer: rotates the wing card shape
<div style={{ 
  position: 'absolute',
  left: `${x}%`, top: `${y}%`,
  transform: `rotate(${rotation}deg)`,
  transformOrigin: 'center center'
}}>
  {/* The border/background card -- this visually rotates */}
  <div className="border rounded-lg p-2 bg-background shadow">
    {/* Inner content counter-rotates so text is upright */}
    <div style={{ transform: `rotate(${-rotation}deg)` }}>
      <span>Wing D</span>
      <div className="flex flex-wrap gap-1">
        {rooms.map(room => <RoomChip />)}
      </div>
    </div>
  </div>
  
  {/* Edit controls -- outside the rotated content */}
  {editMode && (
    <div className="absolute -bottom-8 left-0 flex gap-1">
      <button onClick={() => rotate(-15)}>-15</button>
      <span>45 degrees</span>
      <button onClick={() => rotate(+15)}>+15</button>
    </div>
  )}
</div>
```

**Precision rotation buttons:**
Each wing in edit mode shows a small control bar below it with:
- RotateCcw button: decrements rotation by 15 degrees
- Current angle badge (e.g., "45 degrees")
- RotateCw button: increments rotation by 15 degrees  
- A "0 degrees" reset button

**Grid background in edit mode:**
```css
background-image: radial-gradient(circle, #ddd 1px, transparent 1px);
background-size: 20px 20px;
```

**Wing proximity computation on save:**
After upserting layout positions, compute distances using the existing `buildWingProximityMap` function and log the result. The `AutoRoomAssignment` component already fetches layouts and builds the proximity map at runtime, so no additional persistence is strictly needed -- but the layout positions being saved IS the persistence mechanism.

