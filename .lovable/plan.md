

## Plan: PMS Hotel Filter, Auto-Assignment Staff UI Fix, and Room-Size Cleaning Times

---

### 1. PMS Upload History: Filter by Logged-in Hotel

**File: `src/components/dashboard/PMSUploadHistoryDialog.tsx`**

**Problem**: The query on line 47 fetches ALL `pms_upload_summary` records without filtering by hotel. A manager logged into Hotel Ottofiori sees Memories Budapest uploads (71 rooms) instead of only their own hotel's data.

**Fix**: Pass the user's `assigned_hotel` to the component and filter by it. The `pms_upload_summary` table has a `hotel_filter` column that stores the hotel name.

**Changes:**
- Add `hotelFilter` prop to the component interface
- Add `.eq('hotel_filter', hotelFilter)` to the query (line 47-56) when `hotelFilter` is provided
- Also need to pass this prop from the parent component (`PMSUpload.tsx` or wherever it's opened)

**File: `src/components/dashboard/PMSUpload.tsx`** (or parent)
- Pass `hotelFilter={profile?.assigned_hotel}` to `PMSUploadHistoryDialog`
- Resolve `assigned_hotel` to hotel name using `hotel_configurations` (same pattern used elsewhere)

---

### 2. Auto Room Assignment: Staff Section Scrolling Fix

**File: `src/components/dashboard/AutoRoomAssignment.tsx`**

**Problem**: The staff selection grid (lines 725-754) displays housekeepers in a 2-column grid that scrolls the entire dialog. With 8-10 housekeepers, the "Generate Preview" button gets pushed off-screen.

**Fix**: Constrain the staff list to a fixed-height scrollable container so the stats, time info, and action buttons remain visible:

- Wrap the staff grid (line 725) in a container with `max-h-[40vh] overflow-y-auto` 
- Keep the stats section and time estimation info above it (fixed, no scroll)
- Keep the footer buttons fixed at the bottom (they already are via `DialogFooter`)

This ensures all housekeepers are accessible via scrolling within the section while the page layout stays stable.

---

### 3. Room-Size-Based Cleaning Time Constants

**File: `src/lib/roomAssignmentAlgorithm.ts`**

**Current state**: `calculateRoomTime()` uses flat constants:
- Checkout: 45 min base + size bonuses (up to +15 min for 40+ sqm)
- Daily: 15 min base + size bonuses

**User's requirement**: 
- Small/Medium checkout rooms: 45 min
- Large/XXL checkout rooms: 60 min
- Daily cleaning: 15-20 min
- Towel change: 10 min (currently 5 min)

**Changes to `calculateRoomTime()`:**

```text
Current logic (lines 48-63):
  towel-only: 5 min
  checkout base: 45 min
  daily base: 15 min
  size >= 40: +15 min
  size >= 28: +10 min
  size >= 22: +5 min

New logic:
  towel-only: 10 min (was 5)
  checkout: 
    small/medium (< 28 sqm): 45 min
    large (28-39 sqm): 55 min
    XL/XXL (>= 40 sqm): 60 min
  daily:
    small/medium (< 28 sqm): 15 min
    large (28-39 sqm): 18 min
    XL/XXL (>= 40 sqm): 20 min
  linen change: +10 min (unchanged)
```

Also update `TOWEL_CHANGE_MINUTES` constant from 5 to 10.

This replaces the "base + addon" approach with a cleaner size-bracket system matching the user's specified times.

---

### 4. Analysis of Eva's Room Assignment Logic (from photo)

From the Memories Budapest photo with 5 staff (70 rooms: 35 CO + 35 daily), Eva's pattern:

- **Floor concentration**: Each person works on 2 floors max, with most rooms on a primary floor
- **Sequential grouping**: Adjacent room numbers are always kept together (e.g., 103-106, 132-145)
- **Balanced counts**: Everyone gets 14 rooms (7co + 7d), with tasks (T/L) distributed evenly
- **Wing logic**: Rooms in the same range (e.g., 100-120 vs 130-150) go to different people

The current algorithm already aims for this. The main gap is:
- The towel change time (5 min) is too low -- Eva treats it as 10 min work
- Room size distinction for checkout rooms needs the 45/60 split

These are addressed by change #3 above. No additional algorithm structural changes needed -- the floor penalties (15x/40x) from the previous update are strong enough.

---

### Technical Summary

| File | Changes |
|------|---------|
| `src/components/dashboard/PMSUploadHistoryDialog.tsx` | Add `hotelFilter` prop. Filter query by `hotel_filter` column. |
| `src/components/dashboard/PMSUpload.tsx` | Pass hotel filter prop to history dialog. |
| `src/components/dashboard/AutoRoomAssignment.tsx` | Add `max-h-[40vh] overflow-y-auto` to staff selection grid container. |
| `src/lib/roomAssignmentAlgorithm.ts` | Update `TOWEL_CHANGE_MINUTES` to 10. Replace size addon system with bracket-based times (45/55/60 for checkout, 15/18/20 for daily). |

