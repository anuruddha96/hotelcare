# Per-room module billing with Stripe

Add a Payments section for top management: pick which hotels need Revenue Management and which need the Housekeeping/Operations module, see a VAT-excluded monthly total priced per room, and check out with Stripe. Admins configure all prices and trial periods per organization.

## What top management sees

A new **Payments** page (`/:org/payments`, top management + admin only):

- A friendly trial banner at the top: "You're on your free trial — full access until 21 Nov 2026" with a soft, positive tone and a "Manage subscription" button. No countdown pressure, no upsell language.
- One row per hotel in their organization, each with two toggles: **Revenue Management** and **Housekeeping / Operations**.
- Each toggle shows live room count and line price, e.g. `Hotel Ottofiori · Housekeeping · 21 rooms × €6 = €126 / month`.
- Running total at the bottom, clearly labelled **excluding VAT** ("VAT is added at checkout where applicable").
- Checkout button creates a Stripe Checkout subscription session; on return the page shows active modules and a link to the Stripe billing portal to change card or cancel.

Room counts come automatically from the live room records per hotel (Ottofiori 21, Memories 71, Gozsdu Court 82, Mika Downtown 33, SLNT Group 61).

## What admins configure

A new **Billing** tab in Admin, per organization:

- Price per room per month for each module (Revenue Management, Housekeeping/Operations), in EUR. Seeded: RD Hotels housekeeping €6, SLNT operations €3, Revenue Management €15 (all VAT-excluded). Revenue price can be left unset/disabled where not sold yet.
- Trial length and trial start date per organization, so the end date is derived. Seeded: SLNT 3 months, RD Hotels 1 month starting last week.
- Per-hotel override of the billable room count (optional; defaults to the live count).
- Read-only view of each organization's current subscription state.

## Access gating

Module access is granted when the organization is **in trial** or the hotel has an **active paid subscription** for that module:

- Revenue routes/tabs for a hotel without entitlement show a friendly locked card with a "See plans" button to the Payments page instead of the data.
- Housekeeping/Operations behaves the same way.
- Admin/super-admin is never gated.
- While every organization is inside its trial window nothing changes visually except the trial banner.

## Stripe keys

You will use your own Stripe account. I will add a secure place for `STRIPE_SECRET_KEY` (server-side secret) and store the publishable key in the billing settings. Nothing charges until the keys are saved — the Payments page shows "Payments not configured yet" to top management until then.

## Technical notes

New tables (all with grants + RLS scoped by `organization_slug`):

- `billing_settings` — per organization: module prices, currency, trial months, trial start, Stripe publishable key, active flag.
- `billing_hotel_room_overrides` — optional billable room count per hotel.
- `subscriptions` — per organization + hotel + module: status, Stripe subscription/customer id, quantity, current period end.
- `billing_events` — raw Stripe webhook log for reconciliation.

Edge functions:

- `billing-create-checkout` — validates caller is top management of the org, recomputes prices and room counts server-side (client input is never trusted for price), creates a Stripe Checkout session in subscription mode with per-room quantities, `automatic_tax` off so amounts stay VAT-exclusive.
- `billing-portal` — Stripe billing portal session.
- `billing-webhook` (`verify_jwt = false`, signature-verified) — writes subscription status changes into `subscriptions`.

Frontend:

- `src/lib/entitlements.ts` — single source of truth: `hasModule(org, hotel, module)` combining trial window + subscription rows.
- `useEntitlements` hook feeding the Revenue and Housekeeping gates and the trial banner.
- `src/pages/BillingPage.tsx`, `src/components/admin/BillingSettingsPanel.tsx` (new Admin tab).

Prices are stored in cents to avoid rounding drift; all displayed totals are VAT-exclusive.
