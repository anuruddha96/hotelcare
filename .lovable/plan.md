
## Plan: Fix 6 Issues - Translation, PMS Upload, Sign-in Check, Upload History, Auto-Assign, Session

### Issue 1: "common.deselectAll" Translation Missing

**File:** `src/hooks/useTranslation.tsx`

The keys `common.selectAll` and `common.deselectAll` are not defined in the translation dictionaries. The code at `HousekeepingManagerView.tsx:768` uses `t('common.deselectAll') || 'Deselect All'` -- the fallback works but shows the raw key briefly.

**Fix:** Add `common.selectAll` and `common.deselectAll` entries to all language sections (en, hu, es, vi, mn).

---

### Issue 2: PMS File Upload Failing on Windows

**File:** `src/components/dashboard/PMSUpload.tsx`

**Root Cause:** The code uses hardcoded property names (`row.Room`, `row.Occupied`, `row.Departure`, etc.) that must exactly match Excel column headers. Windows Excel may produce headers with:
- BOM characters or invisible whitespace
- Locale-specific column names
- Different casing or trailing spaces

When headers don't match, `row.Room` is `undefined`, so every row is silently skipped (line 319: `if (!row || !row.Room ...)`), resulting in 0 processed rooms.

**Fix:** Implement dynamic column mapping:
1. After `sheet_to_json`, inspect the first row's keys
2. Build a column map by fuzzy-matching headers (case-insensitive, trimmed, partial match) to expected fields: Room, Occupied, Departure, Arrival, People, Night/Total, Note, Nationality, Defect, Status
3. Use a helper function `getField(row, fieldName)` that looks up via the column map instead of direct property access
4. Add diagnostic logging: log detected headers and the resolved column map so future issues are traceable
5. Show a toast warning if critical columns (Room) can't be mapped

---

### Issue 3: PMS Upload History - Expandable Room Distribution

**File:** `src/components/dashboard/PMSUploadHistoryDialog.tsx`

Currently the room distribution section (lines 173-215) always shows, but only displays first 5 rooms with "... and X more" -- there's no way to expand it.

**Fix:**
1. Add an `expandedSummaries` state (`Set<string>`) tracking which upload IDs are expanded
2. Wrap the room details section in a collapsible area with a "Show Room Details" / "Hide Room Details" toggle button
3. When expanded, show ALL checkout and daily rooms instead of only 5
4. Add a chevron icon to indicate expand/collapse state

---

### Issue 4: Housekeepers Starting Rooms Without Signing In

**File:** `src/components/dashboard/AssignedRoomCard.tsx`

The existing attendance check (lines 252-344) looks correct -- it fetches fresh attendance data and blocks if not checked in. However, the issue may be:

1. The `showToast` call with an action button using DOM selectors (`[data-value="attendance"]`) may not find the tab element on mobile views (MobileHousekeepingView doesn't render the same tab structure)
2. The toast may auto-dismiss too quickly for users to see the message and click the button

**Fix:**
1. Make the toast persistent (set `duration: Infinity` or a very long duration like 15000ms)
2. Use `toast.error()` from sonner instead of `showToast` which may have shorter defaults
3. Add a more reliable redirect mechanism -- instead of DOM selectors, store a callback in a shared state or use a simple `window.location.hash` approach
4. Add a visible inline banner/alert on the room card itself (not just a toast) when the user is not signed in, with a prominent "Go to Sign In" button
5. Check the MobileHousekeepingView -- if it has its own start logic, ensure the same attendance check exists there

---

### Issue 5: Auto-Assign Fairness + Room Size Configuration from Hotel Room Overview

**Files:** `src/lib/roomAssignmentAlgorithm.tsx`, `src/components/dashboard/HotelRoomOverview.tsx`

The auto-assign algorithm already uses room_size_sqm for weighting. The request is to let managers update room size by clicking room cards in the Hotel Room Overview.

**Fix in HotelRoomOverview.tsx:**
1. Add a small dialog/popover that opens when a manager/admin clicks a room chip
2. The dialog shows room number, current size, and lets the user select Small/Medium/Large (mapped to approximate sqm values: Small=15, Medium=25, Large=35, XL=45)
3. On save, update `room_size_sqm` in the rooms table
4. Fetch `room_size_sqm` in the rooms query and display size badge on chips

---

### Issue 6: Rooms Disappearing for Eva_0005 After Inactivity

**Root Cause Analysis:** This is likely a Supabase session token expiration issue. When the user leaves the app idle, the JWT expires. The `autoRefreshToken: true` setting should handle this, but if the tab is backgrounded (mobile browser), the refresh may fail silently. When `onAuthStateChange` fires with `SIGNED_OUT`, the user state becomes null and the app redirects to auth, making rooms "disappear."

**Fix in `src/hooks/useAuth.tsx`:**
1. Add a visibility change listener that manually calls `supabase.auth.getSession()` when the tab becomes visible again
2. If the session is still valid, re-fetch the profile to ensure data is fresh
3. If the session expired, show a clear "Session expired, please log in again" message instead of silently redirecting

**Fix in `src/components/dashboard/HousekeepingStaffView.tsx`:**
1. Add error handling in `fetchAssignments` -- if the query fails with an auth error, show a "Session expired" toast with a login button rather than showing empty rooms

---

### Summary of Files to Edit

| File | Changes |
|------|---------|
| `useTranslation.tsx` | Add `common.selectAll` and `common.deselectAll` translations for all languages |
| `PMSUpload.tsx` | Dynamic column mapping with fuzzy header matching; diagnostic logging |
| `PMSUploadHistoryDialog.tsx` | Add expandable/collapsible room distribution with toggle state |
| `AssignedRoomCard.tsx` | Make sign-in warning persistent; add inline banner; improve redirect reliability |
| `HotelRoomOverview.tsx` | Add click-to-edit room size dialog for managers; show size badges on chips |
| `useAuth.tsx` | Add visibility change listener to re-validate session on tab focus |
| `HousekeepingStaffView.tsx` | Add auth error handling in data fetch |
