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
  normaliseModule,
  isRevenueModule,
  vatCents,
  type BillingSettings,
  type ModuleKey,
} from "../_shared/billing.ts";

const MODULES: ModuleKey[] = ["revenue_bi", "revenue_automation", "operations", "maintenance"];

function stripeClient() {
  const key = Deno.env.get("STRIPE_SECRET_KEY");
  if (!key) return null;
  return new Stripe(key, { apiVersion: "2025-03-31.basil" });
}

import { rollupLastMonth, type UsageRow } from "../_shared/billingRollup.ts";
export type { UsageRow };

/**
 * Fallback when Stripe Tax is not activated on the account: a plain VAT rate
 * at the organization's percentage, reused across sessions.
 */
const vatRateCache = new Map<string, string>();
async function fixedVatRate(stripe: Stripe, settings: BillingSettings): Promise<string | null> {
  const percentage = Number(settings.vat_percent) || 0;
  if (percentage <= 0) return null;
  const cacheKey = `${settings.organization_slug}:${percentage}`;
  const hit = vatRateCache.get(cacheKey);
  if (hit) return hit;
  const existing = await stripe.taxRates.list({ active: true, limit: 100 });
  const found = existing.data.find(
    (r) => Number(r.percentage) === percentage && r.inclusive === false && r.display_name === "VAT",
  );
  const rate =
    found ??
    (await stripe.taxRates.create({
      display_name: "VAT",
      percentage,
      inclusive: false,
      country: settings.billing_address_country || "HU",
      description: `VAT ${percentage}%`,
    }));
  vatRateCache.set(cacheKey, rate.id);
  return rate.id;
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
      // Percentage-based Revenue Management settles last full month automatically:
      // the figures are recomputed, stored and (outside the trial) invoiced here,
      // so nobody has to press a button.
      let usage: UsageRow[] = [];
      if (settings.revenue_pricing_mode === "percent") {
        try {
          const rollup = await rollupLastMonth(slug, settings, hotels, subs ?? [], stripeClient());
          usage = rollup.rows;
        } catch (e) {
          console.error("automatic usage rollup failed", e);
        }
      }

      return json({
        settings: { ...settings, stripe_secret_configured: Boolean(Deno.env.get("STRIPE_SECRET_KEY")) },
        hotels,
        subscriptions: subs ?? [],
        trial_ends_at: trialEndsAt(settings),
        revenue_usage: usage,
      });
    }

    // Kept for the monthly cron / API callers. Stripe is optional here: without it
    // the figures are still stored, just not invoiced.
    if (action === "usage_rollup") {
      if (settings.revenue_pricing_mode !== "percent") {
        return json({ error: "This organization is not on percentage pricing" }, 400);
      }
      const rollup = await rollupLastMonth(slug, settings, hotels, subs ?? [], stripeClient());
      return json(rollup);
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

    if (action === "invoices") {
      if (!stripe) return json({ invoices: [] });
      const customerId = (subs ?? []).find((s) => s.stripe_customer_id)?.stripe_customer_id;
      if (!customerId) return json({ invoices: [] });
      const list = await stripe.invoices.list({ customer: String(customerId), limit: 24 });
      return json({
        invoices: list.data.map((inv) => ({
          id: inv.id,
          number: inv.number,
          created: inv.created,
          period_start: inv.period_start,
          period_end: inv.period_end,
          currency: (inv.currency ?? settings.currency).toUpperCase(),
          subtotal_cents: inv.subtotal ?? 0,
          tax_cents: inv.tax ?? 0,
          total_cents: inv.total ?? 0,
          status: inv.status,
          hosted_invoice_url: inv.hosted_invoice_url,
          invoice_pdf: inv.invoice_pdf,
        })),
      });
    }

    if (action === "checkout") {
      const selections: { hotel_id: string; module: ModuleKey }[] = Array.isArray(body.selections)
        ? body.selections
        : [];
      if (!selections.length) return json({ error: "Nothing selected" }, 400);

      const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];
      const meta: Record<string, string> = { organization_slug: slug };
      const picked: string[] = [];
      let netCents = 0;

      for (const sel of selections) {
        const module = normaliseModule(String(sel.module));
        if (!MODULES.includes(module)) continue;
        // Maintenance is quoted individually — it never goes through checkout.
        if (module === "maintenance" && settings.maintenance_pricing_mode !== "per_room") continue;
        const hotel = hotels.find((h) => h.hotel_id === sel.hotel_id);
        if (!hotel) continue;
        if (!moduleEnabled(settings, module)) continue;

        // Revenue Management can be sold as a share of realised revenue. The
        // subscription then carries a zero-amount monthly line and the real fee
        // is invoiced monthly from the synced revenue.
        if (isRevenueModule(module) && settings.revenue_pricing_mode !== "per_room") {
          const pct = (settings.revenue_percent_bps / 100).toFixed(2).replace(/\.00$/, "");
          lineItems.push({
            quantity: 1,
            price_data: {
              currency: settings.currency.toLowerCase(),
              unit_amount: 0,
              tax_behavior: "exclusive",
              recurring: { interval: "month" },
              product_data: {
                name: `${moduleLabel(settings, module)} — ${hotel.hotel_name}`,
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
            tax_behavior: "exclusive",
            recurring: { interval: "month" },
            product_data: {
              name: `${moduleLabel(settings, module)} — ${hotel.hotel_name}`,
              description: `${qty} rooms × ${(unit / 100).toFixed(2)} ${settings.currency} per room / month (excl. VAT)`,
            },
          },
        });
        netCents += unit * qty;
        picked.push(`${hotel.hotel_id}:${module}`);
      }

      if (!lineItems.length) return json({ error: "Nothing billable in the selection" }, 400);
      meta.selections = picked.join(",");

      const existingCustomer = (subs ?? []).find((s) => s.stripe_customer_id)?.stripe_customer_id;
      const origin = String(body.returnUrl ?? req.headers.get("origin") ?? "");

      // Subscribing during the trial is allowed and must not charge early:
      // billing starts the day the trial ends.
      // Stripe rejects a `trial_end` that is less than 48 hours away, so only
      // pass it when the trial still has more than two days to run. Closer to
      // the end (or past it) billing simply starts immediately.
      const trialEnd = trialEndsAt(settings);
      const trialEndSec = trialEnd ? Math.floor(new Date(trialEnd).getTime() / 1000) : 0;
      const nowSec = Math.floor(Date.now() / 1000);
      const useTrial = trialEndSec > nowSec + 48 * 3600 + 300;

      // Company details for the invoice: collected at checkout (name, address,
      // tax number) so every Stripe invoice carries them.
      const base: Stripe.Checkout.SessionCreateParams = {
        mode: "subscription",
        line_items: lineItems,
        customer: existingCustomer ?? undefined,
        billing_address_collection: "required",
        tax_id_collection: { enabled: true },
        ...(existingCustomer ? { customer_update: { name: "auto", address: "auto" } } : {}),
        metadata: meta,
        subscription_data: {
          metadata: meta,
          ...(useTrial ? { trial_end: trialEndSec } : {}),
        },
        success_url: `${origin}?billing=success`,
        cancel_url: `${origin}?billing=cancelled`,
      };

      // VAT must always show as a separate line on the checkout. Stripe Tax only
      // computes it when the account has an active tax registration; without one
      // it silently returns "Tax 0.00". So we check first and otherwise attach an
      // explicit VAT rate so the customer sees net + VAT + gross.
      let hasTaxRegistration = false;
      try {
        const regs = await stripe.tax.registrations.list({ status: "active", limit: 1 });
        hasTaxRegistration = (regs.data?.length ?? 0) > 0;
      } catch (regError) {
        console.error("could not read stripe tax registrations", regError);
      }

      let session: Stripe.Checkout.Session;
      if (hasTaxRegistration) {
        session = await stripe.checkout.sessions.create({
          ...base,
          automatic_tax: { enabled: true },
        });
      } else {
        const rate = await fixedVatRate(stripe, settings);
        session = await stripe.checkout.sessions.create({
          ...base,
          automatic_tax: { enabled: false },
          line_items: lineItems.map((li) => ({ ...li, tax_rates: rate ? [rate] : undefined })),
        });
      }


      return json({
        url: session.url,
        trial_end: useTrial ? trialEnd : null,
        net_cents: netCents,
        vat_cents: vatCents(settings, netCents),
      });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error("billing-manage error", e);
    return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 500);
  }
});
