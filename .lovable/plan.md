

## Plan: Fix Minibar Tracking Visibility, Reception Room Overview, and Auto Stay Detection

---

### Problem 1: Minibar Usage Not Appearing in Tracking View

**Root cause**: The query in `MinibarTrackingView.tsx` (line 415) filters with `.eq('is_cleared', false)`. However, yesterday's minibar records already have `is_cleared: true` (confirmed by database query). This happens because the PMS upload or "Clear for Checkout" action marks records as cleared. The tracking view should show ALL usage records for the selected date regardless of cleared status -- `is_cleared` is a checkout workflow flag, not a visibility flag.

**File: `src/components/dashboard/MinibarTrackingView.tsx`**
- Remove `.eq('is_cleared', false)` from line 415 in `fetchMinibarData()`
- This ensures managers, admins, and reception can see ALL minibar usage for any date, whether cleared or not
- Optionally add a visual indicator (a "Cleared" badge) for records where `is_cleared` is true, so staff know which items have already been billed

---

### Problem 2: Reception Users See Limited Room Overview

**Root cause**: In `Dashboard.tsx` line 660-664, the reception `HotelRoomOverview` is passed `staffMap={{}}` (empty object), so no housekeeper names appear on room chips. The `HotelRoomOverview` component also gates click-to-edit behind `isManagerOrAdmin` (line 142), which correctly excludes reception, but reception should still see all visual info.

**File: `src/components/dashboard/Dashboard.tsx`**
- For reception users, fetch housekeeping staff profiles (same query as `HousekeepingManagerView` uses) to build a `staffMap` and pass it to `HotelRoomOverview`
- Add a `useEffect` that fetches profiles with `role = 'housekeeping'` for the user's hotel when `profile.role === 'reception'`
- Build `staffMap` as `Object.fromEntries(staff.map(s => [s.id, s.full_name]))` and pass it to the component

**File: `src/components/dashboard/HotelRoomOverview.tsx`**
- No changes needed -- the component already handles read-only mode correctly by gating `handleRoomClick` behind `isManagerOrAdmin`. Reception users will see all color codes, badges (T, RC, RTC), staff names, and tooltips, but cannot click to edit rooms. The Map/List toggle is also gated behind `isManagerOrAdmin`, which is fine.

---

### Problem 3: Auto-Detect Full Stay from PMS Data

**Current state**: The "Full Stay" toggle in `MinibarTrackingView` is manual. The PMS upload already writes `guest_nights_stayed` to the `rooms` table. When `guest_nights_stayed > 1`, the system should automatically show the full-stay aggregated minibar data.

**File: `src/components/dashboard/MinibarTrackingView.tsx`**
- Remove the manual "Full Stay" toggle switch
- Instead, auto-detect: after fetching minibar usage for the selected date, check if any room with usage has `guest_nights_stayed > 1` from the joined `rooms` data
- For rooms where `guest_nights_stayed > 1`, automatically expand the query window to fetch usage from the past N days (where N = `guest_nights_stayed`)
- This requires a two-pass approach:
  1. First fetch: Get today's usage (standard single-day query)
  2. For rooms with `guest_nights_stayed > 1`, do a second fetch for those room IDs expanding the date range
  3. Merge results and show a "Full Stay (N nights)" badge on those room cards
- Show a "Full Stay" badge on room cards that have multi-day data, with the total across all days

**Implementation approach:**
```text
1. Fetch single-day usage as normal
2. Extract unique room_ids from results
3. Check rooms data for guest_nights_stayed > 1
4. For those rooms, fetch additional usage records going back N days
5. Merge and deduplicate records
6. Display "N nights" badge on affected room cards
```

---

### Technical Summary

| File | Changes |
|------|---------|
| `src/components/dashboard/MinibarTrackingView.tsx` | Remove `is_cleared: false` filter. Remove manual Full Stay toggle. Auto-detect multi-day stays from `guest_nights_stayed` and expand date range for those rooms. Add "Cleared" badge for billed items. Add "Full Stay (N nights)" badge for multi-day rooms. |
| `src/components/dashboard/Dashboard.tsx` | Fetch housekeeping staff for reception users and pass populated `staffMap` to `HotelRoomOverview`. |

