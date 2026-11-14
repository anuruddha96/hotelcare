# Számlázz.hu: multiple legal companies in HotelCare

HotelCare's PMS guest invoicing is separate from HotelCare's own SaaS subscription billing.

## What is now supported in this PR

* An administrator can visit **Account menu → Legal companies & invoicing** at `/:organizationSlug/admin/invoicing`.
* Register multiple **legal issuing companies**, including the exact legal name, Hungarian tax number, registered address, billing email, bank details, optional invoice prefix and invoice language.
* Connect each company either to **its own Számla Agent key**, or to an **already approved delegated-invoicing dedicated user** (username/password).
* Bind one issuer to each hotel. Only the **hotel's assigned and enabled** issuer can issue new guest invoices.
* Credentials are encrypted at rest with AES-256-GCM; no credential is returned by the admin API. The browser sends credentials once over HTTPS to the authenticated admin Edge function. There is no direct client access to the credential tables.
* Editing a company **disables** it until explicitly reviewed and re-enabled. Test/live are *operator labels*, **not** an API control that toggles the Számlázz.hu account itself.
* Reception can see the legal issuer (without its credentials) and select language, due date, and electronic invoice; still supports proforma, invoice, PDF, cancellation/storno and payment registration.
* Issued invoice records keep their original issuer_id for PDF, storno, payment and audit after a hotel is reassigned. Legacy invoice records without issuer_id still use legacy `SZAMLAZZ_AGENT_KEY` for retrieval if available. New invoice numbers are unique **per issuer**, while old unmapped invoices keep legacy uniqueness per organization.

## Mandatory secrets and rollout order

1. Generate a random 32-byte symmetric encryption key **outside GitHub or chat**, for example using `openssl rand -base64 32`.
2. Set Supabase **Edge Functions secret** `SZAMLAZZ_CONFIG_ENCRYPTION_KEY` to the generated base64 string. Treat this as a critical long-lived secret. Back it up in approved secure storage; losing it makes encrypted provider credentials unusable.
3. Apply migration `supabase/migrations/20261114210000_invoicing_company_accounts.sql` **before** deploying changed invoicing functions or frontend.
4. Deploy the Edge functions `invoice-issuers-admin` and updated `szamlazz-invoice` and shared code. Check JWT verification configuration and production access.
5. Deploy the frontend only after schema and functions pass authenticated role-scoping, test/live, and provider API tests. Until then, users should continue using the existing feature state.
6. In the Számlázz.hu website, create a dedicated **TEST** account with no previous live invoices, and turn on **Tesztüzem** before obtaining its key. Do not touch the existing production accounts while testing. The HotelCare TEST label does *not* enable test mode on Számlázz.hu. Test invoices can still be live if the incorrect API credentials are entered.
7. From HotelCare's administrator account: select the correct organization/hotel, add the legal company, fill registered details, enter the Agent key in the password field, save, assign the issuer to a test hotel, then explicitly enable it after provider test-mode verification.
8. On a test reservation: view the selected issuer; issue a proforma, then an e-invoice; download the PDF and verify TEST watermark; test payment registration and storno, then review `guest_invoices`, `invoice_issuer_audit` and `reservation_events` for correct issuer and hotel isolation.
9. Before **LIVE** activation have the accountant approve tax codes, invoice dates, fulfillment rules, local tax/IFA treatment, foreign currency/MNB rate, invoice prefix, and Számlázz.hu's NAV Online Számla connection. Only the admin may enable it with explicit acknowledgment. Do not infer NAV status from the checkbox.
10. Test rotating credentials, disabling company, hotel reassignment, access denial (other org, receptionist, hotel manager), and retrieving/stornoing invoices from a previously assigned legal company.

## Delegated invoicing (issuing on behalf of a different supplier)

This is distinct from giving different hotels separate issuing accounts. The company issuing *for* a supplier needs authorization, and the supplier controls its Számlázz.hu account.

* Establish and approve the delegated relationship in Számlázz.hu's UI for **existing** supplier accounts, or use its `action-agent_ceg_mb` API for automated onboarding. That special onboarding API needs a separate licence from Számlázz.hu support and is **not** implemented in this PR.
* After the supplier approves, use a **dedicated username/password belonging to one supplier account only**. Users with multiple linked accounts return Agent error 164. The approved supplier's exact tax number and an agreed uppercase alphanumeric invoice prefix (1–5 characters) are essential.
* For LIVE supplier invoicing the supplier's NAV Online Számla connection must be completed. HotelCare's setup form only records admin confirmation; it cannot validate external approval/NAV state automatically in this PR.
* Reference: https://docs.szamlazz.hu/third-party-invoicing/ and https://docs.szamlazz.hu/third-party-invoicing/szamla-agent

## APIs

`POST /functions/v1/invoice-issuers-admin` with the logged-in JWT:
`{ "action": "list"|"save"|"enable"|"disable"|"assign"|"unassign", "hotel_id": "..." }`
— the `save` request additionally contains `company`; `enable` needs explicit confirmations. No secret in list responses. Requires organization-level admin role and current hotel access. The server determines the organization's slug from the authorized hotel, never from browser input.

`POST /functions/v1/szamlazz-invoice` has original guest invoice actions:
`status`, `prepare`, `issue` (`proforma` or `invoice`), `storno`, `payment`, `pdf`.
New invoices require enabled issuer for reservation's hotel. The issue request also accepts `e_invoice`, `due_date`, and `language`.

## Limitations / controls not yet automated

* No background sync of supplier registration, delegated invitations/approval, actual NAV state, or Számlázz.hu's actual TEST/LIVE setting.
* No real provider credential validation until a test invoice is issued; no provider documents are issued by the admin configuration page.
* No automatic accounting-rule validation. Accommodation 5%, service 27%, and city tax THK remain *editable suggestions*, not universal legal tax advice.
* No provider invoice template preview or real-time reconciliation dashboard yet. Existing invoice list/PDF/receipt functions remain.
* This migration/code is **not applied to Supabase merely by merging the PR**. Verify deployment pipeline, migrations, secrets and actual provider tests separately.

## Previous single-key backend

The previous flow used the single `SZAMLAZZ_AGENT_KEY` Edge function secret for every hotel. That key is **not** used for issuing NEW invoices after the multi-company feature is deployed. It remains a fallback for historical invoices created before `issuer_id` existed.
