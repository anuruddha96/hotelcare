# Self-serve activation: card-on-file trial, early-bird pricing, and a soft end-of-trial path

Goal: when a non-admin turns on Revenue automation, they are guided into a friendly, one-screen sign-up that pre-selects Revenue for that property, asks only for card details (no charge during the trial), and clearly explains what the fee covers. After the trial they keep access on an admin-granted grace period with a small reminder, until they pay.

## 1. Turning on automation without an admin

In the automation rules screen, the "Automation is on / off" switch checks entitlement first:

- If the property already has Revenue BI + Automation (or the org is inside its trial with a card on file), nothing changes.
- Otherwise the switch does not flip. A short dialog appears:
  - "Automated pricing is part of Revenue — BI + Automation. Start your free trial: add a card, nothing is charged until [trial end date]."
  - Buttons: "Continue to activation" (goes to the Payments screen with the right things pre-ticked) and "Not now".
- Admins and super admins are never blocked.

## 2. Payments screen opened from that flow

Arriving from automation (`/:org/payments?activate=<hotelId>&module=revenue_automation`):

- The property that triggered it is scrolled to, highlighted, and **BI + Automation is pre-selected**.
- Directly under it, an optional single tick: "Add Housekeeping for this property too — <price> / room".
- All other properties of the organization stay visible below, each with the same toggles, so the customer can add more in the same checkout.
- Sticky summary shows net, 27% VAT, gross, and — while the trial is live — a green line: **"Due today: €0.00. Your card is saved and the first charge is on [date]. Cancel any time before then."**
- The checkout button reads "Start free trial — add card" during the trial, "Continue to checkout" otherwise.

## 3. Early-bird promotional pricing

The existing prices are presented as a limited-time launch offer:

- Each price shows the standard list price struck through and the early-bird price next to an **"Early bird"** badge with a short line: "Founding-partner pricing, locked for 12 months from activation."
- Admin (Admin → Billing) gets the list ("standard") price fields and an early-bird toggle + end date per organization, so the promotion is data-driven, not hard-coded. Defaults: standard Revenue BI €19, BI + Automation €29, Housekeeping €8 per room; early-bird prices stay at today's stored values (€15 / €22 / €6).
- Checkout always charges the early-bird price while the promotion is active; the saved subscription keeps that price after it ends.

## 4. Why we charge — professional explainer

A calm, short "What your subscription covers" block on the Payments screen (and a compact version in the activation dialog), listing:

- Hosting, database and secure backups running 24/7 for your properties
- Channel/PMS integration and the Previo connection maintained and monitored
- Market and competitor data feeds and the AI pricing engine
- Continuous development, updates and support

Tone: factual, no pressure, no percentages of "savings".

## 5. After the trial ends

- The organization gets a **grace period** (default 14 days, admin-editable) that starts when the trial ends. During it, everything keeps working.
- When someone opens Revenue during the grace period, a small, once-per-day notification appears: "Your free trial ended on [date]. An administrator extended your access until [grace end] — add your payment details to keep Revenue running." with a "Complete setup" button that opens Payments with the previously used modules pre-ticked.
- After the grace period without payment, Revenue shows the existing friendly locked card with a single "Complete setup" button. Housekeeping is unaffected unless it was also subscribed.
- Admins/super admins are never notified or gated.

## Technical notes

- `billing_settings` gains: `standard_revenue_bi_price_cents`, `standard_revenue_automation_price_cents`, `standard_operations_price_cents`, `early_bird_enabled`, `early_bird_label`, `early_bird_ends_at`, `grace_days` (default 14). Migration with GRANTs, existing RLS untouched.
- `useBilling.ts`: expose the new fields, add `graceEndsAt(summary)`, `inGracePeriod(summary)`, and `listPriceFor(module)`; `moduleUnlocked` / `automationUnlocked` treat the grace window as unlocked.
- `billing-manage` checkout: when the org is inside trial or grace, create the session with `payment_method_collection: 'always'` and a `trial_end` at the trial/grace end so Stripe saves the card and charges nothing now; VAT, address and tax-ID collection stay as they are. Server keeps recomputing prices (early bird applied server-side; never trusted from the client).
- New small component `src/components/billing/ActivateModuleDialog.tsx` used by `PickupAutomationRules.tsx`; the switch calls it instead of writing `is_enabled` when the entitlement check fails.
- `src/pages/Billing.tsx`: read `activate`/`module` query params, pre-select, highlight, "Due today €0.00" summary line, early-bird badges, and the "What your subscription covers" block.
- New `src/components/revenue/TrialEndedNotice.tsx` mounted on the Revenue pages; shows once per day via `localStorage`, hidden for admins.
- `BillingSettingsPanel.tsx`: standard price fields, early-bird toggle/end date, grace days.
