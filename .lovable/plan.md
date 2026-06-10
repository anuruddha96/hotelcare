## Scope

Seven groups of changes, all UI/feature work plus a small DB extension for invoice duplicate detection and multi-company tagging.

---

### 1. Admin can see housekeeper room assignments in Team View

**Problem:** In Housekeeping → Team View → Hotel Room Overview, managers see assignment chips (201/202/203 with housekeeper names) but admins see an empty area.

**Fix:** In the team view / hotel room overview component, the data fetch or render is gated to `manager`-style roles. Extend the role guard so `admin` and `top_management` get the same view as managers (read-only is fine). No change to underlying data, just role inclusion in the visibility check and in the assignments query filter.

---

### 2. Rename main navigation links

In the main tabs bar (and any breadcrumb/page titles that mirror the tab name):

| Current | New |
|---|---|
| Tickets | Maintenance |
| Rooms | Reception |
| Housekeeping | Housekeeping (unchanged) |
| Attendance | HR |
| Revenue | Revenue Management |
| Purchase Invoices | Invoices |

Update the labels in `MainTabsBar.tsx` and the translation keys (en + hu/es/vi/mn) in the comprehensive/screen translation files. Route paths stay the same to avoid breaking links.

---

### 3. Invoices — duplicate invoice number detection (credit-invoice aware)

**Goal:** When a user uploads an invoice, after OCR extracts `invoice_number` + `merchant_tax_id` + `total_amount`, check for an existing invoice with the same `(merchant_tax_id, invoice_number)` in the same organization. 

**Credit invoice rule:** If the new invoice's `total_amount` is negative OR the prior matching invoice was already marked as canceled/credit, treat as a legitimate credit note — do not block, but link the two and label the new one as "Credit note for invoice X".

**Behavior:**
- After OCR, if a duplicate is detected and the new one is NOT a credit note, show a warning banner on the invoice card: "⚠️ Possible duplicate — invoice number already uploaded on YYYY-MM-DD" with actions: "View original", "Keep both", "Delete this".
- If it looks like a credit note (negative total), show a neutral info badge: "ℹ️ Credit note — matches invoice X".
- Add a new "Duplicates" filter chip in the Queue tab.

**DB:** add `is_credit_note boolean`, `duplicate_of uuid` (nullable FK to `purchase_invoices.id`), `duplicate_status text` ('none' | 'suspected' | 'confirmed_duplicate' | 'credit_note') columns on `purchase_invoices`. Index on `(organization_slug, merchant_tax_id, invoice_number)`.

---

### 4. Invoices — multi-company detection + analytics breakdown

**Goal:** This tenant uploads invoices for multiple legal entities (RD Hotel Kft, Gózsdu Hotel Kft, etc.). The system must determine which **buyer company** an invoice is for and break it down in analytics.

**Detection:** The OCR already returns `merchant_*` (the seller). We need the **buyer** (customer) fields. Extend the AI extraction prompt + tool schema in `process-purchase-invoice/index.ts` to also extract `buyer_name`, `buyer_tax_id`, `buyer_address`. Persist on `purchase_invoices` as `buyer_name`, `buyer_tax_id`, `buyer_address`, `buyer_company_id` (nullable).

**Company registry:** small `invoice_buyer_companies` table per organization with `name`, `tax_id`, `display_color`. Auto-create on first sighting of a new buyer tax id (with the extracted name); admin can rename/merge later from a small admin section.

**Analytics:** add a "By Company" card group to the Analytics tab — totals, invoice counts, VAT, top merchants — grouped by `buyer_company_id`. Add a "Company" filter chip to the Queue tab.

---

### 5. Visually appealing upload-status UI

When the user uploads via Upload tab:

- Immediately show a card with the file thumbnail, filename, and a 4-step progress stepper:
  `Uploading → Digitizing (OCR) → Extracting fields → Ready for review`
- Animated progress bar and a spinning gradient ring during `processing`.
- Live status pulled from the `purchase_invoices.status` row via realtime subscription (already in place) — replace the current static "Uploaded / Processing" badges with this stepper card.
- On `processed` success: stepper collapses into a green "Done — review now" card with a Verify button.
- On `failed`: red card with error_code title, tips, and Retry OCR button.

This becomes the centerpiece of the Upload tab below the camera/upload buttons and also appears in "Recent uploads" while processing.

---

### 6. Admin delete + mobile polish

- **Delete:** Add a delete action (trash icon with confirm dialog) on every invoice row, visible only to `admin` and `top_management`. Calls a `DELETE` against `purchase_invoices` (cascade to vat lines + items + storage object). Add RLS policy `admin can delete purchase_invoices in their org`.
- **Mobile layout:** Restructure `PurchaseInvoices.tsx` mobile view:
  - Convert horizontal tabs (Upload / Queue / Analytics / Export) into a sticky segmented control that stays in view on scroll.
  - Invoice rows: collapse to a 2-line card (merchant + amount on line 1, date + status badge on line 2), tap to expand actions.
  - Move the Export button out of the tab row into the Queue/Analytics header on mobile (so it doesn't overlap the panel as in screenshot 3).
  - Status chips on Queue wrap cleanly; "Retry OCR" and "Save & verify" become icon buttons on small screens.

---

### 7. Tour guide fixes (Purchase Invoices tour)

- **Step 10 "Retry failed scans":** spotlight target only exists when there's a failed invoice. Fix by (a) auto-creating a temporary demo "failed" sample row visible only during the tour, OR (b) detecting absence of a target and swapping that step into a static illustrated card explaining Retry OCR (no spotlight). Implement option (b) — simpler and no data pollution.
- **Step 14 "Export anywhere":** the popover currently sits over the Export panel and the visual is poor. Reposition the tooltip to the side, ensure the Export tab is auto-activated when the step starts, and highlight the Export CSV / Export XLSX buttons explicitly.
- **Step 14 → 15 blocked:** Next button does nothing. The step 15 anchor selector is missing/changed. Re-point step 15 to a stable selector (likely the page header or a "Finish" element we add), and ensure the curriculum's final step has an `onComplete` handler that closes the tour. Add a guard so that if a step's anchor isn't found, the tour still advances after a short fallback timeout instead of stalling.

---

## Files to touch (high level)

- `src/components/dashboard/HotelRoomOverview.tsx` and the Team View parent — admin role inclusion.
- `src/components/layout/MainTabsBar.tsx` + translation files — nav rename.
- `src/pages/PurchaseInvoices.tsx` — page title, mobile layout, delete button, upload-status stepper, duplicate banner, company filter.
- `src/components/purchase-invoices/` — new `UploadStatusCard.tsx`, `DuplicateWarningBanner.tsx`, `CompanyBreakdown.tsx`; update `VerifyInvoiceDialog.tsx`.
- `supabase/functions/process-purchase-invoice/index.ts` — extract buyer fields, run duplicate check, set `duplicate_of` / `is_credit_note`.
- New migration: add columns + `invoice_buyer_companies` table + index + admin delete policy.
- `src/components/training/v2/curricula/manager.ts` (or wherever the invoices curriculum lives) — fix steps 10, 14, 15 + add anchor-missing fallback in `TrainingOverlayV2.tsx`.

## Out of scope

- Changing the underlying route paths.
- Reworking OCR provider or VAT logic.
- Building a full company-management admin UI beyond rename/merge.

After approval I'll implement in this order: nav rename → admin team view fix → DB migration → upload-status UI + duplicate detection → multi-company + analytics → delete + mobile polish → tour fixes.