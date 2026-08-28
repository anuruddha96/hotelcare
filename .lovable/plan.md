# Payments: module tiers, one-screen picker, VAT and proper invoices

Three parts: a smarter price model (Business Intelligence vs. BI + Automation, Housekeeping, Maintenance on request), a compact one-screen module picker for top management, and correct 27% VAT plus company details on Stripe invoices.

## 1. Pricing model

Per hotel, per month, all prices VAT-exclusive and admin-editable:

- **Revenue — Business Intelligence**: €15 / room. Analytics, pickup, competitor and market intelligence, recommendations — no automatic price changes.
- **Revenue — BI + Automation**: €22 / room. Everything above plus the automated pricing engine. Chosen instead of BI, not on top of it.
- **Housekeeping / Operations**: €6 / room (RD Hotels and Excellentia Group both €6 until an admin changes it; SLNT keeps its own current price).
- **Maintenance**: no list price — shown as "Custom pricing", with a "Request a quote" button instead of a checkout tick.

Current stored prices (RD Hotels €22 revenue, €6 housekeeping; SLNT €22 / €3) are kept; the €22 becomes the automation tier and €15 becomes the new BI tier.

Rules:
- Picking Automation for a hotel automatically deselects BI for that hotel (and vice versa) — they are one choice with two levels.
- The percentage-of-revenue mode that already exists stays available as an admin option for the Revenue module; when it is on, the tier choice shows the % basis instead of a per-room price.

## 2. Payments screen for top management

Replace the current long scrolling list with one compact view:

- **Top strip**: trial state ("Free trial — full access until 21 November 2026, nothing is charged before that date"), payment-method state, next charge date, and monthly total.
- **One card per hotel**, side by side on desktop, stacked on mobile. Inside each card, small toggle-buttons (not full rows): `Housekeeping`, `Revenue BI`, `Revenue BI + Automation`, `Maintenance`. Each button shows its per-room price and turns solid when selected; active paid modules carry a small "Active" tick and cannot be accidentally unticked without confirmation.
- Room count and the computed line price appear under the buttons, e.g. `21 rooms x €22 = €462 / month`.
- **Sticky summary bar** at the bottom: net total, 27% VAT, gross total, and a single "Continue to checkout" button. No scrolling between choosing and paying.
- **Invoices tab**: list of past Stripe invoices (date, period, net, VAT, gross, status) with a link to the PDF, plus "Manage payment method" (Stripe portal).
- Maintenance opens a short "Request pricing" dialog instead of adding a line.

## 3. VAT and invoice company details

- Checkout is created with **Stripe Tax enabled** and prices marked VAT-exclusive, so 27% Hungarian VAT is added on top of the net amount and shown on the invoice. If a business customer in another EU country gives a valid EU VAT number, Stripe applies reverse charge automatically — which is the legally correct behaviour and still "VAT handled properly".
- The reason company details cannot be entered today: the checkout session is created without billing-address or tax-ID collection and with `automatic_tax` disabled, so Stripe never asks for them. Fix: enable `billing_address_collection: 'required'`, `tax_id_collection: { enabled: true }`, `customer_update: { name, address }`, and invoice creation on the subscription — then company name, address and tax number are collected at checkout and printed on every invoice.
- The app also stores company name / address / tax number per organization so they can be pre-filled and edited later from the Payments screen, and pushed to the Stripe customer.
- All totals in the UI are shown as net + VAT + gross so the amount on the card matches the invoice.

## 4. Admin side (Admin → Billing)

- Price fields per organization for: Housekeeping, Revenue BI, Revenue BI + Automation; plus the existing trial and percentage settings.
- Maintenance marked "custom / on request" with an optional agreed price per organization.
- VAT rate field (default 27%) and the billing company details block.

## Technical notes

- `billing_settings` gains: `revenue_bi_price_cents` (1500), `revenue_automation_price_cents` (existing 2200 value moves here), `maintenance_pricing_mode` ('custom'), `maintenance_price_cents`, `vat_percent` (27), and company fields (`billing_company_name`, `billing_address_*`, `billing_tax_id`). Migration includes GRANTs and keeps existing RLS.
- `module_subscriptions.module` widens to `'revenue_bi' | 'revenue_automation' | 'operations' | 'maintenance'`; existing `'revenue'` rows are migrated to `revenue_automation` and a compatibility mapping is kept in `useBilling.ts` and the entitlement checks so Revenue gating keeps working (automation tier additionally unlocks the automation engine).
- `_shared/billing.ts`: `priceFor`/`moduleLabel` extended to the new keys; new `vatCents()` helper.
- `billing-manage` checkout: Stripe Tax on, `tax_behavior: 'exclusive'` on each `price_data`, address + tax-ID collection, `customer_update`, trial_end logic unchanged. New `invoices` action returning the customer's Stripe invoices for the Invoices tab.
- `src/pages/Billing.tsx` rebuilt around the card + toggle-button layout with a sticky VAT-aware summary; `BillingSettingsPanel.tsx` extended with the new price and company fields.
- Automation entitlement read in the revenue automation UI so hotels on the BI tier see a "Add automation" upsell instead of the rule editor.
