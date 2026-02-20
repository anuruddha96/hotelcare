

## Plan: Perishable Minibar Item Tracking System

### The Problem

Certain minibar items (like freshly baked brownies) are perishable and must be collected from rooms after a set number of days. Currently, there is no way to:
- Record which rooms received perishable items and when
- Alert housekeepers/managers when items are about to expire or have expired
- Track the collection status

### Solution: Perishable Placement Tracking

A new database table `minibar_placements` will track when perishable items are placed in specific rooms. Combined with an `expiry_days` column on `minibar_items`, the system can automatically calculate expiration dates and show alerts.

---

### Database Changes

**1. Add `expiry_days` column to `minibar_items`**
- New nullable integer column `expiry_days` (NULL = non-perishable, 2 = expires in 2 days, etc.)
- The brownie item will be updated to set `expiry_days = 2`

**2. New table: `minibar_placements`**

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| room_id | uuid | Which room received the item |
| minibar_item_id | uuid | Which item was placed |
| placed_by | uuid | Staff who placed it |
| placed_at | timestamptz | When it was placed |
| expires_at | timestamptz | Auto-calculated: placed_at + expiry_days |
| quantity | integer | How many placed (default 1) |
| status | text | 'active', 'collected', 'consumed' |
| collected_by | uuid | Who collected it (nullable) |
| collected_at | timestamptz | When collected (nullable) |
| hotel | text | Hotel name for filtering |
| organization_slug | text | Organization |

RLS policies: Staff can insert, managers/admins can view all, housekeepers can view their hotel's placements, staff can update status.

---

### Frontend Changes

**1. Admin Item Management -- `src/components/dashboard/MinimBarManagement.tsx`**
- Add "Expiry Days" field to the item create/edit form
- Only shown when relevant (snack/food categories, or always available)
- Setting this to a number marks the item as perishable

**2. Minibar Tracking View -- `src/components/dashboard/MinibarTrackingView.tsx`**
- New "Perishable Alerts" section at the top (visible to managers, admins, reception)
- Shows cards for items expiring today or already expired:

```text
  [!] COLLECT TODAY - Room 402: Brownie Box (placed Feb 20, expires Feb 22)
  [!] COLLECT TODAY - Room 303: Brownie Box (placed Feb 20, expires Feb 22)
  [Overdue] Room 205: Brownie Box (placed Feb 18, expired Feb 20)
```

- Each alert card has a "Mark Collected" button
- Color coding: yellow for "collect today", red for "overdue", green for "collected"

**3. Quick Placement Feature -- `src/components/dashboard/MinibarTrackingView.tsx`**
- New "Place Perishable Items" button in the tracking view
- Opens a dialog where managers can:
  - Select a perishable item (dropdown filtered to items with `expiry_days` set)
  - Select multiple rooms (checkboxes)
  - Confirm placement
- This bulk-creates `minibar_placements` records with auto-calculated expiry dates

**4. Housekeeper View -- `src/components/dashboard/RoomDetailDialog.tsx`**
- If a room has an active perishable placement expiring today or overdue, show an alert banner:
  "Collect brownie box from minibar (placed Feb 20, expires today)"
- Housekeeper can tap "Collected" to mark it

---

### How It Works in Practice

```text
Day 1 (Today, Feb 20):
  Manager opens Minibar Tracking > "Place Perishable Items"
  Selects "Brownie Box" > checks rooms 402, 406, 303, 304, 302, 205, 204, 104, 102
  System creates 9 placement records, each with expires_at = Feb 22

Day 2 (Feb 21):
  Tracking view shows: "9 brownie boxes expiring tomorrow" (info banner)
  No action needed yet

Day 3 (Feb 22):
  Tracking view shows: "COLLECT TODAY: 9 rooms have expiring brownies"
  Housekeepers see alerts on their room detail cards
  As items are collected, staff marks them "Collected"
  Any uncollected items after today show as "Overdue" in red
```

---

### Technical Summary

| Change | File/Location |
|--------|---------------|
| Add `expiry_days` column to `minibar_items` | Database migration |
| Create `minibar_placements` table with RLS | Database migration |
| Update brownie item: `expiry_days = 2` | Data update |
| Add expiry field to item management form | `MinimBarManagement.tsx` |
| Add perishable alerts section | `MinibarTrackingView.tsx` |
| Add bulk placement dialog | `MinibarTrackingView.tsx` |
| Add collection alert in room detail | `RoomDetailDialog.tsx` |

