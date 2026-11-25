# HotelCare — Stripe Payments + manual Számlázz.hu invoices

**Status: staged feature, not enabled in production.** This PR does not call the Stripe live payments API, change live subscriptions, run a migration, or deploy a worker.

## User journey

1. Organization admin selects eligible hotel/module packages on `/billing`.
2. With `HOTELCARE_MANUAL_BILLING_ENABLED=true`, HotelCare reserves the module scope and starts Stripe Checkout with `mode=payment`, `invoice_creation.enabled=false` and `payment_intent_data.setup_future_usage=off_session`. **No Stripe Subscription or Invoice objects are created.**
3. Stripe Tax calculates buyer-specific VAT using the Checkout billing address/tax ID. Stripe Tax must be configured. An unknown VAT treatment must **not** default to 27%.
4. Signature-verified Checkout webhook validates that the first payment actually settled, saves the Stripe customer/payment-method identifiers, creates a ledger row and activates paid module access for one month.
5. A protected monthly worker claims due payments atomically via the `manual_billing_claim_due` database function; uses `PaymentIntents.create({confirm:true,off_session:true})` with a stable per-payment idempotency key, never Subscriptions/Invoices.
6. Signed payment webhooks, or the worker after verified success, advance service dates and create a `paid` ledger entry. The billing tab displays **Awaiting Számlázz invoice**. An admin issues the official invoice manually and records the actual invoice number. Failed/ambiguous charges must never be invoiced as paid.
7. The **Manage payment method** action opens Stripe Checkout in **setup-only** mode for payment-only customers, with no charge or invoice.

## Required environment and rollout

- Apply the new SQL migration in a **non-production** Supabase project first, run the integration checks below, then review a production migration plan separately.
- Configure `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` for the target mode; use **Stripe test mode**, test webhook endpoint and test payment cards only during testing.
- Configure Stripe Tax with relevant merchant registrations. A payment-only checkout refuses to start if no active Stripe Tax registration is available.
- Set `HOTELCARE_MANUAL_BILLING_WORKER_SECRET` to a long, random secret. The worker expects `x-worker-secret`, and Supabase config deliberately uses `verify_jwt=false` **because it validates this separate secret**. Keep secret only in server-side Vault/secrets.
- Set `HOTELCARE_MANUAL_BILLING_ENABLED=true` **only after** staging checkout, signed webhooks, the database and worker have been validated and rollout explicitly approved.
- Schedule a protected worker POST hourly using pg_cron/pg_net or a trusted scheduler. No job is created by this PR; while the feature flag is off, the worker refuses to charge.
- Existing Stripe Billing subscriptions are not automatically cancelled/migrated. They still generate Stripe invoices until properly terminated. Checkout rejects selections with existing active, trialing or past-due subscriptions; the worker checks legacy subscriptions again before renewal.
- Do not activate the payment-only checkout for trialing or percentage-of-revenue contracts; convert to agreed fixed billing terms first.
- The first successful checkout is the first paid month; renewal amount is frozen at the checkout's actual net/tax/gross until revised by an authorized process.
- For changed seller VAT settings, changed customer country/city/postcode, Stripe errors, bank authentication requirements, or payment result uncertainty, collection halts for manual review. The worker does not blindly retry or double-charge.
- Do not activate for customer self-service until the cancellation, dispute/refund, and payment-recovery operating procedures are approved. No production transactions are changed by this branch.

## Test plan (Stripe test mode only)

- Complete Checkout for a domestic taxable B2B customer: net EUR 400 + VAT EUR 108 = EUR 508. Verify no Stripe invoice or subscription object is created, and one ledger row is paid.
- Complete checkout with buyer tax ID / address in another EU country; confirm Stripe Tax's calculated VAT is displayed and persisted rather than blindly charging 27%.
- Deliver the same webhook twice: no second ledger row, extra entitlement, or charge.
- Attempt two checkouts for the same hotel/module: database scope lock must reject the second.
- Verify monthly due worker performs exactly one off-session PaymentIntent for one billing period; invoke it again and ensure no duplicate payment.
- Simulate declined/SCA-required payment, Stripe timeout, changed VAT settings and changed billing address: require review rather than repeat billing.
- Test new card with SetupIntent: saved method changes without collecting payment/invoice.
- Mark an unpaid ledger row invoiced: forbidden. Mark paid row with invoice number once: success. Duplicate invoice number within an organization: rejected by unique index.
- Confirm no pre-existing Stripe subscriptions were cancelled/updated, and that legacy Stripe invoice records remain separately labeled.
- Validate database schema, RLS (no client writes), module entitlements, taxes and GitHub CI build/tests before deploying.

## Accounting

Manual Számlázz.hu invoicing is **not** an automatic invoice issuance integration. The admin must issue each invoice in Számlázz.hu, record its number in HotelCare, and reconcile refunds, failed payments and chargebacks. Retain Stripe charge/payment IDs for audit; Stripe payment confirmations are not official VAT invoices.
