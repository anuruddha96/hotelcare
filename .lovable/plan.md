## 1. Fix Previo XLSX upload error

**Symptom**: "Edge Function returned a non-2xx status code" on both `pickup_report-3.xlsx` and `daily_overview - Hotelcare.app - 4. 5. - 5. 5..xlsx`. Logs show *"No date columns parsed. First sheet preview: undefined"* — the parser fails to find the date row, then the function returns 400.

**Fix in `supabase/functions/revenue-pickup-upload/index.ts`**:
- Read sheet with `sheet_to_json(ws, { header: 1, blankrows: false, defval: null, raw: false })` and also pass `cellDates: true` to `XLSX.read` so dates become JS `Date` objects we can recognize directly.
- Extend `tryParseDate` to accept `Date` instances and Hungarian/EU short forms used by Previo (e.g. `"2026.05.04."`, `"2026.05.04"`, `"05.04.2026"`, `"4. 5."`, `"4.5.2026"`).
- Scan the first **40** rows (not 25) and also detect dates that are spread across multiple header rows (Previo `daily_overview` puts the date span in row 1 and per-day columns in row 4–6). When a date row has only 1–2 hits, still keep scanning further.
- When no dates are found, ALSO try a "long format" parser: look for any column whose header text matches `date|dátum|stay|datum` and treat each subsequent row as one stay date with sibling numeric columns (`bookings`, `last year`, `delta`, `pickup`).
- Return `200` with `{ ok: false, error, debug }` instead of `400` so the frontend can show a friendlier message (the current `non-2xx` wrapper from `supabase-js` hides the real error).
- Log the first 8 rows of every sheet attempted so we can iterate if a new format appears.

**Frontend (`src/pages/Revenue.tsx`)**: when the response body has `error`, show that message in the per-file row instead of the generic `Edge Function returned a non-2xx status code`.

## 2. Redesign the Revenue page UI

**`src/pages/Revenue.tsx`** — keep upload + hotel cards, but:
- Add a top **summary strip**: total upcoming bookings, week-over-week pickup, # abnormal alerts, # pending recommendations, last-upload age (red if > 7 days).
- Replace the tiny sparkline on each hotel card with a labeled mini area-chart (next 30 days pickup) and a "Next abnormal date" pill.
- Move "Upload Previo pickup XLSX" into a collapsible accordion (closed by default) so it stops dominating the page.
- Add a **drag-and-drop** zone with file-type validation and per-file progress bar.

**`src/pages/RevenueHotelDetail.tsx` → Pickup tab redesign** (the part the user is complaining about — "specific dates where pickup shows" + "guest info"):
- Replace single chart with three stacked sections:
  1. **Pickup heatmap** — 90-day calendar where each cell is colored by pickup Δ (green = positive, red = negative, dark red = abnormal). Click a cell to open the existing day-detail sheet.
  2. **Top pickup dates table** — sortable list of dates with the highest absolute pickup Δ in the next 60 days. Columns: Date, Day-of-week, Bookings now, Bookings LY, Δ, Rate, Occupancy, Events. Each row has an "Open" button.
  3. **Pickup vs. Last Year** — combined bar (pickup) + line (LY baseline) chart, plus a 7-day moving-average overlay.
- Add a **Guests on this date** card to the day-detail Sheet: queries `reservations` joined with `guests` filtered by `hotel_id` and `stay_date BETWEEN check_in AND check_out`. Shows guest names, room, pax, breakfast count, source (Previo / manual). Restricted to admin/top_management (existing role gate already covers this page).
- Add a "Download CSV" button per view that exports the visible date range.

## 3. Breakfast Verification — remove hotel code field

The hotel code today doubles as the per-hotel auth secret. Removing the field but keeping the lookup public would let anyone enumerate any hotel's guest data — not acceptable.

**Change**: turn `/bb` into a per-hotel public URL **`/bb/:hotelCode`** (the code stays in the URL / QR code, not in the form):
- Add route `/bb/:hotelCode` in `src/App.tsx` (keep `/bb` as a small landing page that says "Scan your hotel QR to continue").
- `src/pages/Breakfast.tsx`: read `hotelCode` from `useParams`, drop the "Hotel code" `<Input>`, send it implicitly to `breakfast-lookup`. Form now only asks for **Room number** and **Date** (defaults to today).
- `breakfast-lookup` edge function: unchanged — still validates the code server-side, so security is preserved.
- Add an admin-only "Print QR" button in `BreakfastCodeManagement` that generates a printable QR pointing at `https://my.hotelcare.app/bb/<code>`. Hotels stick the QR at breakfast — staff scan once and bookmark. Guests/staff never type the code.

If the user wants the code completely removed (no per-hotel URL), the only safe alternative is requiring staff login on /bb — confirm with them before going that route.

## Technical notes

- No new tables. Reuses `pickup_snapshots`, `rate_recommendations`, `revenue_alerts`, `reservations`, `guests`, `breakfast_roster`, `hotel_breakfast_codes`.
- New edge-function deploys: `revenue-pickup-upload` only (parser fix). `breakfast-lookup` stays the same.
- Files touched: `supabase/functions/revenue-pickup-upload/index.ts`, `src/pages/Revenue.tsx`, `src/pages/RevenueHotelDetail.tsx`, `src/pages/Breakfast.tsx`, `src/App.tsx`, `src/components/admin/BreakfastCodeManagement.tsx`.
- Adds one tiny dep: `qrcode.react` for the printable QR.
- No impact on the manual OttoFiori flow (no Previo writes, no PMS calls touched).
