# Purchase Invoice & Controlling Upgrade (RD Hotels)

Upgrade of the existing invoice module only. No changes to revenue, Previo, pickup automation, housekeeping, maintenance, PMS, billing, breakfast, or auth beyond finance permissions.

## What exists today (verified)

- `purchase_invoices` (45 cols): technical `status`, `document_type`, `error_code/details`, confidence, merchant fields, buyer fields (`buyer_name`, `buyer_tax_id`, `buyer_company_id`), `hotel_id` (text), `organization_slug`, `is_verified`/`verified_by`/`verified_at`, `duplicate_of`, `duplicate_status`, `is_credit_note`.
- `invoice_buyer_companies` (id, organization_slug, name, tax_id, display_color, notes) — no normalized tax id, no aliases, no active flag.
- `purchase_invoice_categories` (organization_slug, code, label, is_active, sort_order) exists but the invoice stores free-text `expense_category` only.
- `purchase_invoice_items`, `purchase_invoice_vat_lines` per invoice.
- RLS is role-array based (`pi_user_role()`, `pi_user_org()`, `pi_user_hotel()`); reception sees only own uploads, back_office is hotel-scoped, admin/top_management/control_finance see whole org. No approval concept anywhere.
- `src/pages/PurchaseInvoices.tsx` (1253 lines) loads invoices client-side; `computeStats` mixes datasets — `successRate` and `unverified` are computed from `all`, while spend/count/VAT come from the filtered list, which is the "0 matching / 3 need verification" contradiction. "This month" KPI is labelled fixed even though a range is selectable.
- No cost-centre concept, no audit log, no document hash, no server-side search, no legal-entity ↔ property mapping.

## Batch plan

### Batch 1 — Analytics correctness
One `scopedInvoices` dataset feeds every period KPI and chart (spend, count, average, VAT, merchants, categories, company, property, weekly, daily, duplicates, review/approval stats). Any deliberately global figure gets an explicit "all time" label. Rename "This month" → "Spend in selected period"; split "Success rate" into "Extraction success" (AI processed / uploaded) and "Approval rate" (approved / relevant). Add presets: 7/30/90 days, this month, previous month, YTD, previous year, all time, custom. Empty-state note when the period has no invoice dates but recent uploads exist, without auto-changing the period.

### Batch 2 — Legal entity / property / cost centre
Extend `invoice_buyer_companies` with `legal_name` (backfilled from `name`), `normalized_tax_id` (generated: uppercase, digits only, HU prefix stripped), `is_active`. Add `invoice_company_aliases` (company_id, alias_name) and `invoice_company_properties` (company_id, hotel_id) for entity↔property mapping. Unique index on (organization_slug, normalized_tax_id). Backfill/merge existing rows by normalized tax id, repointing `buyer_company_id` — no deletes.
New `invoice_cost_centres` (organization_slug, optional hotel_id, code, label, is_active, sort_order), seeded with the listed departments; `purchase_invoices.cost_centre_id` added. Property stays the uploader's hotel; AI buyer never overwrites it. When buyer entity ≠ property's mapped entity, set a `company_property_mismatch` flag surfaced as "Company / property mismatch — please review".

### Batch 3 — Controlled expense categories
Seed `purchase_invoice_categories` with the listed master list; add `expense_category_id` to invoices (free-text kept for history). AI must pick from the active list or fall back to `uncategorized`. Reviewers can change it; category management screen for authorized users.

### Batch 4 — Review → approval workflow + audit
Keep technical `status` untouched. Add `review_status` (pending_review/reviewed/pending_approval), `approval_status` (none/approved/rejected), `reviewed_by/at`, `approved_by/at`, `rejected_by/at`, `rejection_reason`, `reviewer_notes`, `reopened_by/at/reason`. Backfill: `is_verified = true` → `review_status='reviewed'` (never auto-approved). Review screen = existing `VerifyInvoiceDialog` extended (document left, editable fields right) plus "Submit for approval". Controlling gets Approve / Reject (reason required) / Return for correction. New `purchase_invoice_audit_log` (invoice_id, user_id, action, field, old_value, new_value, notes, created_at), append-only, written by triggers/RPC for upload, extraction, edits, submit, approve, reject, reopen, corrections, duplicate decisions. Approved invoices become read-only for uploader/back-office until reopened.

### Batch 5 — Finance access profiles
Add `profiles.job_title` (free text) and a `finance_access` table: user_id, profile enum (`uploader`, `reviewer`, `controller`, `chief_controller`, `management_read`, `none`), plus `finance_access_companies` / `finance_access_properties` scope rows. Existing HotelCare roles keep working; finance permissions are additive and checked in RLS via security-definer helpers (`fin_profile()`, `fin_can_approve()`, `fin_scope_ok(invoice)`), replacing the hard-coded role arrays on `purchase_invoices` without narrowing current legitimate access. Finance Access management screen for admin / chief controller; system admin does not get approval rights implicitly.

### Batch 6 — Duplicate detection
Layer 1: SHA-256 of the uploaded file computed at upload, stored in `file_sha256` (indexed); identical file → `duplicate_status='exact'` linked to the original, never deleted. Layer 2: `normalized_invoice_number` + normalized merchant tax id + buyer entity + invoice date + gross + currency → `possible` with `duplicate_of` link. Normalization strips spaces/case/separators only, keeping digits and alphanumeric segments intact. Controlling resolves: confirm duplicate / not duplicate / credit note; credit-note handling stays as-is.

### Batch 7 — Management analytics dashboard
Default status filter = approved for management roles. KPIs: spend in period, previous-period delta, count, average, VAT, pending control (count + HUF), approval rate, duplicate alerts. Filter bar: date, legal company, property, cost centre, category, merchant, workflow status, verification, currency — combining, with active-filter chips. Charts: weekly spend, 12-month trend, company comparison, property comparison, category breakdown, top 10 merchants, merchant trend, largest invoices, VAT summary, pending-approval ageing (0–2 / 3–7 / 8+ days). Every KPI/chart drills down to an invoice list and then to the existing document view. Aggregations move to SQL RPCs (`pi_analytics_summary`, `pi_analytics_buckets`, `pi_analytics_breakdown`) so the browser no longer downloads full history.

### Batch 8 — Server-side search & indexes
`pi_search_invoices` RPC over normalized invoice number (highest priority, exact-first), merchant name/tax id, buyer name/tax id, amount, property — RLS-respecting, paginated. Indexes added only where missing: normalized invoice number, merchant tax id, buyer_company_id, invoice_date, (organization_slug, hotel_id), review/approval status, file_sha256. Existing pagination preserved.

## Technical notes

- Migrations are additive; no invoice rows or storage files are deleted; every new column is nullable or defaulted with an explicit backfill.
- `process-purchase-invoice` is extended (not replaced): hash on upload, category chosen from the master list, buyer resolution by normalized tax id with alias capture, dual-layer duplicate detection, initial `review_status='pending_review'`.
- No RD Hotels legal name or tax ID is hardcoded; the third legal entity must be entered in the Legal Entities screen unless it already exists in invoice data.
- New management screens live as tabs under Invoice Settings: Legal Entities, Expense Categories, Cost Centres, Finance Access.
- Each batch is typechecked and exercised before the next; the final report follows the 11-section structure requested.
