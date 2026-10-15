// Stripe webhook for HotelCare subscriptions and Assistant credit top-ups.
// Signature-verified with STRIPE_WEBHOOK_SECRET; no JWT because Stripe calls it.
import Stripe from "npm:stripe@18";
import { createClient } from "npm:@supabase/supabase-js@2";
import { completeManualCheckout, finishManualRenewal, expireManualCheckout, updateManualPaymentMethod } from "../_shared/manualBillingRuntime.ts";
import { settledBreakdown } from "../_shared/manualBillingPolicy.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, stripe-signature",
};

const PREMIUM_PACKAGES: Record<string, { credits: number; amountCents: number }> = {
  premium_5: { credits: 5, amountCents: 500 },
  premium_10: { credits: 10, amountCents: 1000 },
};

function admin() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
}

function parseSelections(meta: Record<string, string> | null | undefined) {
  const raw = meta?.selections ?? "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pair) => {
      const [hotel_id, module] = pair.split(":");
      return { hotel_id, module };
    })
    .filter(
      (s) =>
        s.hotel_id &&
        ["revenue", "revenue_bi", "revenue_automation", "operations", "maintenance"].includes(String(s.module)),
    )
    .map((s) => ({ ...s, module: s.module === "revenue" ? "revenue_automation" : s.module }));
}

function parseSelectionItemIndexes(meta: Record<string, string> | null | undefined) {
  const raw = meta?.selection_item_indexes ?? "";
  if (!raw) return [];
  return raw.split(",").map((value) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : -1;
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const secret = Deno.env.get("STRIPE_SECRET_KEY");
  const whSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!secret || !whSecret) return new Response("Not configured", { status: 400 });

  const stripe = new Stripe(secret, { apiVersion: "2025-03-31.basil" as any });
  const signature = req.headers.get("stripe-signature") ?? "";
  const payload = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(payload, signature, whSecret);
  } catch (error) {
    console.error("Bad signature", error);
    return new Response("Bad signature", { status: 400 });
  }

  const db = admin();

  try {
    const obj = event.data.object as unknown as Record<string, unknown>;
    const meta = (obj.metadata ?? {}) as Record<string, string>;
    const orgSlug = meta.organization_slug ?? null;

    await db.from("billing_events").insert({
      stripe_event_id: event.id,
      event_type: event.type,
      organization_slug: orgSlug,
      payload: event as unknown as Record<string, unknown>,
    });

    const upsertFromSubscription = async (sub: Stripe.Subscription) => {
      const subMeta = (sub.metadata ?? {}) as Record<string, string>;
      const slug = subMeta.organization_slug;
      const selections = parseSelections(subMeta);
      const selectionItemIndexes = parseSelectionItemIndexes(subMeta);
      if (!slug || !selections.length) return;

      const items = sub.items?.data ?? [];
      const periodEnd = (sub as unknown as { current_period_end?: number }).current_period_end;
      const primaryItemIndexes = new Set<number>();

      for (let i = 0; i < selections.length; i++) {
        const sel = selections[i];
        const mappedIndex = selectionItemIndexes[i];
        const itemIndex = mappedIndex != null && mappedIndex >= 0 ? mappedIndex : i;
        const item = items[itemIndex];
        const isPrimaryBillingRow = !primaryItemIndexes.has(itemIndex);
        primaryItemIndexes.add(itemIndex);

        await db.from("module_subscriptions").upsert(
          {
            organization_slug: slug,
            hotel_id: sel.hotel_id,
            module: sel.module,
            status: sub.status,
            // Shared organization agreements intentionally create one Stripe item
            // for several hotel/module access rows. Only one row carries the billed
            // quantity so aggregate monthly totals are not multiplied per property.
            quantity: isPrimaryBillingRow ? item?.quantity ?? 0 : 0,
            unit_amount_cents: item?.price?.unit_amount ?? 0,
            currency: (item?.price?.currency ?? "eur").toUpperCase(),
            stripe_customer_id: typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null,
            stripe_subscription_id: sub.id,
            stripe_item_id: item?.id ?? null,
            current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
            cancel_at_period_end: Boolean(sub.cancel_at_period_end),
          },
          { onConflict: "hotel_id,module" },
        );
      }
    };

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const sessionMeta = (session.metadata ?? {}) as Record<string, string>;

        if (session.mode === "setup" && sessionMeta.kind === "hotelcare_manual_card") {
          await updateManualPaymentMethod(db, stripe, session);
          break;
        }
        if (session.mode === "payment" && sessionMeta.kind === "hotelcare_one_time") {
          const paymentId = sessionMeta.payment_id;
          if (!paymentId || session.payment_status !== "paid") break;
          const { data: charge, error: lookupError } = await db.from("billing_one_time_payments")
            .select("*").eq("id", paymentId).maybeSingle();
          if (lookupError) throw lookupError;
          if (!charge || charge.stripe_checkout_session_id !== session.id) throw new Error("Unrecognized one-time Checkout session");
          if (charge.status !== "pending") break; // Webhook is idempotent.
          const intentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
          if (!intentId) throw new Error("One-time payment is missing its PaymentIntent");
          const intent = await stripe.paymentIntents.retrieve(intentId);
          if (intent.status !== "succeeded" || intent.currency.toUpperCase() !== charge.currency)
            throw new Error("One-time payment was not settled in the contracted currency");
          const breakdown = settledBreakdown(Number(session.amount_subtotal ?? -1),
            Number(session.total_details?.amount_tax ?? -1), Number(session.amount_total ?? -1));
          const addressCountry = session.customer_details?.address?.country;
          const valid = breakdown.net_cents === Number(charge.net_cents) &&
            breakdown.vat_cents === Number(charge.vat_cents) &&
            breakdown.gross_cents === Number(charge.gross_cents) && addressCountry === "HU";
          const { error: finalizeError } = await db.from("billing_one_time_payments").update({
            status: valid ? "paid" : "needs_review", stripe_payment_intent_id: intentId,
            paid_at: new Date().toISOString(), billing_details: session.customer_details ?? {},
            updated_at: new Date().toISOString(),
          }).eq("id", paymentId).eq("stripe_checkout_session_id", session.id).eq("status", "pending");
          if (finalizeError) throw finalizeError;
          if (!valid) console.error("MANUAL TAX REVIEW: One-time payment collected outside the approved Hungarian billing terms", paymentId);
          break;
        }
        if (session.mode === "payment" && sessionMeta.kind === "hotelcare_manual_monthly") {
          await completeManualCheckout(db, stripe, session);
          break;
        }
        if (session.mode === "payment" && sessionMeta.kind === "assistant_premium_topup") {
          const pack = PREMIUM_PACKAGES[sessionMeta.package_id ?? ""];
          const userId = String(sessionMeta.user_id ?? "");
          const slug = String(sessionMeta.organization_slug ?? "");
          const isPaid = session.payment_status === "paid" || session.payment_status === "no_payment_required";
          const amountMatches = Number(session.amount_total ?? -1) === Number(pack?.amountCents ?? -2);
          const currencyMatches = String(session.currency ?? "").toLowerCase() === "eur";
          if (!pack || !userId || !isPaid || !amountMatches || !currencyMatches) {
            console.error("Rejected assistant credit checkout", {
              session: session.id,
              package: sessionMeta.package_id,
              paymentStatus: session.payment_status,
              amount: session.amount_total,
              currency: session.currency,
            });
            break;
          }

          const companyField = (session.custom_fields ?? []).find((field: any) => field?.key === "company_name");
          const billingDetails = {
            company_name: companyField?.text?.value ?? null,
            customer_name: session.customer_details?.name ?? null,
            email: session.customer_details?.email ?? null,
            address: session.customer_details?.address ?? null,
            tax_ids: session.customer_details?.tax_ids ?? [],
            customer_id: typeof session.customer === "string" ? session.customer : session.customer?.id ?? null,
          };

          const { error: grantError } = await db.rpc("grant_assistant_premium_purchase", {
            _user_id: userId,
            _organization_slug: slug || null,
            _stripe_checkout_session_id: session.id,
            _stripe_payment_intent_id:
              typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null,
            _package_id: sessionMeta.package_id,
            _credits: pack.credits,
            _amount_eur: pack.amountCents / 100,
            _billing_details: billingDetails,
          });
          if (grantError) throw new Error(`Could not grant Assistant credits: ${grantError.message}`);
          break;
        }

        if (session.subscription) {
          const sub = await stripe.subscriptions.retrieve(String(session.subscription));
          if (!sub.metadata?.organization_slug && orgSlug) {
            await stripe.subscriptions.update(sub.id, { metadata: meta });
            sub.metadata = meta;
          }
          await upsertFromSubscription(sub);
        }
        break;
      }
      case "checkout.session.expired": {
        const expired = event.data.object as Stripe.Checkout.Session;
        if (expired.metadata?.kind === "hotelcare_one_time" && expired.metadata?.payment_id) {
          const { error } = await db.from("billing_one_time_payments")
            .update({ status: "expired", updated_at: new Date().toISOString() })
            .eq("id", expired.metadata.payment_id)
            .eq("stripe_checkout_session_id", expired.id).eq("status", "pending");
          if (error) throw error;
        } else await expireManualCheckout(db, expired);
        break;
      }
      case "payment_intent.succeeded":
        await finishManualRenewal(db, event.data.object as Stripe.PaymentIntent, true);
        break;
      case "payment_intent.payment_failed":
        await finishManualRenewal(db, event.data.object as Stripe.PaymentIntent, false);
        break;
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await upsertFromSubscription(event.data.object as Stripe.Subscription);
        break;
      default:
        break;
    }
  } catch (error) {
    console.error("billing-webhook error", error);
    return new Response("Error", { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { ...CORS, "Content-Type": "application/json" },
  });
});