# Fix Team View room visibility + simplify Previo sync (test hotel only)

Scope is limited to the `previo-test` hotel for the new sync behaviour. No change to OttoFiori or other live hotels' workflows.

## Problem 1 — Team View › Hotel Room Overview is empty

`HotelRoomOverview.tsx` filters rooms with `.eq('hotel', hotelName)` where `hotelName` comes from `profile.assigned_hotel` (the slug `previo-test`). Rooms imported from Previo are stored under the resolved hotel name (e.g. `Previo Test Hotel`), so the slug never matches and the overview shows 0 rooms — even though Rooms › Room Status Overview (which already does slug→name resolution) shows them correctly.

This is the same root cause we already fixed in `EasyRoomAssignment` and `PMSUpload` using `src/lib/hotelKeys.ts`.

### Fix
- In `HotelRoomOverview.tsx`:
  - Import `resolveHotelKeys` from `@/lib/hotelKeys`.
  - In `fetchData` (around line 174), resolve `hotelKeys = await resolveHotelKeys(hotelName)` once.
  - Replace both `.eq('hotel', hotelName)` calls (rooms query line 183, assignments-related query line 192) with `.in('hotel', hotelKeys)`.
  - Also pass the resolved keys (or canonical name) down where `hotelName` is used for child queries that hit the `rooms` table.
- Audit siblings used by Team View for the same bug and patch them with the same pattern:
  - `CheckoutRoomsView.tsx`
  - `HousekeepingManagerView.tsx`
  - `AutoRoomAssignment.tsx` / `AutoAssignmentService.tsx` (auto-assign path)
  - Any other `.eq('hotel', ...)` against `rooms` / `room_assignments` reachable from Team View.

This unblocks Team View, Auto-Assign and Checkout Rooms for `previo-test` without touching OttoFiori (resolver is a no-op when slug == hotel_name).

## Problem 2 — Two sync buttons doing overlapping work

Today the PMS Upload tab shows:
- **Sync rooms now** (top right) → `previo-sync-rooms` edge fn → upserts the rooms catalog (room numbers, types, capacities) into the `rooms` table.
- **Sync with Previo** (bottom) → `previo-pms-sync` edge fn → returns today's reservation snapshot shaped like the legacy Excel, then runs the existing upload pipeline (checkouts / dirty / cleaning assignments).

Users have to click both, which is exactly the friction you described. They serve different purposes but should run as a single action.

### Fix (test hotel only)
- Make **Sync with Previo** the single user-facing action for `previo-test`:
  1. Call `previo-sync-rooms` first (catalog upsert) — guarded by the existing config checklist.
  2. Then call `previo-pms-sync` + run `processFile` exactly as today (operational snapshot).
  3. Then run `pollCheckouts` once so Team View reflects departures immediately.
  4. Surface combined progress + a single toast: `Catalog: X rooms · Snapshot: Y rooms · Checkouts: Z marked`.
- Hide the standalone **Sync rooms now** button in `PmsSyncStatus` when `compact` mode is used inside PMS Upload (keep it visible in Admin › PMS Configuration for setup/debug only).
- Keep the setup checklist + last-sync/error panel visible in PMS Upload (read-only) so admins still see status without an extra click.
- Trigger the same combined sync automatically:
  - On entering the PMS Upload tab if `last_sync_at` is older than 30 minutes.
  - On a 30-minute interval while the tab is open (already partially in place via `pollCheckouts`).
- All of the above is gated by `selectedHotel === 'previo-test'`. For every other hotel the existing Excel upload + manual buttons are unchanged.

## Out of scope (intentionally deferred)
- Rolling auto-sync out to OttoFiori or other live hotels.
- 12-month availability/pickup ingestion (Phase 2 in the existing pipeline).
- Any change to the revenue page.

## Acceptance
- Team View › Hotel Room Overview lists the 102 `previo-test` rooms with the same statuses shown on Rooms › Room Status Overview.
- Auto-Assign and Checkout Rooms see the same room set.
- One click on **Sync with Previo** refreshes catalog, runs the Excel-equivalent pipeline and polls checkouts; no second click needed.
- OttoFiori and other live hotels behave exactly as before — verified by reading the slug guard in each new code path.
