## Show manager assignees in Team View + chip name labels

**Root cause:** Both name-lookup sources (`HousekeepingManagerView.fetchHousekeepingStaff` and `Dashboard.receptionStaffMap`) filter `role='housekeeping'`. When a manager like Nykipanchuk_073 (`housekeeping_manager` / `manager`) is the assignee for rooms 201/203, their id is missing from `staffMap` → chip renders with no name, and no card appears in Team View.

## Changes (frontend only, no schema, no business logic changes)

### 1. `src/components/dashboard/HousekeepingManagerView.tsx`
- After `fetchHousekeepingStaff` (or as a second query inside it): also fetch profiles for any `assigned_to` id present in today's `room_assignments` for the current hotel(s) that is NOT already in `housekeepingStaff`. Only these "extra" profiles (managers who happen to have rooms today) get appended so the card list shows their name.
- Guard: only append when that profile has ≥1 assignment for `selectedDate`. If they have zero assignments, no extra card is shown — matches "only if there are active rooms".
- The existing render loop over `housekeepingStaff` then naturally produces a card for Nykipanchuk with her real assignment counts, without adding empty cards for other managers.
- The `staffMap` passed to `HotelRoomOverview` (built from `housekeepingStaff`) now includes managers with assignments, so 201/203 chips show her name.

### 2. `src/components/dashboard/Dashboard.tsx` (`receptionStaffMap`)
- Broaden the reception-mode name lookup so chips also resolve manager names: fetch profiles where `role IN ('housekeeping','housekeeping_manager','manager')` for the reception's hotel. Reception still doesn't get any new actions — just correct labels on chips.

### 3. No changes to
- Assignment logic, auto-assign eligibility, or role permissions
- Team View for managers who have no rooms today (they will not appear as cards)
- Any styling/design tokens

## Verification
- Reload `/rdhotels` as an admin/manager: chips for 201/203 show "Nykipanchuk" (or her nickname/full name); a card labeled with her name appears in Team View with her room count and Done/Working/Pending stats.
- Managers with 0 rooms today do NOT get cards.
- Existing housekeeper cards and assignments are unchanged.
