// Opt-in scheduled collection of card payments. Does not use Stripe Billing or invoices.
// Deploy as verify_jwt=false, protect with HOTELCARE_MANUAL_BILLING_WORKER_SECRET.
// No charges can occur until HOTELCARE_MANUAL_BILLING_ENABLED=true is explicitly set.
import Stripe from "npm:stripe@18";
import { createClient } from "npm:@supabase/supabase-js@2";
import { billingFingerprint, hasLegacySubscription, monthlyAttemptKey } from "../_shared/manualBillingPolicy.ts";
import { finishManualRenewal } from "../_shared/manualBillingRuntime.ts";

function reply(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}
Deno.serve(async (req) => {
  if (req.method !== "POST") return reply({ error: "POST required" }, 405);
  const expected = Deno.env.get("HOTELCARE_MANUAL_BILLING_WORKER_SECRET");
  if (!expected || req.headers.get("x-worker-secret") !== expected)
    return reply({ error: "Unauthorized" }, 401);
  if (Deno.env.get("HOTELCARE_MANUAL_BILLING_ENABLED") !== "true")
    return reply({ error: "Payment-only collection is disabled" }, 503);
  const key = Deno.env.get("STRIPE_SECRET_KEY");
  if (!key) return reply({ error: "Stripe is not configured" }, 503);

  const stripe = new Stripe(key, { apiVersion: "2025-03-31.basil" });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } });
  const { data: payments, error: claimError } = await db.rpc("manual_billing_claim_due", { _limit: 10 });
  if (claimError) return reply({ error: claimError.message }, 500);
  const outcomes: { id: string; result: string }[] = [];

  for (const payment of payments ?? []) {
    const failClosed = async (reason: string, status = "needs_review") => {
      await db.from("manual_billing_payments").update({ status }).eq("id", payment.id).eq("status", "processing");
      await db.from("manual_billing_contracts").update({ status: status === "needs_review" ? "needs_review" : "past_due" })
        .eq("id", payment.contract_id).eq("status", "paused");
      console.error("Manual invoice payment requires attention", { payment_id: payment.id, reason });
      outcomes.push({ id: payment.id, result: status });
    };
    try {
      const { data: contract, error } = await db.from("manual_billing_contracts")
        .select("*").eq("id", payment.contract_id).eq("status", "paused").single();
      if (error || !contract) throw new Error("Contract is unavailable");
      const { data: settings } = await db.from("billing_settings").select("vat_percent,payments_enabled")
        .eq("organization_slug", contract.organization_slug).single();
      if (!settings?.payments_enabled || Number(settings.vat_percent) !== Number(contract.vat_percent_snapshot)) {
        await failClosed("Billing settings or VAT changed; tax review required");
        continue;
      }
      const selections = (contract.items ?? []).map((item: { hotel_id: string; module: string }) => item);
      const { data: legacyRows, error: legacyError } = await db.from("module_subscriptions")
        .select("hotel_id,module,stripe_subscription_id,status").eq("organization_slug", contract.organization_slug)
        .not("stripe_subscription_id", "is", null);
      if (legacyError || hasLegacySubscription(selections, legacyRows ?? [])) {
        await failClosed("Existing Stripe Billing subscription may overlap");
        continue;
      }
      const customer = await stripe.customers.retrieve(contract.stripe_customer_id);
      if (customer.deleted || !customer.address ||
          billingFingerprint(customer.address) !== contract.billing_fingerprint) {
        await failClosed("Billing address changed; VAT classification requires review");
        continue;
      }
      if (!Number.isSafeInteger(Number(payment.gross_cents)) || Number(payment.gross_cents) <= 0) {
        await failClosed("Invalid gross amount");
        continue;
      }
      const intent = await stripe.paymentIntents.create({
        amount: Number(payment.gross_cents), currency: String(payment.currency).toLowerCase(),
        customer: contract.stripe_customer_id,
        payment_method: contract.stripe_payment_method_id,
        off_session: true, confirm: true,
        description: "HotelCare monthly service charge - Számlázz.hu invoice issued separately",
        metadata: { kind: "hotelcare_manual_renewal", organization_slug: contract.organization_slug,
          manual_contract_id: contract.id, manual_payment_id: payment.id,
          billing_period_start: payment.period_start.slice(0, 10) },
      }, { idempotencyKey: monthlyAttemptKey(payment.id) });
      if (intent.status === "succeeded") {
        await finishManualRenewal(db, intent, true);
        outcomes.push({ id: payment.id, result: "paid" });
      } else {
        await failClosed("Unconfirmed Stripe status: " + intent.status);
      }
    } catch (error) {
      // A network/Stripe timeout may have produced a payment; do NOT retry with a new key.
      // A human reconciles Stripe before resuming any contract.
      await failClosed(error instanceof Error ? error.message : "Unknown Stripe error");
    }
  }
  return reply({ processed: outcomes.length, outcomes });
});
