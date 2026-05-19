## Goal
Populate `daily_overview_snapshots` from Previo so the per-room daily breakdown (arrival, departure, guest name, pax, meals, HK stay/dep) is available for Previo hotels — not just XLSX uploads.

## Current state
- Table `daily_overview_snapshots` already exists with the XLSX shape (room_label, room_number, room_type_code, business_date, arrival_date, departure_date, status, guest_names, pax, breakfast, lunch, dinner, all_inclusive, housekeeping_stay, housekeeping_dep, source_filename, uploaded_by, captured_at, hotel_id, organization_slug).
- Only an admin/top_management SELECT policy exists. No INSERT policy → writes must come from a service-role edge function (which bypasses RLS).
- No `source` column and no uniqueness constraint, so re-syncs would duplicate rows.
- Manual flow: `revenue-overview-upload` parses XLSX and inserts.
- No Previo equivalent exists yet.

## Changes

### 1. Migration
- Add `source text not null default 'manual'` to `daily_overview_snapshots`.
- Add `unique (hotel_id, business_date, room_label, source)` so Previo upserts replace prior snapshots for the same room/day cleanly while leaving manual rows untouched.
- Add `idx_daily_overview_hotel_date` on `(hotel_id, business_date)` for calendar lookups.
- Keep existing SELECT policy. No new write policy — service role only.

### 2. New edge function: `previo-sync-daily-overview`
- Verify JWT in code, hard-gate by checking `pms_configurations.pms_type = 'previo'` for the requested `hotelId`. Refuse otherwise. Mirrors the gating used by `previo-pull-revenue`.
- Inputs: `{ hotelId, organizationSlug, fromDate?, toDate? }`. Defaults: today → today+90.
- Calls (Previo XML, allowed methods only):
  - `Hotel.searchReservations` over the window to get reservation IDs that intersect each night.
  - `Hotel.reservation` (batched) to pull guest name, pax, arrival, departure, room assignment, status.
  - `Hotel.getStayPackages` / `Hotel.getMeals` to derive per-day breakfast/lunch/dinner/all-inclusive counts.
- Expands each reservation into one row per occupied business_date in `[arrival, departure)`.
- Maps room → `room_label`, `room_number`, `room_type_code`, `room_suffix` via existing `parseRoomCode` shared helper.
- Upserts into `daily_overview_snapshots` with `source='previo'`, `source_filename=null`, `uploaded_by=null`, `captured_at=now()`.
- For each business_date touched, deletes any stale `source='previo'` rows in that hotel+date range not present in this run (so cancellations disappear).
- Logs a row in `revenue_sync_history` with `source='previo-daily-overview'`, counts, and any error.

### 3. Wire into Revenue UI
- In `src/pages/Revenue.tsx`, extend the existing per-hotel **Sync** handler so for Previo hotels it invokes both `previo-pull-revenue` and `previo-sync-daily-overview` in parallel, then toasts a combined result.
- No new tab — daily overview rows are already consumed by the Calendar (no changes there needed for storage; rendering improvements are tracked separately).

### 4. Nightly job
- Extend `revenue-engine-tick` (already cron-driven) to iterate Previo hotels and call `previo-sync-daily-overview` for each, so historical rows accumulate for YoY/MoM.

## Files
- `supabase/migrations/<new>.sql` — add `source` col, unique index, lookup index.
- `supabase/functions/previo-sync-daily-overview/index.ts` — new.
- `supabase/functions/revenue-engine-tick/index.ts` — add fan-out call.
- `src/pages/Revenue.tsx` — extend Sync handler.

## Out of scope
- Calendar UI changes to render the new daily overview fields (separate slice).
- Retention/cleanup cron (separate slice).
- Backfill of historical Previo data beyond the sync window (can be triggered manually by passing `fromDate`).

## Non-Previo hotels
Ottofiori, Memories, Mika, Gozsdu remain on XLSX upload — the function refuses any hotel without a `pms_configurations` row of type `previo`.