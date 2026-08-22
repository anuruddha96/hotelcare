// Stripe webhook: keeps module_subscriptions in sync with Stripe.
// Signature-verified with STRIPE_WEBHOOK_SECRET; no JWT (Stripe calls it).

import Stripe from "npm:stripe@18";
import { admin, CORS } from "../_shared/billing.ts";

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
    .filter((s) => s.hotel_id && (s.module === "revenue" || s.module === "operations"));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const secret = Deno.env.get("STRIPE_SECRET_KEY");
  const whSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!secret || !whSecret) return new Response("Not configured", { status: 400 });

  const stripe = new Stripe(secret, { apiVersion: "2025-03-31.basil" });
  const signature = req.headers.get("stripe-signature") ?? "";
  const payload = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(payload, signature, whSecret);
  } catch (e) {
    console.error("Bad signature", e);
    return new Response("Bad signature", { status: 400 });
  }

  const db = admin();

  try {
    const obj = event.data.object as Record<string, unknown>;
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
      if (!slug || !selections.length) return;

      const items = sub.items?.data ?? [];
      const periodEnd = (sub as unknown as { current_period_end?: number }).current_period_end;

      for (let i = 0; i < selections.length; i++) {
        const sel = selections[i];
        const item = items[i];
        await db.from("module_subscriptions").upsert(
          {
            organization_slug: slug,
            hotel_id: sel.hotel_id,
            module: sel.module,
            status: sub.status,
            quantity: item?.quantity ?? 0,
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
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        await upsertFromSubscription(event.data.object as Stripe.Subscription);
        break;
      }
      default:
        break;
    }
  } catch (e) {
    console.error("billing-webhook error", e);
    return new Response("Error", { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { ...CORS, "Content-Type": "application/json" },
  });
});
