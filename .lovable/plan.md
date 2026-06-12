## Purchase Invoices — review, preview & polish

### 1. Verify-before-save workflow
- After OCR completes, instead of silently marking the invoice as `processed`, automatically open the **Verify extracted data** dialog so the user can compare against the original file and edit fields before committing.
- New invoice state model in the list:
  - `unverified` (default after OCR) — yellow "Unverified" badge + prominent **Review & verify** button.
  - `verified` — green badge (only set when user clicks Save & verify in the dialog).
- "Save draft" stays available for partial edits; the row remains `unverified` until explicit verification.
- Failed/needs-manual invoices keep the existing manual-edit path but flow through the same dialog.

### 2. Live preview fix (the blank left pane in the screenshot)
- Root cause: signed URL `<iframe src>` for PDFs is being blocked / not rendering inline in some browsers.
- Switch `VerifyInvoiceDialog` to download the file via `supabase.storage.from('purchase-invoices').download(file_path)` and render from a `Blob` object URL:
  - PDFs → `<iframe src={blobUrl}>` (blob URLs render reliably inline).
  - Images → `<img src={blobUrl}>` with zoom/fit-to-width.
  - Revoke the object URL on dialog close.
- Keep "Open in new tab" as a fallback using the signed URL.

### 3. Better animated "AI is working" processing card
Redesign `UploadJobRow` into a richer stepper card:
- Animated gradient header with a pulsing AI sparkle icon and rotating copy:
  - "Uploading your invoice…" → "Digitizing the document…" → "AI is reading the fields, sit back & relax ☕" → "Almost there…" → "Ready to review ✨".
- Step pills (Upload → Digitize → Extract → Ready) with a moving shimmer on the active step and a check-mark pop animation on completion.
- Subtle progress bar with indeterminate shimmer while the OCR call is in flight.
- Success state morphs into a "Review & verify" CTA that opens the dialog directly.
- Error state shows a friendly retry card with the failure reason.

### 4. Rename "Queue" → "Inbox"
- Update tab label and tour copy: `pi.tab.queue` becomes "Inbox" (HU: "Beérkezett", ES: "Bandeja", VI: "Hộp thư", MN: "Ирсэн").
- Update the page subheading + empty state copy accordingly.

### 5. Fix missing translation keys
Add for every locale (en/hu/es/vi/mn):
- `pi.queue.filter.duplicates` ("Duplicates")
- `pi.queue.filter.credit_notes` ("Credit notes")
- Any other `pi.*` keys currently rendering as raw IDs will be audited and filled in the same pass.

### Files to touch
- `src/pages/PurchaseInvoices.tsx` — auto-open verify after OCR, unverified badge, new stepper card, rename tab.
- `src/components/purchase-invoices/VerifyInvoiceDialog.tsx` — blob-based live preview, cleanup on close.
- `src/lib/purchase-invoice-translations.ts` — add missing keys for all 5 languages, rename Queue→Inbox.

### Out of scope
- No database/schema changes (uses existing `is_verified` / `status` columns).
- No edge-function changes.
