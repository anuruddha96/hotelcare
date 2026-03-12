

## Plan: Fix Lost & Found Visibility, Attendance for Managers, and Simplify Approval Cards

### Issue 1: Lost & Found Not Showing for Hotel Ottofiori

**Root Cause**: The hotel filtering at line 104-108 uses a strict equality check (`item.rooms?.hotel === userHotel`), but hotel names may be stored differently (slug vs display name). More importantly, the query filters by `.lte('found_date', ...)` which only shows items found up to the selected date — but **uncollected items** (status != 'claimed') from ANY date should always appear regardless of date selection.

**Fix** in `src/components/dashboard/LostAndFoundManagement.tsx`:
1. Fetch ALL uncollected items (status = 'pending' or 'reported') regardless of date, PLUS items matching the selected date filter.
2. Add hotel name resolution via `hotel_configurations` (same pattern as other components) so `assigned_hotel` slug matches room hotel names.

---

### Issue 2: Managers Cannot See Attendance Records

**Root Cause**: The SQL function `get_attendance_records_hotel_filtered` at line 118 uses `AND p.assigned_hotel = current_user_hotel` — a strict equality. If the manager's `assigned_hotel` is stored as a slug (e.g., `memories-budapest`) but staff profiles store the full name (e.g., `Hotel Memories Budapest`), no records match.

**Fix**: Update the SQL function to resolve hotel name variations via `hotel_configurations`, matching the pattern used elsewhere. Compare both `hotel_id` and `hotel_name` from `hotel_configurations`.

**File**: New migration SQL

---

### Issue 3: Simplify Approval Cards for Managers

**Current state**: Each card shows: room number, floor, type, DND badge, bed config badge, speed indicator, wait time, 4-cell stats grid (cleaned by, started, completed, duration), notes section, photo thumbnails, inline linen summary, CompletionDataView component, special requirements (T/C), and action buttons. This is too much information at first glance.

**Fix** in `src/components/dashboard/SupervisorApprovalView.tsx`:
1. **Keep prominent**: Room number, cleaning type, cleaned-by name, duration + speed indicator, and action buttons (Approve / Reassign).
2. **Keep visible but compact**: Special requirements (T/C badges), notes (if any).
3. **Move to expandable "Details" section**: Linen summary, completion photos, CompletionDataView, start/complete times, bed config, DND badge. These are available on tap but don't clutter the default view.
4. Remove the 4-cell stats grid — replace with a single line: "Cleaned by **Name** · **Duration** · Started HH:MM".

---

### Summary of Changes

| File | Changes |
|------|---------|
| `src/components/dashboard/LostAndFoundManagement.tsx` | Always show uncollected items regardless of date; add hotel name resolution |
| `src/components/dashboard/SupervisorApprovalView.tsx` | Simplify approval cards: compact header with key info, expandable details section |
| New migration | Fix `get_attendance_records_hotel_filtered` to resolve hotel name via `hotel_configurations` |

