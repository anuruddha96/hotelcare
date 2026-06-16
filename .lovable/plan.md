# Purchase Invoices — Overhaul

## 1. Verify-before-save (no auto-save)
- Remove the `setTimeout(...)` that drops the job after 2.5s in `PurchaseInvoices.tsx` (line ~200). Processing card stays until user opens & saves.
- After OCR completes, status stays `processed` + `is_verified=false` → row shows amber **Unverified** badge.
- Open `VerifyInvoiceDialog` automatically once, but nothing is persisted as "verified" until user clicks **Save & verify**.
- Add two buttons in the dialog footer:
  - **Save draft** (current Save) — keeps `is_verified=false`.
  - **Save & verify** — sets `is_verified=true`, `verified_by=auth.uid()`, `verified_at=now()`.
- Eligible roles for verifying & editing: `admin`, `top_management`, `top_management_manager`, `manager`. Others see read-only view.
- Add **Unverify** action (eligible roles only) on already-verified invoices to send them back to review.

## 2. Live preview on the left (no link click)
Current dialog shows only filename + "Open in new tab". Rebuild layout:

```text
┌─────────────────────────────┬──────────────────────────┐
│  LIVE PREVIEW (60% width)   │  EXTRACTED DATA (40%)    │
│  • PDF → <iframe blob>      │  Merchant / VAT / Lines  │
│  • Image → <img blob> +     │  Editable inputs         │
│    zoom / rotate controls   │  [Save draft][Verify]    │
│  • Fallback: Open in tab    │                          │
└─────────────────────────────┴──────────────────────────┘
```

- Make dialog wider (`max-w-6xl`, `h-[90vh]`).
- Preview pane is always rendered (no click needed). Already downloads blob — just surface it as the main left column.
- Add toolbar: zoom in/out, rotate, fit-to-width, download original.

## 3. Rename tabs & labels
- **"Inbox" → "Invoice Queue"** (tab key stays `queue` to avoid breaking tours). Update `pi.tab.queue` translations across 5 languages.
- **Page title "Purchase Invoices" → "Invoices Management"** (user typo "invocies"). Update across translations.
- Tour copy updated where needed.

## 4. Analytics — custom filter controls
Replace the single "All time" preset with a control bar:
- Date range: presets (Today / 7d / 30d / 90d / This month / Last month / This year / All time) **+ custom date picker** (from–to).
- Merchant multi-select.
- Expense category multi-select.
- Payment method filter.
- Verification status filter (All / Verified / Unverified).
- Min/Max amount.
- "Reset filters" button.
- All KPIs, daily-spend chart, top-merchants chart recompute from the filtered set.
- Persist last-used filters to `localStorage`.

## 5. Better Upload / Queue / Export UX
- **Upload tab:** drag-and-drop full-screen overlay, multi-file picker, per-file progress with the existing animated "AI is reading…" card; show queue summary (X processing, Y unverified).
- **Queue tab:**
  - Quick stats strip on top (Total / Unverified / Verified / Failed / Duplicates).
  - Bulk actions: select rows → bulk verify, bulk delete (admins), bulk export.
  - Inline preview thumbnail in each row (first page rendered from blob, cached).
  - Sort + filter chips remain, plus merchant search autocomplete.
- **Export tab:**
  - Choose columns to include (checkbox list).
  - Format: CSV / XLSX / JSON.
  - Apply same custom filters as Analytics.
  - "Export filtered" vs "Export all" buttons.

## 6. Translations
Add/update keys in `purchase-invoice-translations.ts` for 5 languages:
- `pi.title` ("Invoices Management" etc.)
- `pi.tab.queue` ("Invoice Queue")
- `pi.verify.saveDraft`, `pi.verify.saveAndVerify`, `pi.verify.unverify`, `pi.verify.readOnly`
- `pi.analytics.filters.*` (custom range, merchant, category, reset…)
- `pi.export.columns`, `pi.export.format`, `pi.export.filtered`, `pi.export.all`
- `pi.upload.bulk.*`, `pi.queue.bulk.*`

## Technical details

**Files to edit (no DB schema changes needed — `is_verified`, `verified_by`, `verified_at` already exist):**
- `src/pages/PurchaseInvoices.tsx` — remove auto-dismiss timer, add role gate, custom analytics filters, bulk actions, export controls, rename labels.
- `src/components/purchase-invoices/VerifyInvoiceDialog.tsx` — two-column layout, persistent preview, zoom/rotate toolbar, Save draft vs Save & verify, role-based read-only mode.
- `src/lib/purchase-invoice-translations.ts` — new keys × 5 languages.
- New `src/components/purchase-invoices/AnalyticsFilters.tsx` — filter bar (date range, merchant, category, amount).
- New `src/components/purchase-invoices/ExportPanel.tsx` — column picker + format selector.

**Role check helper:** reuse `profile.role` from `useAuth()`; gate verify/edit/delete behind `['admin','top_management','top_management_manager','manager'].includes(role)`.

**No backend changes.** Edge function `process-purchase-invoice` already sets `status='processed'` and leaves `is_verified=false`.
