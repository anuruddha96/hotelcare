

## Plan: Enhanced Perishable Item Tracker with Room Types, Expiry Dates, and Improved UI

### Current State
- 9 rooms have brownie boxes that expired yesterday (Feb 21) and show as amber "Collect Today" but should show as **red/overdue**
- Room chips don't indicate whether a room is a checkout or daily room
- The room chip dialog is functional but could be more user-friendly
- No option to set a custom expiry date when placing/refilling items
- Housekeepers can't easily see which rooms need collection

---

### Changes

#### 1. Room Chips: Show Checkout vs Daily Room Type
**File: `src/components/dashboard/PerishablePlacementManager.tsx`**

- Fetch `is_checkout_room` and `guest_nights_stayed` alongside room data
- Add a small icon/label on each room chip:
  - "C/O" badge for checkout rooms
  - "D" or nights count for daily/stay rooms (e.g., "D3" for 3-night stay)
- This helps managers quickly understand room context when managing brownies

#### 2. Custom Expiry Date Selection
**File: `src/components/dashboard/PerishablePlacementManager.tsx`**

- In the **Bulk Place** dialog and the **Refill** action, add a date picker so managers can set a custom expiry date instead of relying solely on the item's default `expiry_days`
- Default pre-fills to `today + expiry_days` but can be overridden
- This handles situations where items were placed at different times or have varying freshness

#### 3. Improved Room Chip Dialog UI
**File: `src/components/dashboard/PerishablePlacementManager.tsx`**

Redesign the room action dialog for better usability:
- **Header**: Show room number, room type (Checkout/Daily + nights), and total minibar charges
- **Perishable section**: Show placement status with clear expiry countdown, "Mark Collected" and "Refill" actions prominently
- **Minibar Usage section**: Show live uncleared usage with inline quick-add form
- Make "Mark Collected + Refill" a combined one-tap action for efficiency (collect old, place new)
- Better visual hierarchy with color-coded status cards

#### 4. Overdue Visibility for Housekeepers and Managers
**File: `src/components/dashboard/PerishablePlacementManager.tsx`**

- The 9 expired brownie rooms (expires Feb 21, today is Feb 22) must show as **red/overdue**, not amber
- Add an **alert banner** at the top when overdue items exist: "9 rooms have expired items that need collection"
- Ensure the status summary badges always show overdue count prominently with a warning icon

#### 5. Status Summary Improvements
- Always show the overdue badge (even currently it may hide with conditional rendering)
- Add a quick-action: "Collect All Overdue" button that marks all overdue placements as collected in one click (for supervisors)
- Add "Collect and Refill All" button that collects overdue items and places fresh ones simultaneously

---

### Technical Details

**Room data model expansion** in `fetchRooms`:
```
.select('id, room_number, hotel, is_checkout_room, guest_nights_stayed')
```

**RoomOption interface update**:
```typescript
interface RoomOption {
  id: string;
  room_number: string;
  hotel: string;
  is_checkout_room: boolean;
  guest_nights_stayed: number;
}
```

**Room chip rendering** - each chip gets a small type indicator:
- Checkout rooms: small "C/O" text or luggage icon
- Daily rooms: "Dn" where n = nights stayed

**Expiry date picker** - uses the existing Shadcn Calendar/Popover pattern with `pointer-events-auto` on the calendar. Defaults to `today + expiry_days` but allows override.

**Collect and Refill All** - batch operation:
1. Update all overdue placements to `status: 'collected'`
2. Insert new placements for the same rooms with fresh expiry dates

| Change | Effort |
|--------|--------|
| Room type badges on chips | Small |
| Custom expiry date picker | Medium |
| Improved room dialog UI | Medium |
| Overdue alert banner + bulk actions | Medium |
| Status summary fixes | Small |

All changes are in `src/components/dashboard/PerishablePlacementManager.tsx`.

