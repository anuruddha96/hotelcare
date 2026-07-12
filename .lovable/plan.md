## Problem

- Ottofiori's `pms_room_mappings` table is empty, so `previo-sync-rooms` (non-import branch) can't translate Previo's physical `roomId` (e.g. `2301497`) into an app `room_number` and emits *"No mapping for physical room …"* for every room.
- Previo names its rooms with a category prefix like `DB/TW-102`, `TRP-305`, `Q-101` (see the screenshot from Previo). HotelCare's `rooms.room_number` is just `102`, `305`, `101`. Even if the auto-import branch ran, it inserts `r.name` verbatim as `room_number`, which would never match the existing HotelCare rooms and would produce duplicates.
- "Team View → PMS Refresh" and "PMS Upload → Sync overview / Refresh rooms…" don't behave the same. Team View reports success with no changes because it only fetches the reservation snapshot; it never invokes `previo-sync-rooms` and never applies mappings.
- Ottofiori has `room_import_enabled = false`, so the import branch would 403 even if triggered. The gate was added to protect other hotels, but the mapping/discovery step is safe and must be always available.

## Fix

### 1. `previo-sync-rooms` — safer, auto-mapping import

- Add a helper `extractRoomNumber(name)` that pulls the trailing numeric token (`DB/TW-102` → `102`, `TRP-305` → `305`, `Q-101` → `101`, falls back to the raw name if none).
- Split the import branch into two phases so the second phase runs even when `room_import_enabled = false`:
  - **Phase A — Room upsert (unchanged gate):** only when `room_import_enabled = true`; upserts into `public.rooms` using the extracted number.
  - **Phase B — Mapping upsert (always allowed):** for every Previo room, look up an existing HotelCare row by extracted number; if found, upsert `pms_room_mappings` with `pms_room_id = physical roomId`, `pms_room_name = r.name`. Unmatched rows are reported back as `unmapped[]` for the admin UI, never as errors.
- The non-import branch keeps working, but the "No mapping" errors become rare because Phase B has already populated mappings.
- Return richer payload: `{ mapped, unmapped: [{ pms_room_id, pms_room_name, room_kind_name }], upserted }`.

### 2. `runPmsRefresh` (`src/lib/pmsRefresh.ts`)

- Always call `previo-sync-rooms` first (drop the `dryRun` gate for the mapping phase — mapping is read-safe). Ignore Phase A gate errors; surface Phase B `unmapped` in the returned result.
- Add `unmapped` to `PmsSyncResult` and forward it to the preview dialog.

### 3. Team View "PMS Refresh" parity

- Point the Team View "PMS Refresh" button to the same `runPmsRefresh(hotelId)` used by "Refresh rooms…" so it applies status/checkout changes instead of just snapshotting.
- Keep the existing daily-overview snapshot on a separate "Sync overview" button.

### 4. Admin mapping panel

New tab in **Admin → PMS Configuration → Previo** for each hotel:

- Table of Previo rooms fetched live via `previo-sync-rooms` with `previewOnly: true`, joined with current `pms_room_mappings`.
- Columns: Previo ID, Previo name, Room kind, Capacity, **HotelCare room** (Combobox of `rooms` for that hotel), status badge (Mapped / Unmapped / Manual override).
- Actions: inline save per row, "Auto-map by number" button (runs the same extractor server-side), "Clear mapping".
- Writes go straight to `pms_room_mappings` (upsert on `pms_config_id + pms_room_id`).
- Visible to admins / top_management only (existing `hasRole` guard).

### 5. Preview dialog

- Add an "Unmapped Previo rooms" section listing the returned `unmapped[]` with a "Open mapping panel" button so reception can hand off to an admin without leaving the screen.

## Files touched

- `supabase/functions/previo-sync-rooms/index.ts` — extractor + always-on Phase B.
- `src/lib/pmsRefresh.ts` — surface `unmapped`, always trigger sync-rooms.
- `src/components/pms/PmsRefreshPreviewDialog.tsx` — unmapped section.
- `src/components/pms/PmsSyncControls.tsx` — wire Team View "PMS Refresh".
- `src/components/dashboard/TeamManagement.tsx` (or wherever the Team View button lives) — same wire-up.
- `src/components/admin/PmsRoomMappingPanel.tsx` (new) + integration into `PMSConfigurationManagement.tsx`.

No database migration required — `pms_room_mappings` already has the shape we need.

## Verification

1. Run "Refresh rooms…" for Ottofiori → expect mappings populated automatically for all 21 rooms, sync applies status/checkout changes, no "No mapping" errors.
2. Admin panel shows the 21 Previo rooms all mapped; changing a mapping and re-running refresh updates the correct HotelCare room.
3. Team View "PMS Refresh" reflects the same room-status changes as "Refresh rooms…".