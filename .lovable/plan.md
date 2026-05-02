## Goal

Make Revenue Management precise and decision-ready. The current upload returns a non-2xx and all revenue tables are empty (0 snapshots, 0 recs, 0 alerts), so today the dashboard shows nothing. We will fix ingestion first, then upgrade the analytics, AI explanations, alerts/exports/approvals, and finish verifying the breakfast feature end-to-end.

---

## Part 0 — Fix the upload (root cause of the empty dashboard)

The current `revenue-pickup-upload` parser assumes a fixed Previo layout (title in row 0, dates in row 2, values in row 4, columns grouped in 3s `[YYYY, YYYY-1, Change]`). The user's `pickup_report-2.xlsx` is a different shape and the function throws "Could not detect hotel" or "No date columns parsed".

Rewrite the parser to be robust:
- Scan the first 15 rows for the title row and the date-header row (heuristic: row containing 5+ tokens that match `dd. MMM` or `YYYY-MM-DD`).
- Auto-detect column groupings (1, 2, or 3 columns per date) from the year row.
- If hotel is not detected, accept the manual hotel override (already passed from UI) without throwing.
- Return a structured response: `{ hotel_id, parsed_dates, rows_inserted, skipped_rows, warnings[] }` so the UI can show what happened.
- Add server-side logging of the first 5 rows when parsing fails so we can debug from edge function logs.

UI: surface warnings in a toast + dropdown details panel after upload.

## Part 1 — Multi-file uploads per hotel, precise numbers

- `Revenue.tsx` upload card: accept `multiple` files, queue them, upload sequentially, show per-file status (✓ rows / ✗ error). Allow uploading several days/snapshots at once for the same or different hotels.
- New `pickup_snapshots.snapshot_label` (text, optional) to record source filename for traceability.
- Engine math precision fix: `delta` already integer; switch all `Number(...)` casts to explicit `parseInt`/`parseFloat` with `Number.isFinite` guards so empty/blank cells become 0 only when intended (otherwise null), avoiding fake "0 pickup" rows triggering false decreases.

## Part 2 — Pickup-Date Explorer (new tab on hotel detail)

New tab "Explorer" on `RevenueHotelDetail.tsx` and a global one on `Revenue.tsx`:
- Filters: hotel (multi), date range, day-of-week, weekend-only toggle, "show only abnormal", "show only price-change candidates".
- Table: stay_date, DOW, snapshots count, latest bookings, pickup last 24h / 7d / since-upload, vs LY, current rate.
- Two charts (Recharts):
  1. **Stacked area** of daily total bookings per stay_date over the last 30 capture timestamps (shows pickup pace per date).
  2. **Bar chart** of pickup Δ per stay_date for the selected range (sortable by date / Δ).
- "Run AI on this filtered set" button → calls `revenue-ai-analyze` with the filtered date list.

## Part 3 — Per-tier driver breakdown in AI panel

Today the AI panel only shows free-text reasons. Make every suggestion show the exact engine inputs:

For each suggestion (increase or decrease) display a row with chips:
- `Pickup since last snapshot: +N` 
- `Tier matched: 4–5 → +€17`
- `Current PMS rate: €X` → `Suggested: €Y` (`Δ €Z`)
- `Floor: €F`, `Max daily change: €M` (and a red badge if either guard would clip it)
- `vs LY: ±N`
- `Days out: D`, `DOW: Sat ★` if weekend
- `Confidence: high/medium/low` (from AI)
- Source line: "AI reason: ..." (the model's free-text reason)

Update the `revenue-ai-analyze` edge function so the structured tool schema also requires:
```
drivers: { pickup_in_window:int, tier_label:string, tier_delta_eur:number,
           current_rate_eur:number, floor_eur:number, max_change_eur:number,
           vs_ly:int|null, days_out:int, dow:string, weekend:boolean }
```
We compute these deterministically server-side and pass them in the user message so the AI only labels confidence/reason, while we render the precise numbers from our own computation (not the model). This guarantees numeric accuracy.

## Part 4 — Approval step + audit log

New table `rate_change_audit`:
```
id, hotel_id, organization_slug, stay_date,
action ('approve' | 'override' | 'dismiss' | 'bulk_apply' | 'ai_apply' | 'engine_create'),
old_rate_eur, new_rate_eur, delta_eur,
recommendation_id (fk nullable), source ('engine'|'ai'|'manual'),
performed_by uuid, performed_at, notes
```
RLS: read for admin + top_management of same org; insert via security-definer fn `log_rate_audit(...)`.

Approval flow changes:
- Approving a recommendation now opens a small confirm dialog showing before/after rate, delta, reason, drivers, and a required free-text "approval note" (optional but encouraged).
- Server-side: every change in `rate_recommendations` and every insert into `rate_history` writes a corresponding `rate_change_audit` row (via DB trigger).
- New "Audit log" tab on hotel detail with date filter, action filter, and CSV export.

## Part 5 — Notifications

In-app:
- New `notifications` rows (re-use existing `useNotifications` hook) on:
  - new abnormal pickup alert
  - ≥1 new pending recommendation per hotel (debounced per engine tick)
  - AI analysis ready

Email/SMS (configurable):
- Extend `hotel_revenue_settings` with `notify_email text[]`, `notify_sms text[]`, `notify_on jsonb` (booleans for `abnormal`, `new_recs`, `ai_ready`).
- Admin tab "Revenue settings" already implicit — add a new editor card per hotel to configure recipients and toggles.
- Reuse existing `send-email-notification` and `send-sms-otp` edge functions (rename second internally not needed; we'll call a new `send-revenue-alert` thin wrapper that fans out).

## Part 6 — Exports (CSV / XLSX)

New edge function `revenue-export` (admin/top_management only):
- Inputs: `hotel_id?` (or all), `from`, `to`, `format: 'csv'|'xlsx'`, `kind: 'recommendations'|'ai_insights'|'audit'|'pickup'`.
- Returns a downloadable blob (XLSX built with `xlsx` esm package the other functions already use).
- Front-end: "Export" menu on each tab (Recommendations, AI, Audit, Explorer).

Recommendations export columns: hotel, date, DOW, days_out, current_rate, recommended_rate, delta, source (engine/ai), reason, confidence, status, drivers JSON.

## Part 7 — Dashboard polish

`Revenue.tsx`:
- KPI strip across the top: total pending recs, abnormal alerts, snapshots uploaded today, AI analyses last 24h.
- Each hotel card: replace flat "14d pickup Δ" with two sparklines (bookings vs LY), show last upload filename + time, "Open" + quick-action buttons (Run AI, Export).
- Add a global "Pickup Explorer" page link.

`RevenueHotelDetail.tsx`:
- New tab order: Overview · Explorer · List · Calendar · Trend · Audit.
- Overview = KPI strip + AI panel + per-tier breakdown table.

```text
Hotel detail tabs
┌───────────────────────────────────────────────────────────────┐
│ [Overview] [Explorer] [List] [Calendar] [Trend] [Audit]        │
├───────────────────────────────────────────────────────────────┤
│ KPIs · AI panel with per-tier driver chips · Approve dialog    │
└───────────────────────────────────────────────────────────────┘
```

## Part 8 — Breakfast verification: end-to-end QA

The breakfast feature is wired but never tested with real data (0 roster rows in DB, 4 codes exist). We will:

1. Verify the public `/bb` page renders without auth (already implemented).
2. Verify `breakfast-roster-upload` parses the `daily_overview ... 30. 4. - 1. 5..xlsx` format the user already uploaded — current parser expects sheet names like `YYYY-MM-DD`; the real file uses other names. Make the parser:
   - Try sheet name regex first.
   - Fall back to scanning for a `Date` cell or using the date the user picked in `BreakfastRosterUpload.tsx`.
   - Better column heuristics for `arrival/ongoing/breakfast/lunch/dinner/all-inclusive`.
3. Add a small "Test lookup" button next to each code in `BreakfastCodeManagement.tsx` that opens `/bb` prefilled.
4. Add a "Recent uploads" list on the reception dashboard tile with row count, date, uploader.
5. Add translations for the breakfast page (`hu/es/vi/mn`) — currently English only.
6. Add a memory note `mem://features/breakfast` with hotel codes location and roster format.

## Part 9 — Wiring & translations

- Add Revenue + Audit + Explorer + per-tier breakdown strings to `comprehensive-translations.ts` (en/hu/es/vi/mn).
- Update `mem://features/revenue` to document the new audit table, notification settings, and export function.

---

## Technical notes

- **DB migrations**:
  - `rate_change_audit` table + RLS + trigger on `rate_recommendations` and `rate_history`.
  - `pickup_snapshots.snapshot_label text`.
  - `hotel_revenue_settings.notify_email text[] default '{}'`, `notify_sms text[] default '{}'`, `notify_on jsonb default '{"abnormal":true,"new_recs":true,"ai_ready":true}'`.
- **Edge functions**: rewrite `revenue-pickup-upload` (robust parser + multi-file friendly), update `revenue-ai-analyze` (drivers in tool schema), new `revenue-export`, new `send-revenue-alert`, hardening of `breakfast-roster-upload`.
- **Permissions**: every new function checks role ∈ {admin, top_management} except `breakfast-lookup` (public, already rate-limited).
- **Numerical accuracy**: per-tier driver chips render values we compute, not values the LLM types. The model only contributes `confidence` + free-text reason. Floor and max-daily-change guards are applied before display, with a "clipped" badge when active.
- **No Previo push** still gated (future, unchanged).

## Out of scope (next iteration)

- Live PMS pickup feed (still XLSX)
- Per-room-type pricing
- Actual SMS provider rotation
