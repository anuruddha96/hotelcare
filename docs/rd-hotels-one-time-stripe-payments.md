# RD Hotels: one-time Stripe collections with Számlázz.hu invoicing

Status: **prepared in GitHub only; disabled in production** until reviewed, tested, migrated and deployed. No payment was collected by this code change.

## The approved commercial scope

- EUR 400 net Revenue BI shared by Gozsdu Court, Hotel Memories, Hotel Mika, and Hotel Ottofiori; only Hotel Ottofiori has automated pricing enabled. Hungary VAT 27% = EUR 108; **EUR 508 one-time total**.
- EUR 200 net Housekeeping shared across the four RD hotels; Hungary VAT 27% = EUR 54; **EUR 254 one-time total**.
- The commercial agreement and hotel-level module entitlements are not the same as "the automation engine is operationally switched on." Never infer automation access from the shared price.

## No recurring billing; no Stripe invoices

The admin-only `one_time_checkout` action verifies the exact saved agreement, organization, four property entitlements and 27% HU VAT settings on the server. Stripe Checkout is created with **mode=payment**, one-time prices, **invoice_creation.enabled=false** and *no* saved-card/recurring mandate or Stripe Subscription. Stripe may still send a **payment confirmation/receipt**, which is not a VAT invoice.

The dedicated `billing_one_time_payments` ledger reserves at most one pending Checkout per package. A Stripe-signature-verified webhook reconciles payment amount and currency and verifies Hungarian billing address. Any non-HU billing details or amount discrepancy is held for manual tax/payment review; the system never automatically issues an invoice. Once paid, HotelCare shows the net, VAT, gross and billing details under Payments & invoices. A billing admin can record the invoice number **after** creating the official invoice manually in Számlázz.hu. Paid charges do not automatically enable or disable hotel modules.

**VAT note:** this workflow is approved only for known Hungarian domestic customers, not cross-border sales. It uses an explicit, exclusive 27% Hungarian VAT rate because this Stripe account currently has no active Stripe Tax registration. Accountants must confirm the applicable tax treatment before live collection. Customers with non-Hungarian billing addresses must not use it.

## Rollout checklist

1. Verify the customer's exact legal name, Hungarian tax ID, billing address, and agreed amount.
2. Deploy `20261015123000_rd_one_time_payment_collection.sql` in a test Supabase project and validate RLS/idempotency and webhook replay.
3. Deploy the updated `billing-manage` and `billing-webhook` Edge Functions to the same test environment. Verify successful/cancelled/duplicate payments in **Stripe test mode** only. Confirm there are no Stripe Invoice or Subscription objects.
4. Validate the Payments page with all four hotels and only Ottofiori Automation visible; test both package buttons and Számlázz invoice-reference entry.
5. Explicitly review the **existing live EUR 200/month Stripe subscription** for RD Hotels. This PR **does not cancel it**. It must be intentionally cancelled when switching from recurring to one-time collection; otherwise it will continue to charge and issue Stripe invoices. The one-time Housekeeping button is blocked while that subscription remains active.
6. After production migration and verified webhook configuration, enable `HOTELCARE_ONE_TIME_CHECKOUT_ENABLED=true` in the target Supabase function environment. Keep this false during staging. Enable only with explicit approval.
7. Send the resulting one-time Stripe checkout link to the authorized payer. Confirm settled status in Stripe before issuing the official Számlázz.hu invoice, record its invoice number in HotelCare and reconcile payment records.

No live Stripe charge, subscription cancellation, schema migration or Edge Function deployment is performed just by merging this PR.
