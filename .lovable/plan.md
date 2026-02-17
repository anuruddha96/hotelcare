

## Plan: Sort Rooms Numerically in Preview + Fix Blank Hotel Selection Page

### Issue 1: Room Sort Order in Auto-Assignment Preview

**Current behavior**: Rooms in the preview are sorted by checkout first, then floor, then room number. Within each housekeeper's card, rooms from different wings appear interleaved (e.g., 203, 207, 209, 213, 201, 205, 211, 215, 217, 302, 304, 306, 308) because wing assignment scatters rooms across floors.

**Fix**: Sort rooms purely by numerical room number (lowest to highest) within each housekeeper's card. This applies in three places:

1. **`roomAssignmentAlgorithm.ts` - STEP 6** (line 359): Change the final sort from "checkout-first, then floor, then number" to simply numerical ascending by room number.

2. **`roomAssignmentAlgorithm.ts` - `moveRoom` function** (line 411): Same sort change when a room is moved between housekeepers.

3. **Algorithm proximity logic**: The wing-based grouping already tries to keep nearby rooms together. No changes needed to the core assignment logic -- the existing wing-first approach already clusters rooms spatially. The sort is purely for display.

**Sort logic change**:
```
// Before (confusing order)
sort by: checkout first -> floor -> room number

// After (clean numerical order)
sort by: room number (parseInt, ascending)
```

### Issue 2: Blank Hotel Selection Page

**Root cause**: The `HotelSelectionScreen` component depends on `useTenant()` which fetches hotels asynchronously. When `tenantLoading` becomes `false` but `hotels` is still an empty array (due to RLS timing or race condition), the screen renders with no hotel cards and no error message -- just a blank page with a title.

**Fix in `HotelSelectionScreen.tsx`**:
- Add a fallback when `hotels` is empty and loading is complete: show a retry button and a message ("No hotels found. Tap to retry.")
- Add error boundary around the hotel fetch to prevent unhandled promise rejections from blanking the page.

### Issue 3: Hotel-specific safeguard

The plan only modifies sorting logic (which is universal/harmless) and the hotel selection screen. No hotel-specific extraction or category logic is touched, so Ottofiori and Budapest remain independent.

### Files to Modify

| File | Changes |
|------|---------|
| `src/lib/roomAssignmentAlgorithm.ts` | Change room sort in STEP 6 and `moveRoom` to pure numerical ascending |
| `src/components/dashboard/HotelSelectionScreen.tsx` | Add empty-state fallback with retry button when hotels array is empty |

### Technical Details

**roomAssignmentAlgorithm.ts - STEP 6 sort (line 359-365)**:
```typescript
const sortedRooms = staffRooms.sort((a, b) => {
  return parseInt(a.room_number) - parseInt(b.room_number);
});
```

**roomAssignmentAlgorithm.ts - moveRoom sort (line 411-417)**:
```typescript
toPreview.rooms.sort((a, b) => {
  return parseInt(a.room_number) - parseInt(b.room_number);
});
```

**HotelSelectionScreen.tsx - empty state fallback**:
```typescript
{hotels.length === 0 && !tenantLoading && (
  <div className="text-center space-y-4">
    <p className="text-muted-foreground">No hotels found</p>
    <Button variant="outline" onClick={() => window.location.reload()}>
      Retry
    </Button>
  </div>
)}
```

Also add a `useEffect` with a 3-second timeout: if `tenantLoading` is still true after 3 seconds, force-refresh tenant data. This catches the race condition where the auth session resolves after the initial fetch.

