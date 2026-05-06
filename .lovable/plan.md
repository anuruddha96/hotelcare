## Goal
1. Per-hotel **Daily Overview** XLSX upload (in addition to Pickup and Occupancy), processed and stored so the app understands stays, arrivals, departures, meal counts and housekeeping status.
2. **Drag-and-drop** file selection in every hotel's upload dialog.
3. **Hotel name verification** on every upload — if the uploaded file's embedded hotel name (e.g. "Pickup for Hotel Ottofiori", "Daily overview – Hotel Memories Budapest") does not match the hotel the user picked, the upload is rejected with a clear error before any rows are written.

## What I found in the sample files
- **`pickup_report-6.xlsx`** — cell A1 = `Pickup for Hotel Ottofiori`, A3 = month, row 4 = day headers (`6 Wed`, `7 Thu`…), row 5 = pickup deltas. Already parseable; just needs hotel-name guard.
- **`daily_overview_-_Hotelcare.app_-_6._5._-_7._5.-2.xlsx`** — sheet named by date `2026-05-06`. Row 2 headers: `Date (arrival)`, `Room`, `Departure`, `Arrival`, `Ongoing`, `Date (departure)`, `Bre`, `Lun`, `Din`, `All`, `Sta`, `Dep`. One row per occupied room with guest names + meal counts. Second sheet "Meals summary" with daily totals. Hotel name is not in the cell content, so we rely on file properties + filename token + the selected hotel from the dialog.

## Plan

### 1. New DB table — `daily_overview_snapshots`
Migration adds:
```
daily_overview_snapshots(
  id uuid pk, hotel_id text, organization_slug text,
  business_date date,                -- date the report is for
  room_label text,                   -- e.g. "DB/TW-102"
  arrival_date date, departure_date date,
  status text,                       -- ongoing | arriving | departing
  guest_names text,
  pax int,
  breakfast int, lunch int, dinner int, all_inclusive int,
  housekeeping_stay text,            -- "X (1/4)"
  housekeeping_dep text,             -- "X"
  source_filename text, uploaded_by uuid,
  captured_at timestamptz default now()
)
```
Plus `daily_overview_meal_totals(hotel_id, business_date, breakfast, lunch, dinner, all_inclusive, adults, children, captured_at)` for the "Meals summary" sheet.

RLS: same pattern as `pickup_snapshots` — admin/top_management of the org can read/write; service role inserts. Indexes on `(hotel_id, business_date)`.

### 2. New edge function — `revenue-overview-upload`
- Auth/role gate identical to `revenue-pickup-upload`.
- `formData`: `file`, `hotel_id` (required from dialog).
- Parse with `xlsx`:
  - Detect `business_date` from sheet name (`YYYY-MM-DD`) or from "Meals summary" first data row.
  - Iterate the per-room sheet starting at the row after the `Date (arrival)` header. Map each row → one `daily_overview_snapshots` insert. Derive `pax` from the leading `(N)` in the guest cell. Set `status`:
    - `arriving` if Arrival col non-empty,
    - `departing` if Departure col non-empty,
    - `ongoing` otherwise.
  - Parse "Meals summary" sheet → one `daily_overview_meal_totals` row.
- **Hotel name verification** (shared helper, see §4): read workbook props + sheet titles + A1 of every sheet + the original `file.name`; if any of those reveal a hotel name and it ≠ selected `hotel_id`, return `{ ok:false, error: "File appears to be for <X>, but you selected <Y>." }` and insert nothing.
- Returns `{ ok:true, rows, meals_rows, business_date, hotel_id }`.

Register in `supabase/config.toml`.

### 3. Hotel-name verification in existing functions
Add the shared verification step to **`revenue-pickup-upload`** and **`revenue-occupancy-upload`** before any DB insert. Existing `HOTEL_NAME_TO_ID` map is reused. If verification fails when the user explicitly chose a hotel in the dialog, reject. (When called without an explicit hotel and a name is detected, proceed as today.)

### 4. Frontend — drag-and-drop + new tab in HotelUploadDialog
Edit `src/pages/Revenue.tsx` `HotelUploadDialog`:
- Replace the plain `<Input type="file">` with a drag-and-drop dropzone using the existing `react-dropzone` setup (already used in `src/components/dashboard/FileUpload.tsx`). Accept `.xlsx`, multi-file, click-to-browse fallback, visual highlight on drag-over, file chips with remove buttons.
- Add a third tab: **Pickup | Occupancy | Daily Overview**. Each tab points to its edge function (`revenue-pickup-upload`, `revenue-occupancy-upload`, `revenue-overview-upload`) and shows a one-line description of what that file is.
- Keep existing per-job status list (queued/uploading/ok/err) and surface the new "wrong hotel" error verbatim from the function.
- Remove the now-redundant global "Upload Previo XLSX" `<details>` block at the top of the page (uploads are per-hotel only, as previously requested).

### 5. Surface daily overview data on the hotel detail page
Light addition to `src/pages/RevenueHotelDetail.tsx`: a new "Daily Overview" card showing the latest `business_date` summary — arrivals / departures / in-house / breakfast count — pulled from `daily_overview_snapshots` + `daily_overview_meal_totals`. No design overhaul; just a read-only KPI strip and a small table of today's rooms.

## Files
- **New migration**: `daily_overview_snapshots`, `daily_overview_meal_totals` + RLS + indexes.
- **New edge function**: `supabase/functions/revenue-overview-upload/index.ts`.
- **Edited**: `supabase/functions/revenue-pickup-upload/index.ts`, `supabase/functions/revenue-occupancy-upload/index.ts` (shared `verifyHotel` helper inlined in each).
- **Edited**: `supabase/config.toml`.
- **Edited**: `src/pages/Revenue.tsx` (drag-drop dropzone, 3-way tabs, remove global upload block), `src/pages/RevenueHotelDetail.tsx` (daily overview card), `src/integrations/supabase/types.ts` (regenerated).

## Out of scope
- No changes to AI analyst, events feed, or pricing engine — they can consume the new tables in a follow-up if you want richer signals from the daily overview.
