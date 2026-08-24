// Billing backend for the Payments page.
//
// Actions:
//   summary  — settings, hotels + live room counts, current subscriptions, trial state
//   checkout — creates a Stripe Checkout session (monthly subscription, per-room quantity)
//   portal   — opens the Stripe billing portal
//
// Prices and room counts are always recomputed server-side; the client can
// only say WHICH hotel/module pairs it wants. Amounts are VAT-exclusive
// (automatic tax disabled).

import Stripe from "npm:stripe@18";
import {
  CORS,
  json,
  admin,
  requireBillingCaller,
  loadSettings,
  loadHotels,
  priceFor,
  moduleEnabled,
  moduleLabel,
  trialEndsAt,
  lastMonthRange,
  realisedRevenueCents,
  percentFeeCents,
  type ModuleKey,
} from "../_shared/billing.ts";

const MODULES: ModuleKey[] = ["revenue", "operations"];

function stripeClient() {
  const key = Deno.env.get("STRIPE_SECRET_KEY");
  if (!key) return null;
  return new Stripe(key, { apiVersion: "2025-03-31.basil" });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const caller = await requireBillingCaller(req);
    if (caller instanceof Response) return caller;

    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "summary");
    const slug = String(
      (caller.isSuperAdmin || caller.role === "admin" ? body.organizationSlug : null) ??
        caller.organizationSlug ??
        "",
    );
    if (!slug) return json({ error: "No organization" }, 400);

    const settings = await loadSettings(slug);
    const hotels = await loadHotels(slug);
    const db = admin();

    const { data: subs } = await db
      .from("module_subscriptions")
      .select("*")
      .eq("organization_slug", slug);

    if (action === "summary") {
      // For percentage-based Revenue Management we show what last full month
      // would have cost, computed from the synced Previo revenue.
      const { start, end } = lastMonthRange();
      let usage: {
        hotel_id: string;
        period_start: string;
        period_end: string;
        revenue_cents: number;
        room_nights: number;
        fee_cents: number;
      }[] = [];

      if (settings.revenue_pricing_mode === "percent") {
        usage = await Promise.all(
          hotels.map(async (h) => {
            const { revenueCents, roomNights } = await realisedRevenueCents(h.hotel_id, start, end);
            return {
              hotel_id: h.hotel_id,
              period_start: start,
              period_end: end,
              revenue_cents: revenueCents,
              room_nights: roomNights,
              fee_cents: percentFeeCents(settings, revenueCents),
            };
          }),
        );
      }

      return json({
        settings: { ...settings, stripe_secret_configured: Boolean(Deno.env.get("STRIPE_SECRET_KEY")) },
        hotels,
        subscriptions: subs ?? [],
        trial_ends_at: trialEndsAt(settings),
        revenue_usage: usage,
      });
    }

    const stripe = stripeClient();
    if (!stripe) return json({ error: "Stripe is not configured yet" }, 400);

    if (action === "portal") {
      const customerId = (subs ?? []).find((s) => s.stripe_customer_id)?.stripe_customer_id;
      // No Stripe customer exists until the first successful checkout. This is a
      // normal state (e.g. during the trial), not an error — tell the client so
      // it can point the user at checkout instead of showing a failure.
      if (!customerId) {
        return json({
          needs_checkout: true,
          message: "No paid subscription yet — choose your modules and check out to create a billing account.",
        });
      }
      const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: String(body.returnUrl ?? req.headers.get("origin") ?? ""),
      });
      return json({ url: session.url });
    }

    if (action === "checkout") {
      const selections: { hotel_id: string; module: ModuleKey }[] = Array.isArray(body.selections)
        ? body.selections
        : [];
      if (!selections.length) return json({ error: "Nothing selected" }, 400);

      const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];
      const meta: Record<string, string> = { organization_slug: slug };
      const picked: string[] = [];

      for (const sel of selections) {
        const module = sel.module;
        if (!MODULES.includes(module)) continue;
        const hotel = hotels.find((h) => h.hotel_id === sel.hotel_id);
        if (!hotel) continue;
        if (!moduleEnabled(settings, module)) continue;

        // Revenue Management can be sold as a share of realised revenue. The
        // subscription then carries a zero-amount monthly line and the real fee
        // is invoiced每 month from the synced revenue (billing-usage-rollup).
        if (module === "revenue" && settings.revenue_pricing_mode === "percent") {
          const pct = (settings.revenue_percent_bps / 100).toFixed(2).replace(/\.00$/, "");
          lineItems.push({
            quantity: 1,
            price_data: {
              currency: settings.currency.toLowerCase(),
              unit_amount: 0,
              recurring: { interval: "month" },
              product_data: {
                name: `Revenue Management — ${hotel.hotel_name}`,
                description: `${pct}% of realised room revenue, invoiced monthly (excl. VAT)`,
              },
            },
          });
          picked.push(`${hotel.hotel_id}:${module}`);
          continue;
        }

        const unit = priceFor(settings, module);
        const qty = hotel.rooms;
        if (unit <= 0 || qty <= 0) continue;

        lineItems.push({
          quantity: qty,
          price_data: {
            currency: settings.currency.toLowerCase(),
            unit_amount: unit,
            recurring: { interval: "month" },
            product_data: {
              name: `${moduleLabel(settings, module)} — ${hotel.hotel_name}`,
              description: `${qty} rooms × ${(unit / 100).toFixed(2)} ${settings.currency} per room / month (excl. VAT)`,
            },
          },
        });
        picked.push(`${hotel.hotel_id}:${module}`);
      }

      if (!lineItems.length) return json({ error: "Nothing billable in the selection" }, 400);
      meta.selections = picked.join(",");

      const existingCustomer = (subs ?? []).find((s) => s.stripe_customer_id)?.stripe_customer_id;
      const origin = String(body.returnUrl ?? req.headers.get("origin") ?? "");

      // Subscribing during the trial is allowed and must not charge early:
      // billing starts the day the trial ends.
      const trialEnd = trialEndsAt(settings);
      const trialEndSec = trialEnd ? Math.floor(new Date(trialEnd).getTime() / 1000) : 0;
      const nowSec = Math.floor(Date.now() / 1000);
      const useTrial = trialEndSec > nowSec + 60;

      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        line_items: lineItems,
        // In subscription mode Stripe always creates the customer itself;
        // `customer_creation` is only valid in payment mode.
        customer: existingCustomer ?? undefined,
        automatic_tax: { enabled: false },
        metadata: meta,
        subscription_data: {
          metadata: meta,
          ...(useTrial ? { trial_end: trialEndSec } : {}),
        },
        success_url: `${origin}?billing=success`,
        cancel_url: `${origin}?billing=cancelled`,
      });

      return json({ url: session.url, trial_end: useTrial ? trialEnd : null });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error("billing-manage error", e);
    return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 500);
  }
});
