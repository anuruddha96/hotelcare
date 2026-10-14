import type Stripe from "npm:stripe@18";
import { addCalendarMonth, billingFingerprint, settledBreakdown } from "./manualBillingPolicy.ts";

type Db = any;
type AccessItem = { hotel_id: string; module: string; quantity: number; unit_amount_cents: number };

async function updateAccess(db: Db, contract: any, status: string, paidThrough: string) {
  const items = contract.items as AccessItem[];
  for (const item of items) {
    const { error } = await db.from("module_subscriptions").upsert({
      organization_slug: contract.organization_slug,
      hotel_id: item.hotel_id,
      module: item.module,
      status,
      quantity: item.quantity,
      unit_amount_cents: item.unit_amount_cents,
      currency: contract.currency,
      stripe_customer_id: contract.stripe_customer_id,
      stripe_subscription_id: null,
      stripe_item_id: null,
      current_period_end: paidThrough,
      cancel_at_period_end: false,
    }, { onConflict: "hotel_id,module" });
    if (error) throw error;
  }
}

export async function completeManualCheckout(db: Db, stripe: Stripe, session: Stripe.Checkout.Session) {
  const id = session.metadata?.manual_contract_id;
  if (!id || session.metadata?.kind !== "hotelcare_manual_monthly" ||
      session.mode !== "payment" || session.payment_status !== "paid") return;
  const { data: contract, error: findError } = await db.from("manual_billing_contracts")
    .select("*").eq("id", id).maybeSingle();
  if (findError) throw findError;
  if (!contract || contract.stripe_checkout_session_id !== session.id) return;
  if (contract.status === "active") {
    // Repair an earlier webhook attempt that settled Stripe/DB but failed
    // before the module entitlements were written.
    await updateAccess(db, contract, "active", contract.current_period_end);
    return;
  }
  if (contract.status !== "pending") return;
  const intentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  if (!intentId) throw new Error("Checkout missing payment intent");
  const intent = await stripe.paymentIntents.retrieve(intentId);
  if (intent.status !== "succeeded" || !intent.payment_method) throw new Error("Payment not settled");
  const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
  const methodId = typeof intent.payment_method === "string" ? intent.payment_method : intent.payment_method.id;
  const address = session.customer_details?.address;
  if (!customerId || !methodId || !address?.country) throw new Error("Billing customer/address incomplete");
  if (session.currency?.toUpperCase() !== contract.currency) throw new Error("Currency mismatch");
  const amount = settledBreakdown(
    Number(session.amount_subtotal ?? -1),
    Number(session.total_details?.amount_tax ?? -1),
    Number(session.amount_total ?? -1));
  if (amount.net_cents !== Number(contract.net_cents)) throw new Error("Net amount mismatch");
  const taxIds = (session.customer_details?.tax_ids ?? [])
    .map((item) => String(item.type) + ":" + String(item.value)).sort();
  const start = new Date(session.created * 1000).toISOString();
  const end = addCalendarMonth(start);
  const { error: paymentError } = await db.from("manual_billing_payments").upsert({
    contract_id: id, organization_slug: contract.organization_slug,
    period_start: start, period_end: end, payment_source: "checkout",
    stripe_payment_intent_id: intentId, status: "paid", currency: contract.currency,
    ...amount, paid_at: new Date().toISOString(),
  }, { onConflict: "contract_id,period_start", ignoreDuplicates: true });
  if (paymentError) throw paymentError;

  const { data: updated, error } = await db.from("manual_billing_contracts")
    .update({ status: "active", stripe_customer_id: customerId, stripe_payment_method_id: methodId,
      ...amount, billing_fingerprint: billingFingerprint(address), billing_tax_ids: taxIds, paid_at: new Date().toISOString(),
      next_charge_at: end, current_period_end: end, updated_at: new Date().toISOString() })
    .eq("id", id).eq("status", "pending").select("*").maybeSingle();
  if (error) throw error;
  if (updated) {
    await stripe.customers.update(customerId, { address: {
      country: address.country, city: address.city ?? undefined,
      postal_code: address.postal_code ?? undefined,
      line1: address.line1 ?? undefined, line2: address.line2 ?? undefined,
      state: address.state ?? undefined,
    }, invoice_settings: { default_payment_method: methodId } });
    await updateAccess(db, updated, "active", end);
  }
}

export async function finishManualRenewal(db: Db, intent: Stripe.PaymentIntent, succeeded: boolean) {
  if (intent.metadata?.kind !== "hotelcare_manual_renewal") return;
  const paymentId = intent.metadata.manual_payment_id;
  const contractId = intent.metadata.manual_contract_id;
  if (!paymentId || !contractId) throw new Error("Renewal missing identifiers");
  const { data: payment, error } = await db.from("manual_billing_payments")
    .select("*").eq("id", paymentId).eq("contract_id", contractId).maybeSingle();
  if (error) throw error;
  if (!payment) return;
  if (succeeded && payment.status === "paid") {
    const { data: contract } = await db.from("manual_billing_contracts")
      .select("*").eq("id", contractId).maybeSingle();
    if (contract?.status === "active") await updateAccess(db, contract, "active", contract.current_period_end);
    return;
  }
  if (payment.status !== "processing") return;
  const status = succeeded ? "paid" :
    intent.status === "requires_action" ? "requires_action" : "failed";
  const { error: paymentError } = await db.from("manual_billing_payments")
    .update({ status, stripe_payment_intent_id: intent.id,
      paid_at: succeeded ? new Date().toISOString() : null })
    .eq("id", paymentId).eq("status", "processing");
  if (paymentError) throw paymentError;
  const { data: updated, error: contractError } = await db.from("manual_billing_contracts")
    .update({ status: succeeded ? "active" : "past_due",
      ...(succeeded ? { current_period_end: payment.period_end, next_charge_at: payment.period_end,
        paid_at: new Date().toISOString() } : {}),
      updated_at: new Date().toISOString() })
    .eq("id", contractId).eq("status", "paused").select("*").maybeSingle();
  if (contractError) throw contractError;
  if (updated) await updateAccess(db, updated, succeeded ? "active" : "past_due",
    succeeded ? payment.period_end : updated.current_period_end);
}

export async function expireManualCheckout(db: Db, session: Stripe.Checkout.Session) {
  if (session.metadata?.kind !== "hotelcare_manual_monthly") return;
  const id = session.metadata?.manual_contract_id;
  if (!id) return;
  const { data, error } = await db.from("manual_billing_contracts")
    .update({ status: "expired", updated_at: new Date().toISOString() })
    .eq("id", id).eq("status", "pending").eq("stripe_checkout_session_id", session.id)
    .select("id").maybeSingle();
  if (error) throw error;
  if (data) {
    const { error: releaseError } = await db.from("manual_billing_scopes")
      .delete().eq("contract_id", id);
    if (releaseError) throw releaseError;
  }
}

/** Replace saved cards through a Stripe Checkout SetupIntent; never create an invoice. */
export async function updateManualPaymentMethod(db: Db, stripe: Stripe, session: Stripe.Checkout.Session) {
  if (session.mode !== "setup" || session.metadata?.kind !== "hotelcare_manual_card") return;
  const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
  const setupId = typeof session.setup_intent === "string" ? session.setup_intent : session.setup_intent?.id;
  if (!customerId || !setupId) throw new Error("Missing customer or setup intent");
  const setup = await stripe.setupIntents.retrieve(setupId);
  const methodId = typeof setup.payment_method === "string" ? setup.payment_method : setup.payment_method?.id;
  if (setup.status !== "succeeded" || !methodId || setup.customer !== customerId)
    throw new Error("Payment method authorization incomplete");
  const slug = session.metadata.organization_slug;
  if (!slug) throw new Error("Missing organization");
  const { data, error } = await db.from("manual_billing_contracts")
    .update({ stripe_payment_method_id: methodId, updated_at: new Date().toISOString() })
    .eq("organization_slug", slug).eq("stripe_customer_id", customerId)
    .in("status", ["active", "past_due", "needs_review"])
    .select("id");
  if (error) throw error;
  if (!data?.length) throw new Error("No payment-only contract for this customer");
  await stripe.customers.update(customerId, { invoice_settings: { default_payment_method: methodId } });
}
