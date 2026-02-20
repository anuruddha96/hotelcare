

## Fix: Room Selection Not Working in Perishable Placement Dialog

### Root Cause

The room list is empty because the database query uses incorrect filter syntax. Two issues:

1. **Wrong filter method**: `.or(`hotel.eq.${hotel}`)` is not valid Supabase syntax -- it should be `.eq('hotel', hotel)`
2. **Hotel name mismatch**: The `hotel` prop comes from `profile.assigned_hotel` which may be a short ID like `"ottofiori"`, but the `rooms` table stores the full name `"Hotel Ottofiori"`. The query needs to handle both formats.

The same bug affects `fetchPlacements` as well.

### Changes

**File: `src/components/dashboard/PerishablePlacementManager.tsx`**

1. **Fix `fetchRooms` query** (line 86-91): Replace `.or(`hotel.eq.${hotel}`)` with a proper filter that matches both the hotel ID and full hotel name using the existing `get_hotel_name_from_id` pattern:
   ```
   .or(`hotel.eq.${hotel},hotel.eq.${hotelFullName}`)
   ```
   Or simpler: resolve the hotel name first and use `.eq('hotel', resolvedName)`.

2. **Fix `fetchPlacements` query** (line 101): Same fix -- replace the broken `.or()` with a proper hotel filter.

3. **Fix `handleBulkPlace`** (line 149): The `hotel` field in the insert record should use the resolved hotel name that matches what's in the rooms table, so placements can be queried back correctly.

4. **Add "Select All" / "Deselect All" buttons** to the room selection grid for convenience when placing items in many rooms.

5. **Sort rooms numerically** so room numbers appear in logical order (102, 104, 204, 205, etc.).

### Technical Detail

- Add a helper that resolves `hotel` to the full hotel name by querying `hotel_configurations` or using the `get_hotel_name_from_id` DB function
- Use `ilike` or `.or()` with proper syntax to match both possible hotel values
- Ensure consistency: always store the same hotel value that rooms use

