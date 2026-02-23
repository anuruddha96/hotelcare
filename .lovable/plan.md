

## Plan: Perishable Tracker Fixes, PMS History Fix, Minibar Translations, DND Room Chips, and Auto-Assignment Improvements

This plan covers 6 areas based on your requirements.

---

### 1. Prevent Duplicate Perishable Placements + Better Success Flow

**File: `src/components/dashboard/PerishablePlacementManager.tsx`**

**Problem**: The "Refill" button allows placing a new item even when an active placement already exists for the same item in that room. Also, after collect/refill actions, the user stays in the dialog instead of returning to the tracker.

**Fix**:
- In `handleRefillRoom`: Check if the room already has an active placement for the selected item. If yes, show a toast warning "This room already has an active item" and block the insert.
- In `handleBulkPlace`: Filter out rooms that already have an active placement for the selected item. Show a warning if some rooms were skipped.
- After `handleMarkCollected`, `handleCollectAndRefill`, `handleCollectAllOverdue`, and `handleCollectAndRefillAllOverdue`: Show a clear success toast and **close the action dialog** (`setActionDialogOpen(false)`) so the user returns to the room chip grid immediately.
- Hide the "Refill with new item" section in the room dialog when an active placement already exists for the selected perishable item.

---

### 2. Show DND Status on Room Chips

**File: `src/components/dashboard/PerishablePlacementManager.tsx`**

- Update `fetchRooms` to also fetch `is_dnd` from the rooms table
- Update the `RoomOption` interface to include `is_dnd: boolean`
- Add a small "DND" indicator on room chips when `room.is_dnd === true` (a small purple badge or icon, similar to C/O and D badges)

---

### 3. Fix PMS Upload History Not Showing Recent Records

**File: `src/components/dashboard/PMSUploadHistoryDialog.tsx`**

**Root Cause**: The dialog receives `hotelFilter` as the full hotel name (e.g., "Hotel Ottofiori") from the parent, but the `pms_upload_summary` table stores `hotel_filter` as the slug (e.g., "ottofiori"). The query `.eq('hotel_filter', hotelFilter)` fails to match.

**Fix**: Resolve the hotel filter to check both slug and full name. Use `.or()` to match either:
```
query = query.or(`hotel_filter.eq.${slug},hotel_filter.eq.${fullName}`)
```
Or simply resolve the slug from `hotel_configurations` before querying, similar to the pattern used elsewhere.

---

### 4. Translate Missing Strings on Minibar Tracking Page

**Files: `src/components/dashboard/MinibarTrackingView.tsx`, `src/components/dashboard/PerishablePlacementManager.tsx`, `src/lib/comprehensive-translations.ts`**

Several strings on the Minibar Tracking page are hardcoded in English:
- "Items consumed", "Rooms with charges", "Average spend", "Avg per Room"
- "Record Usage", "QR Codes", "Manage Items", "Clear All Records"
- "Search room or item..."
- "Add to guest bill at checkout"
- Perishable tracker strings: "Perishable Item Tracker", "Bulk Place", "Collect Today", "Overdue", "Active", "No Items", "Collect", "Collect and Refill", etc.

Add translation keys and provide translations for all supported languages (English, Spanish, Hungarian, Vietnamese, Mongolian).

---

### 5. Minibar Date Picker: Link to Room Check-in/Check-out Dates

**File: `src/components/dashboard/MinibarTrackingView.tsx`**

**Current behavior**: The date picker shows usage only for the selected calendar date. Multi-day stays are partially handled by fetching N extra days back, but the logic relies on `guest_nights_stayed` which only tells how long the guest has been there, not the actual check-in date.

**Improvement**: The PMS upload already sets `is_checkout_room` and `guest_nights_stayed` on rooms daily. The current multi-day logic already works -- it detects rooms with `guest_nights_stayed > 1` and fetches records going back that many days. The key improvement is:

- Change the date picker label from just a date to show context: "Usage as of [date]" to clarify it shows accumulative stay data
- For rooms with multi-day stays, show the calculated check-in date in the room card header (check-in = selectedDate - guest_nights_stayed + 1)
- Ensure the "Full Stay" badge shows the date range, not just the night count
- Add a subtitle under the summary cards showing "Showing usage for current guest stays based on PMS data"

---

### 6. Auto-Assignment Algorithm Improvements

**File: `src/lib/roomAssignmentAlgorithm.ts`**

The algorithm already has strong foundations (wing grouping, floor concentration penalties, affinity learning, room size weighting, towel/linen considerations). The improvements:

- **Hotel-specific configuration**: Add a hotel config parameter to `autoAssignRooms` that allows per-hotel tuning (e.g., different floor penalty weights for Ottofiori vs Memories Budapest)
- **Stronger checkout-first grouping**: Currently checkouts and dailies are mixed in wing groups. Add an option to prioritize assigning checkout rooms first to the same housekeeper before filling with dailies, keeping spatial proximity
- **Improved affinity weighting**: Increase the affinity bonus multiplier from 10x to 15x so historical patterns have stronger influence on assignments
- **Better room sequence optimization**: After initial assignment, run a post-processing pass that swaps individual rooms between staff if the swap improves both sequence continuity and doesn't worsen floor spread
- **Distance calculation improvement**: For hotels without wing data, use room number proximity as a distance proxy (rooms 101-105 are "closer" than 101 and 205)

---

### Technical Summary

| Change | File(s) | Effort |
|--------|---------|--------|
| Prevent duplicate placements + success flow | PerishablePlacementManager.tsx | Medium |
| DND badge on room chips | PerishablePlacementManager.tsx | Small |
| Fix PMS Upload History filter | PMSUploadHistoryDialog.tsx | Small |
| Translate minibar page strings | MinibarTrackingView.tsx, PerishablePlacementManager.tsx, comprehensive-translations.ts | Medium |
| Minibar date picker context | MinibarTrackingView.tsx | Small |
| Auto-assignment improvements | roomAssignmentAlgorithm.ts | Medium |

