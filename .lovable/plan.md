

## Plan: Bug Fixes and Quick Improvements

### Issue 1: DND not clearing on PMS upload for Room 002

**Root Cause:** The PMS upload code at line 611 does set `is_dnd: false`, `dnd_marked_at: null`, `dnd_marked_by: null` for every processed room. However, room 002 has DND marked from Feb 13 and still shows as DND. The issue is that the PMS upload uses `hotelNameForFilter` to find rooms via `.eq('hotel', hotelNameForFilter)`. The `hotelNameForFilter` is resolved from `hotel_configurations` to `'Hotel Memories Budapest'`, which should match. The actual bug is likely that the room update is succeeding but DND data in the `room_assignments` table (which has its own `is_dnd`, `dnd_marked_at`, `dnd_marked_by` columns) is NOT being cleared. The PMS upload only clears DND on the `rooms` table, not on existing assignments.

**Fix in `src/components/dashboard/PMSUpload.tsx`:**
- After clearing assignments for the hotel (around line 354-382), also reset DND on the `rooms` table for ALL rooms of the selected hotel before processing begins, to ensure a clean slate.
- Add an explicit batch update: `UPDATE rooms SET is_dnd = false, dnd_marked_at = null, dnd_marked_by = null WHERE hotel = hotelNameForFilter`

This ensures that even rooms not present in the PMS file get their DND cleared.

---

### Issue 2: Macsko Eva (manager) sees no rooms

**Root Cause:** Eva's `assigned_hotel` is `'memories-budapest'` but rooms have `hotel: 'Hotel Memories Budapest'`. The code at line 129 does `.eq('hotel', profile.assigned_hotel)` which fails because `'memories-budapest' != 'Hotel Memories Budapest'`. The fallback at line 140-162 should catch this, but the `.or()` query at line 145 builds a filter string like `hotel_id.eq.memories-budapest,hotel_name.eq.memories-budapest` - the second part will also fail since the hotel_name is `Hotel Memories Budapest`. However `hotel_id.eq.memories-budapest` should match.

The real fix should be: resolve the hotel name FIRST (like `fetchManagerHotelName` does at line 464-471), then use that resolved name for the room query. This pattern already exists in `fetchManagerHotelName()`.

**Fix in `src/components/dashboard/RoomManagement.tsx`:**
- At the start of `fetchRooms()`, resolve `profile.assigned_hotel` to the proper hotel name via `hotel_configurations` lookup (same pattern as line 464-471 in HousekeepingManagerView), then use that resolved name for `.eq('hotel', resolvedName)`.

---

### Issue 3: Hotel name shows as "memories-budapest" instead of "Hotel Memories Budapest"

**Root Cause:** In `Dashboard.tsx` at lines 335 and 338, the code directly uses `profile?.assigned_hotel` which contains the hotel_id slug (`memories-budapest`), not the display name.

**Fix in `src/components/dashboard/Dashboard.tsx`:**
- Add a state variable and effect to resolve `profile.assigned_hotel` to the hotel display name via `hotel_configurations` lookup.
- Use the resolved name in the heading and subtitle instead of `profile?.assigned_hotel`.

**Also fix in `src/components/layout/Header.tsx`:**
- Line 80 shows `profile?.assigned_hotel || 'Hotel Care Hub'` - same issue. Resolve to display name.
- Line 118 shows `profile.assigned_hotel` - same fix.

---

### Issue 4: Sort housekeepers by assignment count in Team Management

**Fix in `src/components/dashboard/HousekeepingManagerView.tsx`:**
- At line 643-644, before mapping `housekeepingStaff`, sort the staff array so those with room assignments (`total_assigned > 0`) appear first, and those with no assignments appear last.

```
const sortedStaff = [...housekeepingStaff].sort((a, b) => {
  const aAssignment = teamAssignments.find(t => t.staff_id === a.id);
  const bAssignment = teamAssignments.find(t => t.staff_id === b.id);
  const aCount = aAssignment?.total_assigned || 0;
  const bCount = bAssignment?.total_assigned || 0;
  if (aCount > 0 && bCount === 0) return -1;
  if (aCount === 0 && bCount > 0) return 1;
  return bCount - aCount;
});
```

---

### Issue 5: Change "Currently selected" to "Last used"

**Fix in `src/components/dashboard/HotelSelectionScreen.tsx`:**
- Line 83: Change `"Currently selected"` to `"Last used"`

---

### Summary of files to modify

| File | Changes |
|------|---------|
| `src/components/dashboard/PMSUpload.tsx` | Add batch DND reset for all hotel rooms before processing |
| `src/components/dashboard/RoomManagement.tsx` | Resolve hotel_id to hotel_name before querying rooms |
| `src/components/dashboard/Dashboard.tsx` | Resolve hotel_id to display name for heading/subtitle |
| `src/components/layout/Header.tsx` | Resolve hotel_id to display name |
| `src/components/dashboard/HousekeepingManagerView.tsx` | Sort staff cards by assignment count (assigned first) |
| `src/components/dashboard/HotelSelectionScreen.tsx` | "Currently selected" -> "Last used" |

