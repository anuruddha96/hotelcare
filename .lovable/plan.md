
## Goal

1. Fix the pickup XLSX parser so it accepts the Previo file shape the user is uploading.
2. Add Previo **occupancy** upload (same file family they shared).
3. Make the Events tab show real upcoming Budapest demand-driving events via Lovable AI.
4. Keep **all historical snapshots** forever so trends can be analysed.

---

## 1. Fix the pickup parser

The uploaded Previo file (`Hotel_occupancy_in_dates_…xlsx`) uses this shape:

```
Row 1: "Hotel occupancy in dates May 4, 2026 - Dec 31, 2026"
Row 2: "time axis: day ; reservation status: …"
Row 4: Term | <range> (%) | <range> (pcs)
Row 5: "Mon, May 4, 2026" | 100 | 21
Row 6: "Tue, May 5, 2026" | 95.2 | 20
…
```

Pickup XLSX from Previo follows the **same long format** — one date per row with weekday prefix. Current parser only recognises `"Apr 30"`, `"4. 5."`, `"YYYY-MM-DD"`, etc. and rejects `"Mon, May 4, 2026"`, so it falls through.

Changes in `supabase/functions/revenue-pickup-upload/index.ts`:

- Extend `tryParseDate` to strip a leading weekday + comma (`"Mon, May 4, 2026"` → `"May 4, 2026"`), then reuse the existing `Mon DD, YYYY` branch.
- Recognise header label `Term` (and Hungarian `Időszak`) as the date column in `parseLong`.
- Auto-pick the `(pcs)` numeric column as `bookings_current` when the header has `(pcs)` / `(db)`; ignore the `(%)` column.
- Hotel auto-detect already scans first 8 rows + sheet name; this file has no hotel name, so the user picks it from the dropdown (already supported).

No DB schema change for pickup.

---

## 2. Occupancy upload (new)

### New table — `occupancy_snapshots` (history-preserving, append-only)

```
id uuid pk
hotel_id text
organization_slug text
stay_date date
occupancy_pct numeric
rooms_sold int
captured_at timestamptz default now()
snapshot_label text         -- file name
uploaded_by uuid
source text                 -- 'xlsx_upload' | 'previo_api'
```

- No unique constraint on `(hotel_id, stay_date)` → every upload becomes a new snapshot, so you can chart how occupancy evolved over time for the same stay date.
- RLS: same pattern as `pickup_snapshots` (admin/top_management read; insert via service role from edge function).
- Index `(hotel_id, stay_date, captured_at desc)`.

### New edge function — `revenue-occupancy-upload`

Same scaffolding as the pickup upload. Parses the Previo "Term / (%) / (pcs)" long format and inserts one row per stay date. Auto-runs `revenue-engine-tick` afterwards.

### UI

- `Revenue.tsx`: in the existing collapsible upload accordion, add a second tab "Occupancy" with its own file picker that posts to `revenue-occupancy-upload`. Keep the pickup tab unchanged.
- `RevenueHotelDetail.tsx`: enrich the existing **Occupancy** tab with:
  - Latest occupancy curve (most recent `captured_at` per `stay_date`).
  - Pickup-style heatmap (90-day calendar) coloured by occupancy %.
  - "How occupancy moved over time" line chart for the selected day (all historical snapshots for that stay_date).
  - Mini summary: avg occupancy next 30/60/90 days, weekend vs weekday.

---

## 3. AI-powered Budapest events

### New table — `market_events`

```
id uuid pk
city text                       -- 'budapest'
event_date date
end_date date
title text
category text                   -- 'concert','festival','sport','conference','holiday','other'
venue text
expected_impact text            -- 'low' | 'medium' | 'high'
url text
source text                     -- 'ai_suggested' | 'manual'
confidence numeric
created_at timestamptz default now()
unique (city, event_date, title)
```

RLS: admin/top_management read, edge function inserts via service role.

### New edge function — `revenue-events-fetch`

- Calls Lovable AI (`google/gemini-3-flash-preview`) with structured output (tool call `list_events`) asking for upcoming demand-driving events in Budapest for the next 180 days: concerts, festivals, conferences, sport, public holidays, school breaks. Each event returns `{date, end_date, title, category, venue, impact, url, confidence}`.
- Upserts into `market_events` (`onConflict: city,event_date,title`).
- Idempotent — safe to re-run; the unique constraint dedupes.
- Returns `{added, total}`.

### Events tab UI changes (`RevenueHotelDetail.tsx`)

- Two sections inside the Events tab:
  1. **Hotel events** — existing manual `hotel_events` table (unchanged).
  2. **Budapest market events** — pulled from `market_events`, read-only list with filters (date range, category, impact). "Refresh from AI" button (admin only) calls `revenue-events-fetch`. Each row has an "Add to my hotel" action that copies the event into `hotel_events` for that hotel.
- Calendar/year view dot already shows a purple ring for events; extend it so market events with `impact='high'` get a brighter ring.
- Pricing engine input: include `market_events` (high/medium impact) when computing suggested deltas in `revenue-engine-tick` so suggestions react to demand surges.

---

## 4. Historical data guarantee

- `pickup_snapshots` and the new `occupancy_snapshots` are append-only — no `DELETE` paths, no `UPSERT`. Every upload keeps its own `captured_at`, so the user can later replay "what did we know on date X".
- Add a small DB note in `IMPLEMENTATION_SUMMARY.md` documenting the retention policy.
- Add `revenue-export` support for `kind: "occupancy_history"` and `kind: "events"`.

---

## Files

**New**
- `supabase/migrations/<ts>_occupancy_and_events.sql` — `occupancy_snapshots`, `market_events`, RLS, indexes.
- `supabase/functions/revenue-occupancy-upload/index.ts`
- `supabase/functions/revenue-events-fetch/index.ts`

**Edited**
- `supabase/functions/revenue-pickup-upload/index.ts` — weekday prefix + `Term` / `(pcs)` support.
- `supabase/functions/revenue-engine-tick/index.ts` — read `market_events` + latest `occupancy_snapshots` into the scoring.
- `supabase/functions/revenue-export/index.ts` — new export kinds.
- `src/pages/Revenue.tsx` — second upload tab.
- `src/pages/RevenueHotelDetail.tsx` — Occupancy tab visuals + Events "market events" panel + "Refresh from AI" button.
- `src/integrations/supabase/types.ts` — regenerated types.
- `supabase/config.toml` — register the two new functions (`verify_jwt = true` for upload, `verify_jwt = true` for events fetch).

No change to manual workflows used by Hotel Ottofiori — all additions are scoped to the Revenue module which is admin/top_management only.
