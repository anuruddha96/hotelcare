

## Plan: Minibar System Improvements

This plan addresses 5 areas: reception default page, room list bug fix, guest QR quantity limit, enhanced room chip actions, and multi-day usage handling.

---

### 1. Reception Users Default to Minibar Tab

**File: `src/components/dashboard/Dashboard.tsx`**

Change `getDefaultTab` so the `reception` case returns `"minibar"` instead of `"rooms"`.

---

### 2. Fix Empty Room List in "Record Minibar Usage" Dialog

**File: `src/components/dashboard/MinibarQuickAdd.tsx`**

The room query uses `.eq('hotel', profile?.assigned_hotel)` but the `rooms` table may store the full hotel name (e.g., "Hotel Ottofiori") while `profile.assigned_hotel` holds the short slug (e.g., "ottofiori"). 

Fix: resolve the hotel name from `hotel_configurations` first (same pattern used elsewhere), then query rooms with `.or(`hotel.eq.${slug},hotel.eq.${fullName}`)`.

---

### 3. Guest QR Page: Limit to Quantity 1 Per Item

**File: `src/pages/GuestMinibar.tsx`**

Currently guests can add multiple quantities via +/- buttons. Since each minibar has only one of each product:
- Remove the +/- quantity controls from the guest UI
- Change `addToCart` to only allow quantity = 1 (toggle: add or remove)
- Each item becomes a simple "Select" / "Selected" toggle button
- Cart items always have quantity 1
- Already-recorded items remain disabled with a checkmark

---

### 4. Enhanced Room Chips with Live Minibar Status and Quick Actions

**File: `src/components/dashboard/PerishablePlacementManager.tsx`**

When clicking a room chip, the dialog currently only shows perishable placement info. Enhance it to show a comprehensive minibar view:

- **Live minibar usage**: Fetch today's `room_minibar_usage` records for the clicked room and display them (item name, quantity, source, price)
- **Quick add usage**: Add a mini "Record Usage" form directly in the room chip dialog (item dropdown + submit) so managers can record minibar consumption without opening a separate dialog
- **Perishable status**: Keep existing placement info (active, expiring, overdue) with collect/refill actions
- **Room summary header**: Show room number, total minibar charges for today, and perishable status at a glance

This gives managers a single click to see everything about a room's minibar and take action.

---

### 5. Multi-Day Usage and Guest Stay Duration Handling

**File: `src/components/dashboard/MinibarTrackingView.tsx`**

The existing multi-day aggregation logic already uses `guest_nights_stayed` from PMS data. No major changes needed here -- the system already:
- Detects rooms with `guest_nights_stayed > 1`
- Fetches usage records going back N days
- Shows a "Full Stay (N nights)" badge

The room chip dialog (change 4 above) will also respect this by showing all uncleared usage for a room, not just today's -- giving a complete picture during long stays. The query for the room chip will use `.eq('is_cleared', false)` without date filtering to show the full accumulation.

---

### Technical Summary

| Change | File | Effort |
|--------|------|--------|
| Reception default tab to minibar | `Dashboard.tsx` | Small (1 line) |
| Fix MinibarQuickAdd room query | `MinibarQuickAdd.tsx` | Small (add hotel resolution) |
| Guest QR: quantity 1 only | `GuestMinibar.tsx` | Medium (simplify cart UI) |
| Enhanced room chip dialog | `PerishablePlacementManager.tsx` | Large (add usage fetch, quick-add form) |
| Multi-day usage in chip dialog | `PerishablePlacementManager.tsx` | Included in above |

