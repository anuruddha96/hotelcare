# HotelCare PMS Billing, Payments, Számlázz.hu and NAV Architecture

Status: architecture baseline / implementation reference  
Date: 2026-09-24  
Scope: HotelCare PMS reservations, folios, payments, fiscal documents, Számlázz.hu Agent integration, NAV-facing readiness  
Safety: documentation only; no production billing behaviour is activated by this document.

## 1. Goal

HotelCare should support a complete, hotel-friendly reservation account similar in capability to a mature PMS, but with a simpler UI:

- reservation/group account with charges, payments, outstanding balance and document history;
- configurable pre-defined services/products that reception can add to a guest/room/group;
- split/group folios and transfer of charges;
- cash, card terminal, online card, bank transfer, coupon and configurable payment methods;
- invoice, pro forma invoice, advance invoice, final invoice, receipt and the related reversal/correction workflows;
- PDF/XML retrieval, document e-mailing and payment/credit registration;
- Számlázz.hu as the first fiscal-document provider;
- NAV compliance state visible to the hotel;
- each HotelCare organization/property isolated from every other tenant.

Do not copy the dense Previo UI. The target interaction is: Reservation -> Account -> Charges / Payments / Documents.

## 2. Important architectural separation

Számlázz.hu is a fiscal-document provider, not HotelCare's general payment-processing engine.

HotelCare should own the canonical operational ledger:

1. reservation and guest;
2. folio(s);
3. charge lines;
4. payments;
5. payment allocation;
6. fiscal documents and their state;
7. reconciliation/audit events.

External adapters then perform separate jobs:

- Fiscal adapter: Számlázz.hu Agent (invoice, pro forma, advance/final invoice, receipt, storno, PDF/XML query, taxpayer query, credit entry).
- Payment adapters: terminal/online payment providers as added later.
- Cash/bank transfer/SZÉP/coupon: recorded as payment methods in HotelCare even when there is no API capture.
- NAV: invoices are reported through the configured invoicing provider when that provider/account connection is correctly configured. Receipt reporting must be treated as a separately verified capability.

This prevents HotelCare from being locked to one payment acquirer and keeps fiscal documents consistent with the actual guest ledger.

## 3. Multi-tenant and legal-entity model

Do not assume "one tenant = one invoice issuer".

Add an explicit legal billing entity:

### billing_entities
- id
- organization_slug
- legal_name
- tax_number
- eu_tax_number
- country
- postal_code
- city
- address
- bank_name / bank_account
- default_currency
- default_invoice_language
- is_active
- created_at / updated_at

### billing_entity_properties
Maps one or more HotelCare hotels/properties to the legal entity that issues their documents.

### fiscal_provider_connections
- id
- billing_entity_id
- provider = 'szamlazz_hu'
- environment = test | live
- secret_ref (never raw Agent key)
- status = draft | testing | active | suspended | error
- connection_verified_at
- invoice_prefix
- receipt_prefix
- e_invoice_enabled
- default_invoice_template
- default_receipt_template
- nav_invoice_reporting_status
- nav_receipt_reporting_status
- last_success_at / last_error_at / last_error_code
- settings jsonb

Credentials must never be placed in browser code, normal RLS-readable rows, logs or Git. Store only a secret reference; retrieve the Agent key server-side.

The Számlázz.hu docs recommend Agent-key authentication. Agent keys do not expire until deleted, have the same account permissions and must be treated like passwords.

## 4. Canonical PMS financial schema

The existing guest_folios table is too small to become the permanent accounting ledger. Preserve compatibility, but introduce a normalized model.

### reservation_folios
- id
- organization_slug
- hotel_id
- reservation_id
- group_reservation_id nullable
- folio_type = master | room | guest | company
- owner_guest_id nullable
- room_id nullable
- currency
- status = open | closed
- opened_at / closed_at
- created_by

A group reservation can have one master folio plus child room/guest folios. Charges may be moved before fiscal-document finalization.

### service_catalog_items
Tenant/legal-entity/property configurable:
- name and translations
- category
- unit
- default quantity
- default gross or net price
- VAT code/rate
- city-tax/tourism-tax classification where applicable
- revenue/accounting code
- refund item mapping
- stock tracking optional
- active dates
- allowed hotels
- editable-price flag
- requires manager approval flag

Examples from the operational reference: accommodation, breakfast, city/accommodation tax, parking, spa, minibar, museum ticket, penalties and refund lines. Do not hard-code the VAT treatment of these examples; rates/codes must be configured and accountant-approved.

### folio_lines
- id
- folio_id
- service_catalog_item_id nullable
- source_type = room_rate | manual | minibar | restaurant | parking | tax | discount | adjustment | other
- description
- service_date / service_period_from / service_period_to
- room_id / guest_id nullable
- quantity
- unit
- currency
- net_unit_price
- net_total
- vat_code
- vat_rate nullable
- vat_total
- gross_total
- status = open | invoiced | reversed | voided
- origin_line_id / reversal_line_id
- fiscal_document_line_id nullable
- created_by / created_at
- adjustment_reason

Use decimal/numeric arithmetic, never floating point. Amounts sent to Számlázz.hu must already be calculated consistently: the API validates line arithmetic and does not calculate it for HotelCare.

Discounts should be represented as explicit negative folio lines with the same VAT treatment as the service being discounted.

### payments
- id
- organization_slug / hotel_id / billing_entity_id
- reservation_id / folio_id
- amount
- currency
- method
- provider
- provider_transaction_id
- status = pending | authorized | captured | recorded | failed | refunded | reversed
- received_at
- exchange_rate + exchange_rate_source if required
- created_by
- notes

Suggested configurable payment methods:
cash, card_terminal, online_card, bank_transfer, coupon, szep_otp, szep_mbh, szep_kh, other.

### payment_allocations
A payment can be split across folios/documents. A folio can be settled by multiple payments.

### fiscal_documents
- id
- billing_entity_id / organization_slug / hotel_id
- reservation_id / folio_id
- provider
- document_type = invoice | proforma | advance_invoice | final_invoice | corrective_invoice | storno_invoice | receipt | storno_receipt
- status = draft | queued | submitted | issued | failed | reversed | deleted
- provider_document_number
- order_number
- external_identifier
- caller_identifier
- original_document_id nullable
- issue_date / performance_date / due_date
- payment_method_label
- currency / exchange_rate / exchange_rate_source
- net_total / vat_total / gross_total / outstanding
- buyer snapshot (name/address/tax IDs/email) as immutable issue-time data
- provider_response_code / provider_response_message
- pdf_storage_path
- xml_storage_path
- issued_by / issued_at

### fiscal_document_lines
Immutable snapshot of the exact items sent to the provider.

### fiscal_document_events
Append-only audit log for create/query/send/payment/storno/failure/manual intervention.

### cashier_sessions
For future PMS completeness:
- user/property/shift
- opening cash
- cash movements
- closing counted cash
- expected cash
- variance
- manager acknowledgement

## 5. Számlázz.hu Agent adapter

Use one server-side integration boundary, not direct browser calls.

Suggested Edge Function/service: fiscal-szamlazz

Supported actions:
- verify_connection
- create_invoice
- create_proforma
- create_advance_invoice
- create_final_invoice
- create_corrective_invoice
- reverse_invoice
- register_credit_entry
- query_invoice_pdf
- query_invoice_xml
- delete_proforma
- create_receipt
- reverse_receipt
- query_receipt
- send_receipt
- query_taxpayer

The Agent uses HTTPS POST with multipart/form-data to https://www.szamlazz.hu/szamla/ and selects operations by form-field name. Prefer structured XML response version 2 where available.

Use the official XSDs to validate generated XML before submission.

## 6. Idempotency, retries and session handling

This is a P0 safety requirement.

Invoices:
- use HotelCare reservation/document identifiers as rendelesSzam where appropriate;
- also send a unique szamlaKulsoAzon so documents can be queried later by HotelCare ID;
- store the returned provider document number before considering the operation complete;
- query by external/order identifier after an ambiguous network result before creating another document.

Receipts:
- always generate and persist a unique hivasAzonosito; Számlázz.hu documents this specifically as duplicate protection.

Retries:
- never blindly retry until success;
- Számlázz.hu explicitly limits the same request to a maximum of five attempts;
- validation/business-data errors go immediately to human-action-required;
- transient requests go through a bounded outbox queue with attempt count, next_attempt_at and terminal failure state.

Sessions:
- calls are server-side;
- persist/reuse JSESSIONID per connection where practical;
- Számlázz.hu removes an inactive session after 90 minutes, so the connector must transparently establish a new session when necessary.

## 7. Invoice/document workflow

### Invoice
1. Freeze selected open folio lines into a document draft.
2. Validate buyer data, item VAT data, arithmetic, dates, currency and billing entity.
3. Confirm payment method/due date/e-invoice/email options.
4. Submit once through outbox.
5. Store provider number, XML response and PDF.
6. Mark included folio lines invoiced.
7. If already paid, register the corresponding payment/credit entry at Számlázz.hu.
8. Reconcile the provider outstanding amount with HotelCare allocations.

### Pro forma
- does not close/invoice the underlying folio;
- may later be deleted where allowed;
- can be referenced when the invoice is created.

### Advance/final invoice
Support them explicitly rather than treating an advance payment as a normal payment receipt. The provider rules allow a prepayment invoice followed by a final invoice, with important linkage constraints. The UI must guide the receptionist instead of letting arbitrary combinations be issued.

### Storno/correction
Never delete an already-issued invoice from HotelCare. Use provider reversal/corrective workflows and keep the original and reversing documents linked and immutable.

### Receipt
- use the provider's receipt operation;
- support multiple tender lines only when the sum equals the receipt gross total;
- store caller ID, provider receipt number, response XML and PDF;
- reversal creates a separate storno receipt;
- receipt reporting readiness must be checked before HotelCare claims compliance.

## 8. NAV-specific readiness

Invoice reporting:
- NAV requires invoice data reporting for invoices subject to the Hungarian invoicing rules.
- When Számlázz.hu is the issuing system and its NAV connection is properly configured, HotelCare should rely on the provider for submission rather than send a second duplicate invoice report.
- HotelCare must still show provider/NAV readiness, errors and reconciliation state to the tenant.

Taxpayer lookup:
- use the Számlázz.hu taxpayer-query operation to validate Hungarian VAT numbers and optionally prefill verified company data before B2B invoice creation.

Receipt reporting:
- as of 2026-09-24, NAV's general reporting obligation for manual and computer-generated receipts has been effective since 2026-09-01.
- NAV states that reporting is due within 3 calendar days, aggregated daily by tax rate, and can be manual (KOBAK) or M2M.
- NAV announced a transition/no-penalty period through 2026-12-31.
- the current Számlázz.hu Agent documentation says its computer-generated receipts are in scope and that Számlázz.hu is working on automating this reporting.
- therefore HotelCare MUST NOT mark receipt NAV reporting "ready" merely because receipt issuance works. Activation requires a verified provider/account reporting path. Until verified, show a compliance warning/status.

This status must be configurable and testable independently for every billing entity.

## 9. Currency and rounding

- Support HUF and Számlázz.hu-supported foreign currencies.
- For foreign-currency invoices, store the exchange-rate source and issue-time rate used for VAT/accounting. The Agent supports MNB-based exchange-rate handling.
- Do not recalculate an issued document later using a new exchange rate.
- HUF invoice/receipt arithmetic must follow provider rounding rules.
- HUF receipts have stricter gross/net/VAT consistency requirements; calculate and validate before submission.

## 10. Reservation Account UX

Target layout:

### Header
Guest/group + reservation number + stay + room(s)

Large compact financial summary:
- Charges
- Paid
- Balance due
- Currency
- fiscal warning only when action is needed

Primary actions:
- + Add charge
- Take payment
- Issue document

### Charges
A clean table/timeline:
Service | Room/guest | Date | Qty | VAT | Gross | Document status

"Add charge" opens a searchable service catalogue with favorites/recent items. The receptionist chooses an item and usually only changes quantity/price when permission permits.

### Payments
Payment history with:
Method | Amount | Currency | Date | Status | Reference

"Take payment" supports split tenders. Payment collection and invoice issuance are separate actions.

### Documents
Invoice / Pro forma / Advance / Final / Receipt cards with:
document number, type, total, payment status, NAV/provider status, PDF, e-mail, reverse/correct actions subject to permissions.

### Group reservation
Support:
- master account for the whole group;
- per-room/guest sub-folios;
- transfer selected charges;
- invoice all rooms to one company;
- invoice one/some rooms separately;
- one group payment or multiple room payments;
- no accidental double billing after transfer/invoice.

## 11. Permissions

Suggested capability permissions rather than role-name-only logic:
- folio.view
- folio.charge.add
- folio.charge.adjust
- payment.record
- payment.refund
- fiscal.invoice.issue
- fiscal.proforma.issue
- fiscal.receipt.issue
- fiscal.reverse
- fiscal.config.manage
- cashier.close
- fiscal.audit.view

Reception may be allowed to add standard charges and take payments. Storno/refund/manual tax override should be separately permissioned and auditable.

## 12. End-of-day / night-audit integration

Before business-day close, surface:
- open guest balances;
- checked-out reservations with unresolved balance;
- unallocated payments;
- failed/unknown fiscal-document calls;
- unsent/reconciliation-required documents;
- open cashier sessions/variances;
- receipt NAV readiness/reporting warnings;
- exchange-rate/document validation issues.

HotelCare must never silently "fix" an issued fiscal document.

## 13. Delivery pipeline

### Phase A - Financial core
- canonical folios/folio lines
- service catalogue with VAT metadata
- payment ledger + allocation
- group/master/sub-folio model
- reservation Account UX
- migration/compatibility from guest_folios

### Phase B - Számlázz.hu configuration
- billing entities/property mapping
- secure Agent-key connection
- test/live switch
- invoice/receipt prefixes/templates/language
- connection tests and health UI

### Phase C - Invoice documents
- invoice + pro forma
- PDF/XML storage/query
- email
- taxpayer lookup
- credit/payment registration
- idempotency/outbox/error centre

### Phase D - Hotel advance flows
- advance invoice + final invoice
- deposits/prepayments
- partial payments
- cancellation/storno/correction

### Phase E - Receipts
- create/query/send/reverse receipt
- split payment/tender mapping
- receipt NAV readiness gate
- no compliance claim until provider reporting verified

### Phase F - Payments
- cashier/cash
- terminal adapter
- online payment adapter
- refunds
- SZÉP/bank-transfer reconciliation
- payment links where supported

### Phase G - PMS close/reporting
- cashier close
- night-audit financial controls
- VAT/payment/revenue/outstanding reports
- provider reconciliation and compliance dashboard

## 14. P0 implementation acceptance criteria

Before live fiscal issuing for any tenant:
- property resolves to exactly one active billing entity;
- billing entity has a verified provider connection;
- secrets are server-only;
- tenant A cannot read/use tenant B's provider connection or documents;
- every issue call is idempotent and auditable;
- VAT/net/gross calculations pass deterministic tests;
- failed calls cannot create duplicate documents by automatic retry;
- issued documents are immutable locally;
- PDF/XML retrieval is access-controlled;
- test/live environment is visually explicit;
- invoice and receipt NAV readiness are shown separately;
- group folio cannot double-charge after transfer;
- payment total and balance reconcile exactly.

## 15. Current HotelCare gap noted 2026-09-24

Current guest_folios is a useful prototype, but it records essentially description, amount, charge type and date. The current UI can add a charge/payment, but it does not model VAT, quantities, payment methods/allocations, fiscal documents or immutable issued-document state. Do not extend this with scattered columns. Implement the normalized financial domain above and keep guest_folios as a compatibility layer during migration.

## 16. External references reviewed

Számlázz.hu Agent:
- https://docs.szamlazz.hu/agent/basics/what-is
- https://docs.szamlazz.hu/agent/basics/how-does
- https://docs.szamlazz.hu/agent/basics/authentication
- https://docs.szamlazz.hu/agent/basics/error-handling
- https://docs.szamlazz.hu/agent/basics/session-cookie
- https://docs.szamlazz.hu/agent/basics/security
- https://docs.szamlazz.hu/agent/basics/sending-requests
- https://docs.szamlazz.hu/agent/category/generating-invoice
- https://docs.szamlazz.hu/agent/generating_invoice/request
- https://docs.szamlazz.hu/agent/generating_invoice/response
- https://docs.szamlazz.hu/agent/generating_invoice/xml
- https://docs.szamlazz.hu/agent/generating_invoice/settings-and-rules
- https://docs.szamlazz.hu/agent/generating_invoice/settings_and_rules/document-types
- https://docs.szamlazz.hu/agent/generating_invoice/settings_and_rules/travel-agency
- https://docs.szamlazz.hu/agent/generating_invoice/settings_and_rules/vat-rates
- https://docs.szamlazz.hu/agent/generating_invoice/settings_and_rules/rounding
- https://docs.szamlazz.hu/agent/generating_invoice/settings_and_rules/currencies
- https://docs.szamlazz.hu/agent/generating_invoice/settings_and_rules/invoice-template
- https://docs.szamlazz.hu/agent/generating_invoice/settings_and_rules/order-number
- https://docs.szamlazz.hu/agent/generating_invoice/settings_and_rules/discount
- https://docs.szamlazz.hu/agent/generating_invoice/settings_and_rules/email-notification
- https://docs.szamlazz.hu/agent/generating_invoice/settings_and_rules/data-erasure-code
- https://docs.szamlazz.hu/agent/category/reversing-invoice
- https://docs.szamlazz.hu/agent/category/registering-credit-entry
- https://docs.szamlazz.hu/agent/category/query-document-pdf
- https://docs.szamlazz.hu/agent/category/query-document-xml
- https://docs.szamlazz.hu/agent/category/deleting-a-pro-forma-invoice
- https://docs.szamlazz.hu/agent/category/generating-a-receipt
- https://docs.szamlazz.hu/agent/generating_receipt/request
- https://docs.szamlazz.hu/agent/generating_receipt/response
- https://docs.szamlazz.hu/agent/generating_receipt/xml
- https://docs.szamlazz.hu/agent/generating_receipt/settings_and_rules/nav-data-reporting
- https://docs.szamlazz.hu/agent/category/reversing-a-receipt
- https://docs.szamlazz.hu/agent/category/querying-a-receipt
- https://docs.szamlazz.hu/agent/category/sending-a-receipt
- https://docs.szamlazz.hu/agent/category/querying-taxpayer

NAV:
- https://nav.gov.hu/Elethelyzetek-adozasa/vallalkozas/Regisztracio-az-Online-Szamla-rendszerben
- https://nav.gov.hu/ado/enyugta/nyugtaadat-szolgaltatas
- https://nav.gov.hu/print/sajtoszoba/hirek/A_NAV_segit_negy_honapos_atallasi_idoszak_a_nyugtaadat-szolgaltatasban

Re-check vendor and NAV documentation before each compliance release because fiscal requirements and provider capabilities can change.
