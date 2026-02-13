

## Plan: Fix PMS Upload Room Matching + No-Show Handling

### Problem 1: Rooms 038 and 114 "Not Found" Despite Existing

**Root Cause:** In `PMSUpload.tsx`, the hotel configuration lookup (`hotel_configurations` query with `.single()`) runs **inside the for-loop** for every single room (line 324-328). For 69 rooms, this means 69 redundant queries to look up the same hotel name. This can cause intermittent failures due to connection pooling or rate limiting, especially for rooms processed near the end of the file (which is exactly where QDR-038 and QDR-114 are -- the last 2 rows).

**Fix:** Move the hotel name resolution **outside** the processing loop. Look up the hotel name once before the loop starts, then reuse it for every room query.

**File:** `src/components/dashboard/PMSUpload.tsx`

- Before the `for` loop (around line 299), add a one-time hotel name lookup
- Remove the per-room hotel config query from inside the loop (lines 322-332)
- Use the pre-resolved hotel name for all room queries

### Problem 2: No-Show Handling

**Current logic (line 409):**
```
if (row.Occupied === 'No' && row.Status === 'Untidy' && row.Arrival)
```

This only catches no-shows when there is NO departure time. But in the uploaded file, the 3 rooms with `Occupied = No` all have departure times (06:26, 07:32, 06:41), so they fall into the checkout branch instead.

**Improved detection:** A no-show or very-early-checkout should be identified when:
- `Occupied = 'No'` AND has a departure time AND the departure is before 08:00 (guests who "left" before housekeeping hours likely never truly stayed)
- OR `Occupied = 'No'` AND `Night/Total = '1/1'` with early departure

These rooms still need cleaning (dirty status), but should be tagged with a "No Show" or "Early Checkout" note for manager visibility.

**File:** `src/components/dashboard/PMSUpload.tsx`

- After the checkout branch (line 379-394), add a sub-check: if `Occupied === 'No'` and departure is before 08:00, mark the room note as "No Show / Early Checkout"
- Keep the room status as dirty (it still needs cleaning)
- This is purely informational -- the cleaning workflow remains the same

### Problem 3: Room Management Showing 0 Rooms (Screenshot 2)

The Room Management page uses `.or()` with embedded double quotes which could cause PostgREST parsing issues with hotel names containing spaces. This is the same hotel that has 69 rooms in the PMS file, so the rooms exist.

**File:** `src/components/dashboard/RoomManagement.tsx`

- The `.or()` filter at line 131 and 162 uses template literals with embedded double quotes. For hotel names with spaces like "Hotel Memories Budapest", this should work but can be fragile.
- Simplify: since `assigned_hotel` is always "Hotel Memories Budapest" (verified from profiles table), and rooms.hotel is also "Hotel Memories Budapest", just use `.eq('hotel', profile.assigned_hotel)` directly instead of the complex `.or()` lookup.
- Keep the hotel_configurations lookup as a fallback only when the direct match returns 0 results.

### Summary of Changes

| File | Change |
|------|--------|
| `PMSUpload.tsx` | Move hotel name lookup outside the loop; improve no-show detection for early-departure rooms |
| `RoomManagement.tsx` | Simplify hotel filter to use direct `.eq()` first, then fallback to config lookup |

### Technical Details

**PMSUpload.tsx -- Hotel lookup optimization (before line 301):**
```text
// ONE-TIME hotel name resolution before the loop
let hotelNameForFilter = selectedHotel;
if (selectedHotel) {
  const { data: hotelConfig } = await supabase
    .from('hotel_configurations')
    .select('hotel_name')
    .eq('hotel_id', selectedHotel)
    .maybeSingle();
  hotelNameForFilter = hotelConfig?.hotel_name || selectedHotel;
}

// Then inside the loop, replace lines 322-332 with:
if (hotelNameForFilter) {
  roomQuery = roomQuery.eq('hotel', hotelNameForFilter);
}
```

**PMSUpload.tsx -- Improved no-show detection (around line 379-413):**
```text
// Inside the checkout branch, after setting isCheckout = true:
if (row.Occupied === 'No') {
  // Parse departure time to check for no-show
  const depTime = row.Departure?.trim();
  const depHour = depTime ? parseInt(depTime.split(':')[0], 10) : 99;
  if (depHour < 8) {
    isNoShow = true;
    // Still mark as dirty/checkout -- but add note
  }
}
```

**RoomManagement.tsx -- Simplified filter (lines 126-144):**
```text
if (profile.assigned_hotel) {
  // Try direct match first (works when rooms.hotel stores the same value as assigned_hotel)
  query = query.eq('hotel', profile.assigned_hotel);
}
```
If direct match returns 0 results, THEN do the hotel_configurations lookup as fallback. This eliminates the fragile `.or()` with embedded quotes.

