

## Plan: Fix Missing Translations, Add Refresh Buttons, Enhance Reception Room Overview, and Improve Minibar Stay-Based View

### 1. Fix Missing Translation Keys on Minibar Tracking Page

**File: `src/hooks/useTranslation.tsx`**

The screenshot shows raw translation keys like `minibar.searchRoomOrIt`, `minibar.recordUsage`, `minibar.manageItems`, `minibar.avgPerRoom`, `minibar.itemsConsumed`, `minibar.roomsWithCharges`, `minibar.averageSpend` displayed as-is. These keys are referenced in `MinibarTrackingView.tsx` but have no definitions in the translation files.

Add the following keys to all 5 language sections (en, es, hu, vi, mn) in `useTranslation.tsx`:

- `minibar.searchRoomOrItem` - "Search room or item..."
- `minibar.recordUsage` - "Record Usage"
- `minibar.manageItems` - "Manage Items"
- `minibar.qrCodes` - "QR Codes"
- `minibar.clearAllRecords` - "Clear All Records"
- `minibar.avgPerRoom` - "Avg per Room"
- `minibar.itemsConsumed` - "Items consumed"
- `minibar.roomsWithCharges` - "Rooms with charges"
- `minibar.averageSpend` - "Average spend"
- `minibar.addToGuestBill` - "Add to guest bill at checkout"

### 2. Add Refresh Button to Minibar Tracking Page

**File: `src/components/dashboard/MinibarTrackingView.tsx`**

Add a "Refresh" button (using `RefreshCw` icon from lucide) next to the date picker in the header toolbar. On click, it calls `fetchMinibarData()` and shows a brief loading spinner animation on the button.

### 3. Enhance Reception Hotel Room Overview to Match Manager View

**File: `src/components/dashboard/HotelRoomOverview.tsx`**

Currently reception users see the same `HotelRoomOverview` component but with limited interaction (`isManagerOrAdmin` guards prevent clicking rooms). The reception view already shows the same data (staff names, color codes, status indicators). The changes needed:

- Allow the List/Map view toggle for reception users (currently hidden behind `isManagerOrAdmin` check on line 542)
- Add a "Refresh" button to the overview header that calls `fetchData()` for both reception and manager views
- Keep room click behavior read-only for reception (no edit dialog) -- this already works correctly since `handleRoomClick` returns early if not manager/admin

### 4. Smart Stay-Based Minibar View for Reception

**File: `src/components/dashboard/MinibarTrackingView.tsx`**

Replace the date-picker-centric view with a stay-aware consolidated view:

- Remove the date picker as the primary filter. Instead, default to showing **all rooms with uncleared minibar usage** (`is_cleared = false`), giving reception a complete picture of what needs to be billed at checkout.
- For each room card, calculate and show the check-in date based on `guest_nights_stayed` from PMS data: `check_in_date = today - guest_nights_stayed + 1`
- Show a date range header on each room card: "Check-in: Feb 20 -- Checkout: Feb 24 (4 nights)" for multi-day stays, or "1-night stay" for single-night guests
- Group usage records by day within each room card so reception can see "Day 1: Brownie Box EUR 5.00, Day 2: Water EUR 2.00" etc.
- Keep the date picker as a secondary/optional filter for historical lookups, but the default "Current Stays" view shows all uncleared usage across all active rooms
- Add a toggle: "Current Stays" (default, shows all uncleared) vs "By Date" (existing date-picker view)

### Technical Summary

| Change | File(s) | Effort |
|--------|---------|--------|
| Fix 10+ missing minibar translation keys | `useTranslation.tsx` (all 5 languages) | Medium |
| Add Refresh button to Minibar Tracking | `MinibarTrackingView.tsx` | Small |
| Unlock List/Map toggle + Refresh for reception | `HotelRoomOverview.tsx` | Small |
| Stay-based minibar view with check-in/out dates | `MinibarTrackingView.tsx` | Large |

