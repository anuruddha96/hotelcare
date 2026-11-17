# Purchase Invoice Intelligence & NAV Reconciliation

Route: `/:organizationSlug/purchase-invoices` · Branch: `feature/purchase-invoice-nav-reconciliation`

This module digitizes incoming (purchase) invoices, checks them deterministically, reconciles them
with the invoice data reported to **NAV Online Számla (API v3.0, read-only)**, finds NAV invoices for
which no document was uploaded, and runs an approval workflow with database-enforced role separation.

HotelCare **never issues invoices and never sends data reports to NAV** from this module. NAV holds the
*reported tax data* of an invoice, not its PDF — the uploaded document stays the original.

---

## 1. Architecture

```
Browser (React)                          Supabase Edge Functions (server only)          NAV Online Számla v3
──────────────                           ────────────────────────────────────          ────────────────────
Upload (multi-file, camera, drag&drop) ─► process-purchase-invoice (OCR, checks) 
Verify dialog / NAV comparison          ─► reconcile-purchase-invoices (run, decisions)
Settings → NAV                          ─► nav-connection-admin (credentials, test)  ──►  queryTaxpayer
Overview “Sync now”                     ─► nav-sync (manual)                          ──►  queryInvoiceDigest
pg_cron */30                            ─► nav-sync (worker)                          ──►  queryInvoiceData
pg_cron */10                            ─► process-purchase-invoice (OCR recovery)
pg_cron 06:15 UTC                       ─► pi-daily-summary (e-mail)
Settings → Historical import            ─► pi-history-import
```

Shared, unit-tested modules live in `supabase/functions/_shared/purchaseInvoices/`:

| Module | Purpose |
| --- | --- |
| `sha3.ts`, `navCrypto.ts` | SHA3-512 request signature, SHA-512 password hash, credential validation |
| `navRequest.ts`, `navResponse.ts`, `xml.ts` | INBOUND-only request builders (XSD-validated), safe XML parsing (DTD/entities rejected), error classification |
| `navClient.ts` | Pagination, pacing (1 req/s for data/taxpayer), retries with back-off, timeouts |
| `navSyncPlan.ts`, `navSyncRunner.ts` | Window planning (≤35-day NAV limit), resumable history, incremental `insDate` cursor, late-report backfill, detail enrichment, health/back-off |
| `navCredentials.ts` | AES-256-GCM envelopes, key in Supabase Vault, ciphertext bound to the connection id |
| `invoiceValidation.ts`, `normalize.ts` | Document kinds, Hungarian number/date formats, net+VAT=gross, mixed VAT, amount due, credit-note signs, tax-number checksum |
| `reconciliation.ts`, `gapFill.ts`, `approvalGate.ts` | Deterministic, explainable matching; gap filling with provenance; approval preconditions |
| `reconcileRunner.ts` | Loads data → engine → bulk writers; one run per organization (coalesced) |
| `piAuth.ts` | Caller authorization (user JWT evaluated by the database, or Vault worker secret) |

## 2. Data model (migration `20261117170000_purchase_invoice_nav_reconciliation.sql`)

* `pi_module_settings` — per-organization rollout (`module_enabled`, `allowed_roles`), tolerances,
  reporting delay, **reconciliation start date (go-live)**, approval rules, automation, daily summary.
* `purchase_invoices` (new columns) — `document_kind`, amounts due/previous balance/advance/discount,
  `currency_source` (`document` · `default` · `user` · `nav` · `import`), `field_confidence`,
  immutable `ocr_original`, `validation_status/results`, OCR provider/model/version, `nav_*` match
  fields, manual decision fields, `source` (`upload` · `historical_import` · …), `preview_path`.
* `pi_nav_connections` / `pi_nav_connection_secrets` — one connection per legal company and environment
  (`test` / `production`); secrets table has RLS with **no policies** and is revoked from browser roles.
* `pi_nav_invoices` — normalized NAV store, unique per `(company, environment, source_key)`; never merged
  into the uploaded-document record.
* `pi_nav_sync_runs`, `pi_nav_sync_events` — sync history and safe diagnostics (no credentials, no XML).
* `pi_reconciliation_events`, `pi_invoice_field_provenance` — status changes and per-field provenance
  (`fill` · `propose` · `conflict` · `equivalent`) with decisions.
* `pi_missing_document_followups`, `pi_missing_document_notes` — work queue for NAV-only invoices.
* `pi_processing_jobs` — idempotent OCR job claims; `pi_reconcile_state` — reconciliation lock/coalescing.
* Archive `pi_deleted_invoices` (approved invoices cannot be deleted).

Rollback: `supabase/rollbacks/20261117170000_purchase_invoice_nav_reconciliation_down.sql`
(disables connections and cron, removes guards; data is preserved; destructive section commented).

## 3. Security

* **Tenancy:** every table is organization-scoped by RLS (`pi_user_org()`); NAV records are additionally
  scoped by legal company/property (`pi_can_view_nav`). Storage objects are readable only inside the
  caller's organization folder **and** when an invoice row the caller can see references the object
  (fixes the previous cross-tenant read/delete gap).
* **Rollout in the database:** a RESTRICTIVE policy `pi_module_gate` on `purchase_invoices` uses
  `pi_module_access()`; the route and the menu use the same RPC.
* **Approvals:** trigger `pi_guard_invoice_update` enforces: server-only fields, duplicate decisions by
  reviewers, approval only by a controller in scope, no data change in the approval step, optional
  separation of duties, exception blocking, optional NAV-match requirement, no duplicate approval
  (normalized supplier tax number + invoice number), locked approved invoices, reopen only by a chief
  controller with a reason. Browser inserts are reset to a clean state (`pi_guard_invoice_insert`).
* **Credentials:** entered once in Settings, sent only to `nav-connection-admin`, encrypted with
  AES-256-GCM (Vault key `hotelcare_nav_credential_key`, AAD = connection id), never returned, logged
  or stored readable. New credentials disable the connection until a fresh test passes.
* **Environments:** separate test/production base URLs; enabling production requires an explicit
  authorization confirmation. Test-environment data is only used for reconciliation when an admin turns
  it on, and production wins when both exist.

## 4. NAV synchronization

* Operations used: `queryInvoiceDigest` (INBOUND), `queryInvoiceData` (INBOUND), `queryTaxpayer`
  (connection test). No `manage*`, token exchange or outbound operation exists in the code.
* **Initial history:** issue-date windows from `sync_from_date`, resumable via `initial_sync_through`.
  The `insDate` cursor is pinned at the first history run so reports arriving meanwhile are not lost.
* **Incremental:** `insDate` windows from the cursor with a 60-minute overlap.
* **Late reports:** once a day the last *backfill_days* issue days are re-read.
* **Details:** budgeted `queryInvoiceData` calls add VAT breakdown, addresses and bank account.
* **Idempotency:** NAV data reports are upserted by `source_key`
  (supplier tax number · invoice number · batch index · transaction id · index · insDate).
* **Failures:** auth/config errors back off 24 h and set the connection to `error`; maintenance and
  transient errors back off progressively; a per-connection lock prevents overlapping runs. Upload, OCR
  and approval never depend on NAV availability.
* **Required server configuration (Edge Function secrets):** `NAV_SOFTWARE_DEV_TAX_NUMBER` (or
  `NAV_SOFTWARE_ID`), `NAV_SOFTWARE_DEV_NAME`, `NAV_SOFTWARE_DEV_CONTACT`; optional
  `NAV_SOFTWARE_NAME`, `NAV_SOFTWARE_VERSION`, `NAV_SYNC_BUDGET_SECONDS`, `HOTELCARE_APP_URL`.

## 5. OCR and deterministic checks (`process-purchase-invoice`)

* Gemini-first routing with OpenAI fallback through the existing `fetchGeminiFirstChat`
  (`containsSensitiveData: true`, i.e. Gemini only when `GEMINI_PAID_DATA_PROCESSING_CONFIRMED=true`).
* Extended extraction: document kind (normal, receipt, pro forma, advance, final, corrective, credit
  note, cancellation), reference invoice, service period, amount due / previous balance / advance /
  discount / rounding, supplier bank account, field confidence, multi-invoice detection.
* **No invented VAT:** the old 27 % default is removed. VAT lines come only from the document (or a single
  rate derived from printed net and VAT totals). Undetected currency is stored as HUF with
  `currency_source = 'default'` and treated as unknown by reconciliation until a person confirms it.
* A focused second pass re-reads the totals block when material checks fail.
* The legal company is matched only against configured companies (tax number first, then configured
  aliases); unknown buyers are **not** auto-created; a company/property mismatch is flagged, and the
  company printed on the invoice always wins.
* Duplicates: normalized supplier tax number + invoice number, and identical file hash.
* Jobs are claimed atomically; transient AI/storage errors are re-queued and recovered by the worker.

## 6. Reconciliation (deterministic and explainable)

Only processed/verified documents participate. Each decision carries a rule trace (“Why?”).

1. Buyer scope by the **buyer tax number on the document** (overrides the assignment).
2. Manual decisions (controlling) win.
3. Not expected in NAV: receipts, pro forma documents, foreign suppliers without a Hungarian tax number.
4. NAV customer tax number must belong to the legal company.
5. Grouping by supplier tax number + normalized invoice number (OCR-tolerant), one primary document.
6. Comparison: type, currency, gross/net/VAT within tolerance, issue date within tolerance →
   `exact_match`, `probable_match` or `data_mismatch` (never silently overwritten).
7. Correction chains (MODIFY/STORNO) → `correction_chain`; competing reports → `competing_nav_candidates`;
   second document → `duplicate_document`.
8. Identifier-based fuzzy matches only (number distance ≤ 1; missing number with tax + gross + date;
   missing tax with number + gross) — **never by supplier name and amount alone**.
9. Unmatched documents become `document_only` only after a completed history sync covering the issue date
   **and** the reporting-delay window; otherwise `nav_sync_pending`.

Statuses: `not_checked`, `exact_match`, `probable_match`, `document_only`, `data_mismatch`,
`duplicate_document`, `competing_nav_candidates`, `correction_chain`, `nav_sync_pending`,
`not_expected`, `manual_resolution` (NAV side additionally `nav_only`).

**Gap filling:** for confirmed matches, empty document fields are filled from NAV with provenance;
differing values become open conflicts for controlling (accept NAV value / keep document value with a
note). Approved invoices are never changed.

## 7. Missing documents (NAV-only detection)

A NAV invoice is listed as missing when it (a) belongs to a configured legal company (customer tax
number), (b) comes from a connection marked *use for reconciliation* whose history sync is complete,
(c) has no matching document after the full hierarchy, and (d) was issued on/after the
*reconciliation start date*. A follow-up is opened automatically; it is closed automatically when a
matching document arrives, or by controlling as *not required* (with a reason). Follow-ups can be
assigned, requested from the property, noted, exported and are summarized in the daily e-mail.

## 8. Workflow and roles

Upload → OCR → automatic checks → NAV check → verification (reviewer) → submit → controlling approval →
final register. Reception/back office upload; reviewers verify and submit; controllers approve/reject
in scope; chief controllers reopen; organization admins configure the module, legal companies, NAV and
finance access. A NAV match or approval is **not** proof of payment.

## 9. UI

Tabs: Overview · Upload · All invoices · NAV reconciliation · Missing documents · Approvals · Analytics ·
Settings (Legal entities, Categories, Cost centres, Finance access, NAV, Module rollout, Historical import).
English and Hungarian translations (`src/lib/purchase-invoice-nav-translations.ts`). Analytics are
computed **one currency at a time**; exports are real `.xlsx`.

## 10. Go-live checklist (organization administrator)

1. Open `/<organization>/purchase-invoices` as an organization admin (while the module is disabled the
   menu item is hidden and the page shows only the rollout settings; invoice data stays hidden by RLS).
   Enable the module, choose roles, set tolerances, reporting delay and the **reconciliation start
   date**, approval rules and daily summary recipients (later: Settings → Module rollout).
2. Settings → Legal entities: correct legal name, Hungarian tax number, registered address, properties,
   default cost centre/category for every company.
3. Settings → Finance access: assign reviewer / controller / chief controller profiles and scopes.
4. Supabase secrets: set the `NAV_SOFTWARE_*` values; decide `GEMINI_PAID_DATA_PROCESSING_CONFIRMED`.
5. Per company: create a NAV technical user with *invoice query* permission (test system first),
   Settings → NAV → add connection (test), history start date, save credentials, **Test connection**,
   enable, check runs; then repeat for production with the company's authorization and turn on
   *Use for reconciliation*.
6. Optional: Settings → Historical import of the existing register before the start date.

## 11. Deployment

1. Apply the migration (it creates Vault secrets and cron jobs; all connections start disabled and the
   module starts disabled per organization except the existing pilot account).
2. Deploy functions: `process-purchase-invoice`, `nav-connection-admin`, `nav-sync`,
   `reconcile-purchase-invoices`, `pi-daily-summary`, `pi-history-import` (`config.toml` sets `verify_jwt`).
3. Set the Edge Function secrets listed above.
4. Smoke test with the NAV **test** environment before any production connection.

## 12. Tests

* `src/test/purchaseInvoices/*` — NAV protocol (official signature/hash examples, XSD-valid requests),
  parsing, client retries/pacing, sync planning, validation, reconciliation, gap fill, approval gate,
  sync/reconcile runners with an in-memory client, and the acceptance scenario (20 NAV invoices,
  17 matching documents, 1 wrong amount, 1 duplicate → 3 NAV-only, 1 mismatch, 1 duplicate, no exception
  approvable). Synthetic fixtures only.
* `supabase/tests/purchase_invoice_nav_*.sql` — migration on the replayed schema (applied twice), RLS,
  credential secrecy, guards, storage scoping, writers, locks; rollback and roll-forward.
* CI: `.github/workflows/purchase-invoice-nav-ci.yml`.

## 13. Számlázz.hu inbound (research only, not implemented)

Számlázz.hu documents a **push** feed for incoming invoices in its financial data connection
(“Pénzügyi adatkapcsolat”, version 3.0): it can forward invoices stored in the invoicing account to a
receiving URL as XML (`szamlabe`), optionally with the PDF, and NAV-fetched invoices only when the
account owner enables that forwarding. The receiver must answer with a matching `szamlabevalasz` id.
There is no documented pull/query endpoint in that section. Because it requires a public receiving
endpoint, per-account registration and duplicates handling against NAV data, it was not built; the
`source = 'supplier_feed'` value is reserved for it. Reference:
<https://docs.szamlazz.hu/penzugyi-adatkapcsolat/bejovo-szamlak>.

## 14. Known limitations

* Live NAV authentication has not been verified (no credentials were available during development).
* PDFs are sent to the model as file parts; very large PDFs (> 7.5 MB) are rejected with guidance.
* The browser keeps up to 20 upload jobs per session; the OCR recovery worker processes jobs left behind.
