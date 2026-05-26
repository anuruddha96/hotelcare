# Purchase Invoices — Fixes & Improvements

## 1. Fix upload error ("Failed to send a request to the Edge Function")

**Root cause:** `process-purchase-invoice` returns 404 NOT_FOUND when curled — the function never deployed (likely a build/syntax issue or it was registered in `config.toml` after first deploy snapshot). The client invoke therefore fails before any code runs, so no logs exist.

Actions:
- Touch `supabase/functions/process-purchase-invoice/index.ts` (minor harmless edit + add explicit `// deploy` marker) to force a redeploy.
- Add a small input-validation guard at the top so the function returns 400 (not 500) for missing fields, which also confirms deploy via curl.
- In the client (`handleFile`), improve error surface: when `error.message` is `Failed to send a request to the Edge Function`, show a clearer toast ("Processor unavailable — invoice saved as draft, retry from Queue") and still keep the inserted DB row so the user can re-trigger from Queue.
- Add a **"Retry OCR"** action per row in the Queue (calls the same function for an existing invoice id).

## 2. Expand the guided tour (currently 4 steps → ~12)

Add `data-tour` anchors and steps for:
1. Welcome / what this module does
2. Top stats area (replay button, role badge)
3. Tabs overview
4. Upload — Camera tile (mobile capture)
5. Upload — File tile (PDF support, multi-file)
6. Quality tips strip (lighting / flat / clear)
7. Queue — search box
8. Queue — status badges legend
9. Queue — click row to verify
10. Queue — Retry OCR button (new)
11. Analytics — KPI cards
12. Analytics — daily trend, category & VAT breakdown
13. Export — CSV / XLSX (new)
14. Replay tour button — how to revisit anytime

All step copy added to `purchase-invoice-translations.ts` for `en, hu, es, vi, mn`.

## 3. Queue improvements

- **Status filters** (chips): All / Uploaded / Processing / Processed / Verified / Failed / Needs review.
- **Date range** filter (this month / last month / custom).
- **Bulk select** with checkboxes: bulk verify, bulk retry OCR, bulk delete (admin only).
- **Inline preview thumbnail** (first page / image) per row with signed URL.
- **Sort** by date / amount / merchant.
- **Pagination** (50 per page) — current 500 limit becomes paginated query.
- **Failure reason chip** with error tip on hover (uses `error_details.tips`).
- **Empty state** with CTA to Upload tab.

## 4. Analytics improvements

- **Date range selector** (7d / 30d / 90d / YTD / custom) driving all charts.
- **New KPI tiles:** Avg invoice value, VAT reclaimable total, Processing success rate, Unique merchants.
- **Monthly comparison chart** (this year vs last year, grouped bars).
- **Top 10 merchants** horizontal bar chart.
- **VAT breakdown by kind** (27% / 18% / 5% / AAM / KBA) — stacked bar by month, replacing the duplicate line chart.
- **Payment method split** donut.
- **Hotel split** (when org has multiple hotels and user can see them).
- **Anomaly callout:** invoices where total differs from sum(vat_lines) by >1%, or duplicates (same merchant+invoice_number).
- **Drill-through:** clicking a chart segment filters the Queue tab to that slice.

## 5. Export improvements

- CSV (exists), add **XLSX** (multi-sheet: Invoices, VAT lines, Items) using `xlsx` package.
- Add **NAV-compatible XML** stub (Hungarian tax authority format) — header only with merchant/tax_id/dates/totals; flagged as beta.
- Date-range + status filter applied to export.

## 6. Files touched

- `supabase/functions/process-purchase-invoice/index.ts` — force redeploy, add input validation, allow re-processing existing rows.
- `src/pages/PurchaseInvoices.tsx` — queue/analytics/export upgrades, retry, filters, tour anchors.
- `src/components/purchase-invoices/QueueRow.tsx` (new) — extracted row with thumbnail + actions.
- `src/components/purchase-invoices/AnalyticsPanel.tsx` (new) — extracted analytics.
- `src/components/purchase-invoices/ExportPanel.tsx` (new) — CSV + XLSX + NAV XML.
- `src/lib/purchase-invoice-translations.ts` — 5 languages, ~30 new keys for tour + UI.
- `src/components/training/GuidedTour.tsx` — no changes needed (already supports N steps).

## Out of scope
- Real NAV Online Invoice API submission (only export stub).
- Mobile-native camera enhancement plugins.
- Auto-categorization ML beyond current AI extraction.
