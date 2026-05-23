## Purchase Invoices Module for Hotel Care

Port the proven invoice OCR system from the brownie/treats project, adapted to Hotel Care's multi-tenant (organization + hotel) architecture, Hungarian VAT rules, and existing role model. Add per-hotel isolation, a new `back_office` role, and a guided onboarding tour that also retro-fits the housekeeping panel.

---

### 1. Roles & Access

Extend the `user_role` enum with a new `back_office` role.

| Role | Upload | Verify | View list | Analytics/Reports | Delete |
|---|---|---|---|---|---|
| admin | ✓ | ✓ | ✓ | ✓ | ✓ |
| top_management | ✓ | ✓ | ✓ | ✓ | ✓ |
| control_finance (controlling) | ✓ | ✓ | ✓ | ✓ | ✓ |
| back_office (new) | ✓ | ✓ (preview only) | ✓ (own hotel) | ✗ | ✗ |
| reception / front_office | ✓ | preview own upload | own uploads only | ✗ | ✗ |
| housekeeping*, maintenance, breakfast_staff | ✗ | ✗ | ✗ | ✗ | ✗ |

All data is filtered by `assigned_hotel` + `organization_slug` (Core memory rule). Reception sees only invoices they uploaded; back-office sees the hotel's queue; controlling/admin/top-management see all hotels in their org.

---

### 2. Database (new tables)

- `purchase_invoices` — one row per uploaded document. Columns: hotel_id, organization_slug, uploaded_by, image_url (storage path), status (`uploaded|processing|processed|failed|verified`), document_type, error_code, error_details (jsonb), confidence_score, needs_review, raw_text, extraction_notes, merchant_name, merchant_tax_id, merchant_address, invoice_number, invoice_date, due_date, performance_date, currency, total_amount, net_amount, total_vat_amount, expense_category, bottle_deposit_amount, payment_method, verified_by, verified_at, processing_notes.
- `purchase_invoice_vat_lines` — Hungarian VAT broken out independently per rate: invoice_id, vat_rate (27, 18, 5, 0, AAM/exempt, KBA/reverse-charge, EU intra-community, export 0%), vat_base, vat_amount, country (for foreign VAT).
- `purchase_invoice_items` — line items: invoice_id, name_original, name_english, quantity, unit_price, total_price, vat_rate, item_type, item_code.
- `purchase_invoice_categories` — admin-managed expense categories (org-scoped) so the team can extend beyond defaults.
- Storage bucket `purchase-invoices` (private) with per-org/per-hotel folder RLS.

RLS: `has_role(auth.uid(), …)` security definer helper checks role + hotel + org.

---

### 3. OCR & extraction (no separate AI vendor)

Single edge function `process-purchase-invoice` using **Lovable AI Gateway** (`google/gemini-2.5-flash` — vision-capable, included in free tier, no extra setup). Reasoning: pure OCR libraries (Tesseract) handle clean printed receipts but fail on Hungarian fiscal receipts, multi-VAT tables, and rotated phone photos — the gateway model handles all of these reliably and is already wired into the project. Falls back to a structured error code (ERR_BLURRY / ERR_DARK / ERR_PARTIAL / ERR_NOT_INVOICE / ERR_UNREADABLE / ERR_MISSING_DATA / ERR_PDF_TOO_LARGE) when quality is insufficient, with localized tips returned to the UI.

Server-side post-processing:
- Date normalization (Hungarian `YYYY.MM.DD.`, EU, ISO, English long-form).
- Hungarian merchant detection (Aldi, Lidl, Spar, Tesco, Penny, DM, Müller, Auchan, CBA, Coop, etc.).
- VAT auto-fill for simplified receipts that print only `A/B/C` codes (A=5%, B=18%, C=27%) by deriving base+VAT from the gross.
- Tax-ID validation (Hungarian `12345678-1-12` format).
- Foreign VAT detection (EU invoices in EUR/USD, stored with `country`).

---

### 4. Hungarian VAT model

Stored per VAT line so reports can split correctly:
- **27%** — standard
- **18%** — basic foods, hotel accommodation services
- **5%** — books, medicines, district heating, new residential, certain meats
- **0% / AAM** — exempt without deduction (small-business)
- **KBA / reverse charge** — domestic reverse charge (construction, scrap)
- **EU intra-community** — 0% with partner VAT number
- **Export 0%**
- **Foreign VAT** — kept as `foreign_vat_details` with country code, never mixed into HU totals

Reports sum bases and amounts per rate, per period, per hotel.

---

### 5. UI

New route `/:organizationSlug/purchase-invoices` and surfaced in `PMSNavigation` only for eligible roles. Single page with role-aware tabs:

- **Upload** (all eligible roles) — camera + file + PDF. Live image-quality hints (blur/darkness) before submit. Per-step progress: uploaded → OCR → parsed → preview. Editable preview with all extracted fields + per-VAT lines + items, "Save & verify" or "Save as draft".
- **Queue / All invoices** (back_office+) — list with filters (hotel, date range, merchant, VAT rate, status, needs-review), bulk verify, edit, delete (admin).
- **Analytics** (controlling/top_management/admin only) — KPI cards (this month, last month, % change, unverified count, top merchant), Recharts: monthly spend bar, VAT breakdown donut, category split, merchant top-10, daily trend. Report period: day / week / month / quarter / year, with hotel filter.
- **Export** (controlling+) — CSV/XLSX export, NAV-compatible VAT summary, ZIP of source images for a period.

Mobile-first: cards stack, camera button is primary CTA, sticky bottom action bar.

---

### 6. Guided training (multilingual, animated)

New reusable `GuidedTour` system (extends existing `TrainingGuideContext`):
- Blurs background, spotlights one element at a time, fades+slides tooltip in (Framer Motion).
- Steps defined as `{ targetSelector, titleKey, bodyKey, placement, action? }`.
- Auto-runs on first visit per route (flag stored in `user_training_progress` table per user/route), with a persistent "?" help button in the page header to replay.
- All copy translated via existing `useTranslation` into **hu, es, vi, mn, en**.
- Tours shipped for: `/purchase-invoices` (upload → preview → verify → analytics) and the existing housekeeping panel (assignments → start cleaning → DND → complete) so the housekeeping side gets the same treatment.

---

### 7. Out of scope (explicit)

- NAV Online Számla direct submission (only export-ready format for now).
- Approval workflows / multi-step finance sign-off.
- Supplier master / accounts-payable ledger.
- Editing the housekeeping tour content beyond initial 4-step skeleton.

---

### Technical notes

- Edge functions: `process-purchase-invoice` (OCR + parse), `purchase-invoice-export` (CSV/XLSX/ZIP). Both with `verify_jwt = true` via in-code JWT check + role check.
- Storage bucket `purchase-invoices` private, signed URLs only.
- Migration adds `back_office` to `user_role` enum, all tables, RLS policies via `has_role` definer, and an `expense_categories` seed.
- Frontend: `src/pages/PurchaseInvoices.tsx`, `src/components/purchase-invoices/*` (Upload, Preview, Queue, Analytics, Export, Tour), `src/components/training/GuidedTour.tsx`, `src/lib/purchase-invoice-translations.ts`.
- Charts: Recharts (already in project).
- Image quality precheck: client-side Laplacian-variance blur check + brightness histogram before upload to save round-trips.
