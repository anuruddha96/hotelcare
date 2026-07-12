## Goal

Make Ottofiori's PMS refresh behave the same as an XLSX upload does today, but for **every** room the property has — including rooms with no reservation today (like 305 today+empty tomorrow). Read clean status from Previo, decide "checkout tomorrow" correctly, and log a per-refresh snapshot so managers can review what changed before applying it.

## What breaks today for room 305

- `previo-pms-sync` for XML tenants only builds rows from reservations returned in a `[today, today+2)` window. If 305 has a guest tonight (arrival ≤ today, departure = today+1) it will appear, but any room without a reservation in that window is dropped — the app never sees it, so its dirty/clean flag is never reconciled.
- The row builder treats `isDeparture` as "departure date == today". A guest checking out **tomorrow** is currently `Occupied=Yes / Departure=null`, so the room isn't marked as a checkout room ahead of time.
- Clean status comes from `roomCleanStatusId` on `/rest/rooms`, which XML tenants skip. Result: 305 stays "dirty" in the app regardless of what reception sets in Previo.

## Fix

### 1) Full room roster from Previo XML (all rooms, every refresh)

- Add a shared helper `fetchPrevioRoomsXml()` that calls `Hotel.getRoomKinds` + `Hotel.rooms` (XML) and returns `{ objId, name, roomKindName, capacity, cleanStatusId }` for every room in the hotel.
- In `previo-pms-sync`: when protocol is `xml`, use this helper as the canonical `rooms[]` source instead of synthesising rooms from reservations. Reservations are still fetched and merged in by `objId` / `name`.
- Fallback: if the XML rooms call fails, keep today's synthesised-from-reservations behaviour so we never regress to zero rows.

### 2) Correct checkout-tomorrow handling

- Extend the reservation window to `[today, today+3)` so we can see tomorrow's departures.
- Row builder gains:
  - `DepartureTomorrow` (bool) — reservation with `departureDate = today+1`
  - `IsCheckoutRoom` = `CheckedOut || Departure || DepartureTomorrow` — used by the manual-upload pipeline as the authoritative "checkout room" flag.
- Clean status comes from the XML room roster's `cleanStatusId` using the existing map (`1/4/5→Untidy`, `2/3→Clean`). If Previo says clean, the app clears the dirty flag on next reconcile.

### 3) Remove the last vestiges of the `previo-test` hard-gate

- `PmsSyncControls` and `previo-pms-sync` already accept any hotel with a Previo config; audit the call sites to confirm no hard-coded `previo-test` remains in the refresh pipeline (checked; only comment references remain — remove them).

### 4) "Before you apply" change preview (new UI)

Before each refresh commits changes to `rooms` / room assignments, insert a `pms_change_events` batch describing the diff. Then surface it:

- New component `PmsRefreshPreviewDialog` opened by the existing "Sync from PMS" button.
- Two-step flow:
  1. **Dry run** — call `previo-pms-sync` with `dryRun: true`; render a table of changes grouped by room:
     - Status change (Clean → Untidy, etc.)
     - Occupancy change (Vacant → Occupied, Occupied → Checkout tomorrow…)
     - Reservation added / removed / date-shifted
     - Guest count change
     Each row shows `PMS value` vs `App value` with a colored chip, plus a per-change checkbox (default checked).
  2. **Apply selected** — call `previo-pms-sync` with the accepted change IDs; only those changes are written and the accepted batch is stamped `acknowledged_at = now()`.

- New tab in the same dialog: **History** — paginated list of prior refresh batches (timestamp, user, total/applied/skipped counts, expandable per-room diff). Uses existing `pms_change_events` + `pms_sync_history` tables.

- Visibility: admins, top_management, and the hotel's manager. Housekeeper/reception see a read-only summary badge only.

### 5) Safety

- `outbound_kill_switch` still blocks any write back to Previo (unchanged).
- Applied changes are transactional per room — a failure on one room does not roll back the whole batch, and the failure is stored on the change event for retry.
- All refreshes continue to log to `pms_sync_history` (`sync_type='pms_refresh'`) with counts of proposed vs applied vs skipped.

## Technical notes

- Files touched:
  - `supabase/functions/_shared/previoRooms.ts` (new) — XML rooms fetch + parse.
  - `supabase/functions/previo-pms-sync/index.ts` — use full roster, add `dryRun`, emit `pms_change_events`, extend window, add `DepartureTomorrow`/`IsCheckoutRoom`.
  - `supabase/functions/_shared/pmsDiff.ts` — extend diff to include clean status and checkout-tomorrow.
  - `src/components/pms/PmsRefreshPreviewDialog.tsx` (new).
  - `src/components/pms/PmsSyncControls.tsx` — wire the button to the new dialog instead of running sync immediately.
  - `src/components/pms/PmsChangesDrawer.tsx` — reuse existing drawer for the History tab.
- No schema changes required — `pms_change_events` already has `category`, `acknowledged_at`, `hotel_id`, and a JSON payload column. If the payload column is missing a field we need, we'll add a nullable column via a small migration.

## Validation

After deploy, on Ottofiori:
1. Click **Sync from PMS** → preview should list room 305 with proposed `IsCheckoutRoom=true (tomorrow)` and its actual Previo clean status.
2. Apply → the room card updates to "Checkout tomorrow" and the dirty/clean flag matches Previo.
3. Open **History** → see the batch you just applied with per-room detail.

## Out of scope

- Any write-back to Previo (kill-switch stays on).
- Rate/plan or breakfast changes (separate pipelines already exist).
