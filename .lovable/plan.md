## Wire up Purchase Invoices module

Complete the integration of the Purchase Invoices feature built in the previous loop so admins, top management, controlling, and back-office users can access it end-to-end.

### 1. Route registration (`src/App.tsx`)

Inside `TenantRouter`, add:
```
<Route path="/purchase-invoices" element={<PurchaseInvoices />} />
```
Import `PurchaseInvoices` from `./pages/PurchaseInvoices`. No changes to the public `/bb` shell.

### 2. Navigation entry (`src/components/layout/PMSNavigation.tsx`)

- Add a new nav item `purchase-invoices` with a `Receipt` (or `FileText`) icon and label key `pms.purchaseInvoices`.
- Visible roles: `admin`, `top_management`, `control_finance`, `control_manager`, `back_office_manager`.
- Extend the outer visibility gate so the nav bar also renders for these finance/back-office roles (currently it only renders for admin + top_management).
- Add `pms.purchaseInvoices` translation keys in `hu, es, vi, mn, en` via `src/lib/purchase-invoice-translations.ts` (or the main translations file, matching existing pattern).

### 3. Inline "Verify & edit" dialog

New component `src/components/purchase-invoices/VerifyInvoiceDialog.tsx`:
- Opens from the Queue tab row action "Verify".
- Loads the invoice with its `purchase_invoice_vat_lines` and `purchase_invoice_items` in one query.
- Tabs: **Header** (merchant, tax_id, invoice_number, dates, currency, totals, category, payment method), **VAT lines** (editable table per rate), **Items** (editable rows with add/remove).
- Shows the document preview (signed URL from the `purchase-invoices` bucket) side-by-side on desktop, stacked on mobile.
- Save button: updates `purchase_invoices` row, upserts VAT lines and items (delete-then-insert for simplicity), sets `is_verified = true`, `verified_by = auth.uid()`, `verified_at = now()`, `status = 'verified'`.
- Only `admin`, `top_management`, `control_finance`, `back_office_manager` see the Save button; others get read-only.
- Uses native scrollable `div` (not Radix ScrollArea) inside the flex dialog, per project UI constraint.

### 4. Queue wiring (`src/pages/PurchaseInvoices.tsx`)

- Add a "Verify" button per row that opens `VerifyInvoiceDialog`.
- After save, invalidate the queue query so status badges refresh.
- Badge for `is_verified` ✓ next to status.

### 5. Mount confirmation

`PurchaseInvoices` already lives under `TenantRouter`, which is mounted inside `MainApp`. No extra provider mounting needed beyond the route registration — `TrainingGuideProvider`, `AuthProvider`, and `TenantProvider` are already in scope.

### Technical notes

- RLS already restricts visibility per `assigned_hotel` + `organization_slug`; no policy changes needed.
- `is_verified`, `verified_by`, `verified_at` columns already exist on `purchase_invoices` (added in the prior migration).
- No new edge functions, no migrations.

### Out of scope

- Bulk verify
- XLSX/ZIP export edge function
- Housekeeping guided tour selectors (separate follow-up)
