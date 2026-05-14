## Goal

Simplify Previo test hotel housekeeping flow: remove the dedicated PMS Upload tab/button, surface a single **PMS Refresh** button inside Team View for managers, and ensure the refresh updates room/PMS state **without wiping housekeeper assignments**. Other hotels (incl. OttoFiori) untouched.

## Scope guard

Every change below is gated by `selectedHotel === 'previo-test'`. OttoFiori and all other live hotels render exactly as they do today.

## Changes

### 1. `HousekeepingTab.tsx` — hide PMS Upload tab for previo-test
- When the active hotel is `previo-test`, exclude `'pms-upload'` from `getTabOrder()` and from the default-tab logic (skip the "no upload today → switch to pms-upload" branch; default managers to `'manage'` / Team View).
- Leave the tab visible for every other hotel — Excel upload flow stays intact for OttoFiori etc.

### 2. `HousekeepingManagerView.tsx` / `HotelRoomOverview.tsx` — add PMS Refresh button
- Inside the Team View → Hotel Room Overview header, add a **PMS Refresh** button.
- Visible only when:
  - `selectedHotel === 'previo-test'`, AND
  - user role is in the manager set (`admin`, `top_management`, `manager`, `housekeeping_manager`, `front_office`).
- On click:
  1. Invoke `previo-pms-sync` edge function (same call PMSUpload already makes).
  2. Pipe returned rows through the **existing** PMS processing pipeline, but in a new "refresh" mode that:
     - Updates `is_checkout_room`, `is_checkin_room`, `guest_nights_total`, `guest_count`, `guest_notes`, occupancy, PMS status fields on `rooms`.
     - **Does NOT** clear/overwrite `assigned_to` (housekeeper assignments) or delete from `room_assignments` for the day.
  3. Refresh the room overview list.
- Reuse the inline "Last sync … Status …" summary from `PmsSyncStatus` (compact mode) directly above/next to the button so managers see freshness without leaving Team View.

### 3. PMSUpload pipeline — non-destructive refresh path
- Add a `mode: 'full' | 'refresh'` parameter to the room-update routine in `PMSUpload.tsx` (extract the per-row update into a small helper if needed).
- `'full'` (Excel upload + manual "Sync with Previo" button, current behaviour) keeps today's reset behaviour for hotels that still rely on it.
- `'refresh'` (new Team View button) skips:
  - resetting `assigned_to` / cleaning-status downgrades tied to assignment churn,
  - the "Data Reset Warning" side-effects.
  Only PMS-derived fields (checkout/checkin/occupancy/guest info) are written.
- Manual & auto room-assignment paths remain the **only** things that mutate housekeeper assignments — unchanged.

### 4. Cleanup
- Remove the standalone "Sync with Previo" + "Refresh Checkouts" buttons from the previo-test PMS Upload card *only if* tab is hidden (kept reachable via admin if needed). For now: leave the PMS Upload component file intact, just hide the tab — zero risk to other hotels.
- No translation keys removed; `housekeeping.tabs.pmsUpload` still used by other hotels.

## Out of scope (for this round)
- Changing OttoFiori or any other hotel's behaviour.
- Auto-scheduled background PMS polling (will be added later via API once test hotel is validated).
- Touching `previo-pms-sync` edge function — already returns the rows we need.
- Removing PMS Upload tab globally — only hidden for previo-test.

## Technical notes
- Manager role check already exists in `HousekeepingTab` as `hasManagerAccess`; reuse the same predicate for the new button so visibility rules stay consistent.
- `PmsSyncStatus` already exposes `compact` mode — drop it in next to the button with `compact={true}` and `hotelId="previo-test"`.
- Refresh mode reuses the same Supabase update statements minus the `assigned_to: null` / assignment-clearing branches.

## Verification
- previo-test as manager: PMS Upload tab gone; Team View shows PMS Refresh button; clicking it updates checkout flags + occupancy without removing housekeeper assignments.
- previo-test as housekeeper: no button visible.
- OttoFiori as manager: PMS Upload tab still present, Excel upload unchanged, no PMS Refresh button in Team View.
