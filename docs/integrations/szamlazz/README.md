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

**Official seller identity:** The legally registered seller name, address, tax number and NAV details shown on the Számlázz.hu invoice come from the actual connected **provider account**. Editing the corresponding profile in HotelCare does not modify the provider account. Verify the two match before enabling.

## Deployment and rollout order

1. Apply `supabase/migrations/20261114210000_invoicing_company_accounts.sql` to create company profiles, hotel assignments, and audit tables.
2. Apply `supabase/migrations/20261114222000_invoice_issuer_vault_key.sql`. This generates a unique **32-byte AES-GCM encryption key directly inside Supabase Vault** if absent. The key is stored encrypted by Vault and is retrievable **only** by the service role's protected RPC. No plaintext key is committed to GitHub, passed through chat, or typed into the browser.
3. Deploy `invoice-issuers-admin` and `szamlazz-invoice` plus their shared code. Both verify the user JWT and hotel authorization in application code; gateway JWT checking remains off for compatibility with the current Supabase Auth signing mode. Test authorization on both functions.
4. Deploy the admin interface and reception invoice editor only after steps 1–3.
5. Use the company account's own Számlázz.hu Agent key only inside the administrator form. The app encrypts the key with the Vault-held key before storing it. It never reveals keys to browser readers or other companies.
6. For external provider testing, create a **separate Számlázz.hu test-mode account**; confirm actual **Tesztüzem** before issuing any document. The HotelCare TEST label does *not* change provider account mode; no account may be assumed to be in test mode from the label alone.
7. In HotelCare Admin: select a hotel, add legal company, enter Agent key, save, assign company to test hotel, then explicitly enable.
8. On an authorized test reservation: issue a proforma and an e-invoice, download a PDF and verify TEST watermark, test payment registration/storno and audit records.
9. Before **LIVE** activation have the accountant approve tax codes, invoice dates, fulfillment rules, local IFA treatment, currency/MNB rate, prefix, and Számlázz.hu's NAV connection. Live activation requires deliberate admin acknowledgment; a checkbox cannot verify provider state.
10. Test credential rotation, company reassignment, historical invoice retrieval, role denial, and other-organization isolation.

**Key management:** The Vault encryption key must never be rotated without re-encrypting all existing `invoice_issuers` credentials. Supabase Vault's root key is stored outside your database; database backups retain encrypted secrets. The `invoice_credential_key_internal()` RPC is service-role-only. Do **not** create a conflicting `SZAMLAZZ_CONFIG_ENCRYPTION_KEY` Edge Function secret; this implementation uses Vault instead.

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
