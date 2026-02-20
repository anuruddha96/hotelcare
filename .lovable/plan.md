

## Plan: Fix Minibar "Unknown" Bug, Deduplication, and Receptionist UI Redesign

---

### 1. Fix "Recorded By" Showing "Unknown"

**File: `src/components/dashboard/MinibarTrackingView.tsx`**

**Root cause**: The SQL select query (line 233) fetches `id, quantity_used, usage_date, room_id, recorded_by, minibar_item_id` but does NOT include `source`. When the code later checks `(record as any).source === 'guest'` (line 286), it's always `undefined`, so the fallback is always "Unknown" for guest records (which have `recorded_by: null`).

**Fix**: Add `source` to the select query string:
```
select(`
  id,
  quantity_used,
  usage_date,
  room_id,
  recorded_by,
  minibar_item_id,
  source,          <-- ADD THIS
  rooms ( ... ),
  ...
`)
```

Then the existing logic `record.source === 'guest' ? 'Guest (QR Scan)' : 'Unknown'` will work correctly.

---

### 2. Prevent Duplicate Usage Records

**Current state**: Both the guest edge function and staff QuickAdd check for duplicates independently, but there's a gap:
- If a guest scans and records "Water Bottle x1" for Room 102, then a housekeeper also records "Water Bottle x1" for Room 102, the staff QuickAdd will block it (good).
- If staff records first, then guest scans, the edge function blocks it (good).
- BUT: If quantities differ (guest says 2, staff says 1), the second entry is simply skipped with no way to reconcile.

**Fix in `supabase/functions/guest-minibar-submit/index.ts`**:
- When a duplicate is found and the existing record was from staff, update the quantity to the HIGHER value (staff may have undercounted), rather than silently skipping.
- When a duplicate is found and it was from another guest scan, skip it (already handled).

**Fix in `src/components/dashboard/MinibarQuickAdd.tsx`**:
- When a duplicate is found and the existing record was from "guest", update it to the staff's quantity and change source to "staff" (staff confirmation overrides guest self-report), rather than blocking the submission entirely.
- Show a toast indicating the guest record was updated/confirmed by staff.

---

### 3. Redesign Minibar Tracking UI for Receptionists

**File: `src/components/dashboard/MinibarTrackingView.tsx`**

The current flat table with confusing column headers ("Processed Rooms" for price, "Count" for quantity) needs a complete redesign.

**Changes:**

A. **Group records by room** -- Instead of a flat table, show a card per room with all items listed inside. This lets receptionists quickly see "Room 102 owes EUR 10.00 for 2 items" at a glance.

B. **Fix column headers** -- Replace confusing labels:
   - "Processed Rooms" becomes "Unit Price"
   - "Count" becomes "Qty"
   - "Recorded By" stays
   - "Source" stays but with clearer badges (Guest Scan with a QR icon, Staff with a user icon, Reception with a desk icon)

C. **Room-grouped card layout**:
```
+--------------------------------------------+
| Room 102                      Total: EUR10 |
| Hotel Ottofiori               2 items      |
+--------------------------------------------+
| Item          Qty  Price  Source  Time      |
| Water Bottle   1   EUR5   Guest  09:40     |
| Coca Cola      1   EUR5   Guest  09:40     |
+--------------------------------------------+
```

D. **Better summary cards** -- Add a 4th summary card: "Average per Room" showing average spend.

E. **Enhanced search** -- Search also filters by item name, not just room number.

F. **Source badges with icons** -- Use distinct colors and small icons:
   - Guest (QR): amber/yellow badge with QR icon
   - Staff: blue badge
   - Reception: slate/gray badge

G. **Receptionist action hint** -- For rooms with usage, show a subtle "Add to guest bill" reminder text.

---

### Technical Summary

| File | Changes |
|------|---------|
| `src/components/dashboard/MinibarTrackingView.tsx` | Add `source` to select query. Redesign table to room-grouped cards. Fix column headers. Add item search. Better source badges. |
| `src/components/dashboard/MinibarQuickAdd.tsx` | When duplicate found from guest source, update existing record instead of blocking. |
| `supabase/functions/guest-minibar-submit/index.ts` | When duplicate found from staff, update quantity to max(existing, new) instead of skipping. |

