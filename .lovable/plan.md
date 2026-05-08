
# Previo API integration (Phase 2) — scoped to **previo-test** hotel only

Hard rule for every change below: **OttoFiori and all other live hotels must keep working exactly as today.** Every new code path is gated either by `pms_configurations.connection_mode = 'manual'` AND `hotel_id = 'previo-test'`, or by a feature flag column we add on the PMS config row. OttoFiori's row stays untouched, so none of the new paths fire for it.

---

## 1. Admin can switch organization (not just hotel)

**Issue:** `OrganizationSwitcher` already exists but hides itself when `organizations.length <= 1` and only renders for `admin` / `is_super_admin`. The hotel picker (`HotelSelectionScreen`) on first login also only lists hotels in the current org, so an admin landing in one org cannot reach a hotel in another org without manually changing the URL.

**Changes (UI only):**
- `HotelSelectionScreen.tsx` — for `admin` / `is_super_admin`, add an Organization dropdown above the hotel list. Selecting an org updates `profile.organization_slug`, clears `assigned_hotel`, navigates to `/{slug}`, and re-fetches hotels.
- `OrganizationSwitcher.tsx` — drop the `organizations.length <= 1` gate for admins so it always renders for them in the header.
- No DB or backend changes.

---

## 2. One-click PMS Upload via API (previo-test only)

**Today:** `PMSUpload.tsx` parses an Excel file (`buildColumnMap`, dozens of columns) and writes daily cleaning + checkout rooms.

**New behavior — only when `selectedHotel === 'previo-test'`:**
- Replace the dropzone with a single **"Sync from Previo API"** button. The Excel dropzone stays untouched for every other hotel (OttoFiori included).
- Button calls a new edge function **`previo-pms-sync`** that returns the same shape today's Excel parser produces (`{ checkoutRooms, dailyCleaningRooms, results }`), so the rest of the page (CheckoutRoomsView, assignment lists, history) keeps working unchanged.

**`previo-pms-sync` edge function (new):**
1. Auth: require Bearer token, look up profile, must be admin/manager assigned to the hotel.
2. Load PMS config for `hotel_id = 'previo-test'`, resolve credentials via `credentials_secret_name` (existing pattern).
3. Pull from Previo REST API the data the Excel file contained today:
   - `GET /rest/rooms` → room list + current `roomCleanStatusId` + linked `reservation` block (arrival/departure/status)
   - `Hotel.searchReservations` (XML) for today ±1 day → guest count (`people`), nationality, notes, total nights — fields not in `/rest/rooms`
   - `Hotel.getGuest` only when a reservation needs guest details
4. Project the merged result into the same row shape `processFile` builds (`Room`, `Occupied`, `Departure`, `Arrival`, `People`, `NightTotal`, `Note`, `Nationality`, `Defect`, `Status`).
5. Reuse the existing server-side write path: insert into `pms_uploads`, replace today's `daily_cleaning_assignments` for hotel `previo-test`, populate `checkout_rooms`. The shared writer is currently inline in `PMSUpload.tsx`; we will extract it into a small helper that both the manual Excel path and the new API path call. Helper is pure, no schema change.
6. Return the same `{ inserted, updated, skipped, checkoutRooms, dailyCleaningRooms }` payload.

**Verification we'll run before considering it done:**
- Side-by-side: upload today's Excel for `previo-test` AND run API sync; row counts and per-room fields must match. If anything differs, fix the mapping until they match 100%.
- Run with `selectedHotel = 'ottofiori'` and confirm the new function refuses (`hotel_id != 'previo-test'` guard) and that the Excel upload still works untouched.

---

## 3. Push room cleanliness back to Previo on supervisor approval

**Today:** `SupervisorApprovalView.tsx` already calls `previo-update-room-status` after approval. We just need to make it correct + safe for `previo-test`.

**Changes:**
- `previo-update-room-status` — switch to the correct Previo REST endpoint. Per Previo docs, room cleanliness uses `PUT /rest/rooms/{roomId}/clean-status` (not `/housekeeping/room-status`, which 404s today). Use the mapped `pms_room_id` from `pms_room_mappings`, not `room_number`.
- Map approved → Previo `clean`. Add a guard: function is a no-op (returns 200 with `skipped: true`) unless the hotel's PMS config has `connection_mode = 'manual'` AND `hotel_id = 'previo-test'`. This protects OttoFiori, which has the function wired but should keep its current behavior.
- Log every call to `pms_sync_history` (already does).

**Verification:** Approve a room on previo-test → confirm Previo PMS UI shows it as Clean and `pms_sync_history` row is `success`. Approve a room on OttoFiori → confirm `skipped: true` and Previo state unchanged.

---

## 4. Auto-mark checkout rooms as ready-to-clean (Previo → HotelCare)

Previo doesn't push webhooks for our test account, so we **poll** instead of relying on a webhook.

**New edge function `previo-poll-checkouts`:**
- Scheduled? No — for now, triggered (a) automatically right after `previo-pms-sync` finishes, and (b) by a small "Refresh checkouts" button on the PMS Upload screen for `previo-test`.
- Calls `GET /rest/rooms`, filters rooms whose reservation `status` indicates the guest has departed (Previo's "checked out" state) and whose local `rooms.status` is still `occupied` / `dirty`.
- For each, updates local `rooms.status = 'dirty'` (ready to clean) and inserts a row into `daily_cleaning_assignments` for today if not already there.
- Hard-scoped to `hotel_id = 'previo-test'`. OttoFiori is never touched.

This removes the manual "mark as ready to clean" step today's managers do.

---

## 5. Rooms tab → "Import rooms from Previo"

**Changes (previo-test only):**
- In `Rooms` page header (admin-visible), add a button **"Import from Previo"** next to "Add Room" / "Bulk Add Rooms". Button is only rendered when current hotel = `previo-test`.
- Clicking it calls existing `previo-sync-rooms` (already implemented) but extends it to also upsert into the `rooms` table:
  - `room_number` ← Previo `name`
  - `room_type` ← Previo `roomKindName`
  - `capacity` ← Previo `capacity` + `extraCapacity`
  - Special features (e.g. `isHourlyBased`) → stored in a new nullable `pms_metadata jsonb` column on `rooms` (migration). Existing rows keep `pms_metadata = null`, no behavioral impact.
- Also auto-populates `pms_room_mappings` so step 3 finds the mapping without any manual data entry.

---

## 6. What else gets automated for previo-test (no extra UI work)

Triggered automatically as side effects of the buttons above:
- Reservation refresh (today ± 7 days) — runs as part of `previo-pms-sync` so reception sees up-to-date arrivals/departures without a separate sync.
- Guest details — pulled lazily via `Hotel.getGuest` only when reception opens a reservation that's missing them; cached locally.
- Note / nationality / pax count — pulled in step 2 above so they stop being a manual data entry chore.

Not in scope yet (will follow once the above is verified): rate push, occupancy/pickup ingestion for Revenue. Those are a Phase 3 ticket.

---

## Technical details

**New / modified files**

- `src/components/dashboard/HotelSelectionScreen.tsx` — admin org dropdown.
- `src/components/layout/OrganizationSwitcher.tsx` — drop `length <= 1` gate for admins.
- `src/components/dashboard/PMSUpload.tsx` — branch on `selectedHotel === 'previo-test'`; render API sync button + "Refresh checkouts" instead of dropzone. Extract row-write logic into a helper used by both flows.
- `src/components/dashboard/Rooms.tsx` (or wherever Add Room lives) — "Import from Previo" button gated to `previo-test`.
- `supabase/functions/previo-pms-sync/index.ts` — **new**.
- `supabase/functions/previo-poll-checkouts/index.ts` — **new**.
- `supabase/functions/previo-sync-rooms/index.ts` — extend to upsert local `rooms` + mappings.
- `supabase/functions/previo-update-room-status/index.ts` — fix endpoint, use `pms_room_id`, gate to `previo-test`.

**Migration**

- `ALTER TABLE rooms ADD COLUMN pms_metadata jsonb;` (nullable, no default change).
- No other schema changes. No RLS changes; new function endpoints reuse existing `pms_configurations` / `rooms` / `daily_cleaning_assignments` policies.

**Safety guards summarized**

- New API sync UI only renders when `selectedHotel = 'previo-test'`. Excel dropzone unchanged for every other hotel.
- All four new/modified edge functions early-return when called for any hotel other than `previo-test`, except `previo-update-room-status` which keeps existing behavior for OttoFiori (no-op + skipped log) and only writes to Previo for `previo-test`.
- No changes to OttoFiori's PMS config row, room mappings, or scheduled sync settings.

**Verification checklist before delivering**

1. Excel upload for OttoFiori still works and creates today's assignments correctly.
2. `previo-test` API sync produces row counts identical to the Excel export for the same day.
3. Approving a `previo-test` room flips it to Clean in Previo within seconds; OttoFiori approvals do not call Previo.
4. Checking a guest out in Previo for `previo-test` results in the room appearing in HotelCare's "ready to clean" list within one poll cycle.
5. "Import from Previo" populates `previo-test` rooms + mappings; OttoFiori rooms unaffected.

