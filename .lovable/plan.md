## Problem

The Previo `pickup_report.xlsx` files use a 2-row date header:

```
Row 3:  [May 2026 ........spanned........] [Jun 2026 ........spanned........] ...
Row 4:  5 Tue | 6 Wed | 7 Thu | 8 Fri | ... | 1 Mon | 2 Tue | ...
Row 5:    0   |   1   |   3   |   2   | ... |   1   |   2   | ...   (pickup deltas)
```

When XLSX is read with `header:1`, merged month cells leave the trailing columns as `null`, and the day cells look like `"5 Tue"` — neither matches the current `tryParseDate`. Result: "Could not find date columns" error.

The hotel name (`"Pickup for Hotel Ottofiori"`) is correctly in row 1 and already in the lookup table — that part works.

## Fix 1 — Parser: handle the Previo wide format

In `supabase/functions/revenue-pickup-upload/index.ts`, add a new `parsePrevioWide` that runs before the generic `parseWide`:

1. Find a **month-header row** in the first ~10 rows: a row where ≥3 cells match `/^([A-Za-zÁÉÍÓÖŐÚÜŰáéíóöőúüű]{3,})\.?\s+(\d{4})$/` (e.g. `"May 2026"`, `"máj. 2026"`). Record `{col, year, month}` per match.
2. **Forward-fill** the month across the columns until the next month appears (handles XLSX merged cells producing nulls).
3. Find a **day row** in the next 1–3 rows where most cells match `/^(\d{1,2})(\s+[A-Za-z]{2,3})?$/` (`"5"`, `"5 Tue"`, `"5 Mon"`). For each such cell, build the date from `(year, month, day)` of that column's filled-down month.
4. Find the **first numeric row** below the day row; treat each filled column as a single `delta` value (Previo only ships one pickup number per date, no LY/current split). Map → `bookings_current = max(0, delta)`, `bookings_last_year = 0`, `delta = delta`.
5. Skip the trailing `Total` column (last column with header `"Total"`).

If `parsePrevioWide` returns ≥7 dates, prefer it over the existing wide/long parsers.

Keep all other parsers as fallback for non-Previo formats.

## Fix 2 — UI: per-hotel upload

In `src/pages/Revenue.tsx`, replace the single global upload accordion with **per-hotel upload right inside each hotel card**:

- Each hotel card in the grid gets a small "Upload pickup XLSX" button that opens a compact dialog scoped to that hotel.
- The dialog accepts one or many files and always sends `hotel_id` = that card's hotel (no auto-detect needed, no dropdown to mis-set).
- Keep the bulk "Upload (auto-detect)" option in a smaller secondary accordion for power users who want to drop a folder of mixed files.
- Status (queued / uploading / ✓ rows / ✗ error) shows inline under the card.
- Same dialog supports the **Pickup / Occupancy** toggle.

This makes it obvious which hotel a file belongs to and prevents the "wrong hotel detected" class of bugs.

## Fix 3 — Better error surfacing

When the edge function returns `{ ok:false, error, debug }`, show the first `warnings[0]` and a "Show file preview" expandable in the per-card status row so the user can see what the parser saw.

## Files to change

- `supabase/functions/revenue-pickup-upload/index.ts` — add `parsePrevioWide`, wire it in before the existing parsers.
- `src/pages/Revenue.tsx` — refactor upload UI to per-hotel cards + compact dialog; keep bulk uploader collapsed.

No DB migration needed. No new edge function needed. Append-only history is preserved (every upload still inserts a fresh row per `stay_date` with `captured_at = now()`).

## Verification

After deploy, re-upload `pickup_report-5.xlsx` (Ottofiori) and `pickup_report-4.xlsx` from each hotel card and confirm: rows ≈ 240, hotel correctly recorded, dates spanning May→Dec 2026 visible in the hotel detail heatmap.
