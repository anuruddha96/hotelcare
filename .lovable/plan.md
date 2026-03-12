

## Plan: Fix Hotel Switcher Staff Visibility + Add Change Room (C) Indicator

### Issue 1: Managers Can't See Housekeepers After Hotel Switch

**Root Cause**: In `HousekeepingStaffManagement.tsx` line 348, the staff query uses a simple `eq('assigned_hotel', profileData.assigned_hotel)`. But staff profiles may store `assigned_hotel` as either the hotel slug (`memories-budapest`) or the full name (`Hotel Memories Budapest`). The `HousekeepingManagerView.tsx` already handles this correctly by resolving hotel name variations through `hotel_configurations` — but Staff Management does not.

**Fix**: Add the same hotel name resolution pattern from `HousekeepingManagerView` into `fetchHousekeepingStaff()`. Instead of `query.eq('assigned_hotel', profileData.assigned_hotel)`, look up the hotel config to get both `hotel_id` and `hotel_name`, then filter staff client-side against all variations (matching the proven pattern from the Manager View).

**File**: `src/components/dashboard/HousekeepingStaffManagement.tsx`

---

### Issue 2: Change Room (C) Indicator on Days 5, 9, 13, 17...

**Root Cause**: The current cleaning cycle (line 608-621 in `PMSUpload.tsx`) uses a 6-day repeating pattern: T, T, RC. The user's hotel uses a different 4-day alternating cycle starting from day 3:
- Day 3, 7, 11, 15: **Towel Change (T)**
- Day 5, 9, 13, 17: **Change Room (C)** — equivalent to linen/full clean

The correct pattern is: starting from day 3, alternate T and C every 2 days.

**Fix**:
1. **Update PMS cleaning cycle** in `PMSUpload.tsx`: Change the cycle from `(day - 3) % 6` to `(day - 3) % 4`. Days where `cyclePosition === 0` (3, 7, 11, 15) = Towel. Days where `cyclePosition === 2` (5, 9, 13, 17) = Linen/Change Room.

2. **Show "C" instead of "L"** in auto-assignment preview (`AutoRoomAssignment.tsx`): Replace the `L` label for linen change with `C` (Change Room) to match hotel terminology. Also add this to the `HotelRoomOverview.tsx` legend.

3. **Add translation keys** for "Change Room" / "C" in `useTranslation.tsx`.

### Files Changed

| File | Changes |
|------|--------|
| `src/components/dashboard/HousekeepingStaffManagement.tsx` | Resolve hotel name variations before filtering staff |
| `src/components/dashboard/PMSUpload.tsx` | Fix cleaning cycle: alternate T/C every 2 days from day 3 |
| `src/components/dashboard/AutoRoomAssignment.tsx` | Show "C" label instead of "L" for linen_change rooms |
| `src/components/dashboard/HotelRoomOverview.tsx` | Add "C" to legend |
| `src/hooks/useTranslation.tsx` | Add "Change Room" translation keys |

