// Billing backend for the Payments page.
//
// Actions:
//   summary  — settings, hotels + live room counts, current subscriptions, trial state
//   checkout — creates a Stripe Checkout session using the resolved commercial agreement
//   portal   — opens the Stripe billing portal
//
// Prices and room counts are always recomputed server-side; the client can
// only say WHICH hotel/module pairs it wants. Amounts are VAT-exclusive.

import Stripe from "npm:stripe@18";
import {
  CORS,
  json,
  admin,
  requireBillingCaller,
  loadSettings,
  loadHotels,
  promotionForModule,
  moduleEnabled,
  moduleLabel,
  trialEndsAt,
  normaliseModule,
  vatCents,
  type BillingSettings,
  type ModuleKey,
} from "../_shared/billing.ts";
import {
  loadBillingOverrides,
  resolveBillingBypass,
  resolveModulePricing,
} from "../_shared/billingOverrides.ts";
import { resolveRdOneTimePackage, type RdPackage } from "../_shared/rdOneTimeBilling.ts";
import { canCollectRdOneTimePayment } from "../_shared/rdOneTimePermissions.ts";
import { decideOneTimeCheckoutRetry } from "../_shared/rdOneTimeRetryPolicy.ts";

const MODULES: ModuleKey[] = ["revenue_bi", "revenue_automation", "operations", "maintenance"];

function stripeClient() {
  const key = Deno.env.get("STRIPE_SECRET_KEY");
  if (!key) return null;
  return new Stripe(key, { apiVersion: "2025-03-31.basil" as any });
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
    if (!caller.isSuperAdmin && slug !== caller.organizationSlug) return json({ error: "Organization access denied" }, 403);

    const settings = await loadSettings(slug);
    const hotels = await loadHotels(slug);
    const { moduleRows, accessRows, agreements, entitlements, trials } = await loadBillingOverrides(slug);
    const db = admin();

    const { data: subs } = await db
      .from("module_subscriptions")
      .select("*")
      .eq("organization_slug", slug);

    const resolvedHotels = hotels.map((hotel) => {
      const bypass = resolveBillingBypass(accessRows, hotel.hotel_id);
      return {
        ...hotel,
        billing_bypass: bypass.active,
        billing_bypass_scope: bypass.scope,
      };
    });
    const modulePricing = hotels.flatMap((hotel) =>
      MODULES.map((module) => resolveModulePricing(settings, hotel.hotel_id, module, moduleRows, agreements, entitlements)),
    );

    if (action === "summary") {
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
        settings: { ...settings, stripe_secret_configured: Boolean(Deno.env.get("STRIPE_SECRET_KEY")), manual_invoicing_enabled: Deno.env.get("HOTELCARE_MANUAL_BILLING_ENABLED") === "true", one_time_collection_enabled: Deno.env.get("HOTELCARE_ONE_TIME_CHECKOUT_ENABLED") === "true" },
        hotels: resolvedHotels,
        subscriptions: subs ?? [],
        trial_ends_at: trialEndsAt(settings),
        revenue_usage: usage,
        module_pricing: modulePricing,
        module_trials: trials,
      });
    }

    if (action === "usage_rollup") {
      if (settings.revenue_pricing_mode !== "percent") {
        return json({ error: "This organization is not on percentage pricing" }, 400);
      }
      const rollup = await rollupLastMonth(slug, settings, hotels, subs ?? [], stripeClient());
      return json(rollup);
    }

    const stripe = stripeClient();
    if (!stripe) return json({ error: "Stripe is not configured yet" }, 400);

    if (action === "one_time_checkout") {
      // Top Managers may initiate *only* RD Hotels one-time payments; every
      // other billing mutation remains restricted to administrators.
      if (!canCollectRdOneTimePayment({
        role: caller.role, organizationSlug: caller.organizationSlug,
        isSuperAdmin: caller.isSuperAdmin,
      }, slug)) return json({ error: "RD Hotels billing collection access required" }, 403);
      if (Deno.env.get("HOTELCARE_ONE_TIME_CHECKOUT_ENABLED") !== "true" || !settings.payments_enabled)
        return json({ error: "One-time collection is not activated yet; please complete payment testing first" }, 503);
      if (body.packageKey !== "revenue" && body.packageKey !== "housekeeping")
        return json({ error: "Unknown payment package" }, 400);
      const pack = resolveRdOneTimePackage(body.packageKey as RdPackage, settings, agreements, entitlements, moduleRows);
      if (pack.packageKey === "housekeeping" && (subs ?? []).some((sub) =>
        sub.module === "operations" && Boolean(sub.stripe_subscription_id) &&
        ["active", "trialing", "past_due"].includes(sub.status)))
        return json({ error: "Housekeeping has an existing recurring Stripe subscription. Cancel it before starting a replacement one-time collection." }, 409);
      const origin = req.headers.get("origin") ?? "";
      const url = new URL(origin);
      if (!((url.protocol === "https:" && (url.hostname === "hotelcare.app" || url.hostname.endsWith(".hotelcare.app"))) ||
        (url.protocol === "http:" && url.hostname === "localhost")))
        return json({ error: "Checkout must be started from HotelCare" }, 400);
      let paymentId: string | null = null;
      // One pending record is a safety lock, not a reason to strand the payer.
      // On a retry, recover the existing Stripe Checkout instead of creating
      // another PaymentIntent (especially after unsuccessful 3-D Secure).
      for (let attempt = 0; attempt < 2; attempt++) {
        const candidateId = crypto.randomUUID();
        const { error: reserveError } = await db.from("billing_one_time_payments").insert({
          id: candidateId, organization_slug: slug, package_key: pack.packageKey,
          description: pack.description, currency: "EUR", net_cents: pack.netCents,
          vat_cents: pack.vatCents, gross_cents: pack.grossCents, status: "pending",
        });
        if (!reserveError) { paymentId = candidateId; break; }
        if (reserveError.code !== "23505") throw reserveError;

        const { data: existing, error: lookupError } = await db
          .from("billing_one_time_payments")
          .select("id,organization_slug,package_key,status,currency,gross_cents,stripe_checkout_session_id")
          .eq("organization_slug", slug).eq("package_key", pack.packageKey)
          .eq("status", "pending").maybeSingle();
        if (lookupError) throw lookupError;
        if (!existing) return json({ error: "Another payment request is being reconciled. Please retry shortly." }, 409);
        if (!existing.stripe_checkout_session_id)
          return json({ error: "The previous payment request is still being prepared. Please wait briefly before retrying; no new payment was created." }, 409);

        const checkout = await stripe.checkout.sessions.retrieve(existing.stripe_checkout_session_id);
        const decision = decideOneTimeCheckoutRetry(existing, checkout, {
          organization: slug, packageKey: pack.packageKey, grossCents: pack.grossCents,
        });
        if (decision === "resume") {
          // Frontend navigates to this same Stripe URL; nothing new is charged.
          return json({
            url: checkout.url, payment_id: existing.id, gross_cents: pack.grossCents,
            mode: "payment", resumed: true,
          });
        }
        if (decision === "expire") {
          // Only mark expired after Stripe itself confirms that the session is
          // closed and unpaid; conditionally release the unique pending lock.
          const { data: released, error: releaseError } = await db
            .from("billing_one_time_payments")
            .update({ status: "expired", updated_at: new Date().toISOString() })
            .eq("id", existing.id).eq("status", "pending")
            .eq("stripe_checkout_session_id", checkout.id)
            .select("id").maybeSingle();
          if (releaseError) throw releaseError;
          if (released) continue;
        }
        return json({ error: "The existing Stripe payment is being verified. Do not start another charge; check Payments & invoices or contact billing support." }, 409);
      }
      if (!paymentId) return json({ error: "Could not safely reserve a new payment. Please try again shortly." }, 409);
      let sessionId: string | null = null;
      try {
        // Fixed domestic Hungarian tax rate; deliberately fail closed for
        // non-Hungarian buyer details at settlement instead of auto-invoicing.
        const vatRate = await fixedVatRate(stripe, settings);
        if (!vatRate) throw new Error("Domestic VAT rate is missing");
        const session = await stripe.checkout.sessions.create({
          mode: "payment", payment_method_types: ["card"],
          line_items: [{ quantity: 1, tax_rates: [vatRate], price_data: {
            currency: "eur", unit_amount: pack.netCents, tax_behavior: "exclusive",
            product_data: { name: pack.description },
          } }],
          customer_creation: "always", billing_address_collection: "required",
          tax_id_collection: { enabled: true },
          // This payment has no recurring price, no saved-card mandate and no invoice.
          invoice_creation: { enabled: false },
          custom_text: { submit: { message: "Single payment only. Hungarian company billing (27% VAT). If your billing country is not Hungary, contact HotelCare before paying. Official invoices are issued separately via Számlázz.hu." } },
          metadata: { kind: "hotelcare_one_time", organization_slug: slug, payment_id: paymentId, package_key: pack.packageKey },
          payment_intent_data: { metadata: { kind: "hotelcare_one_time", organization_slug: slug, payment_id: paymentId } },
          success_url: url.origin + "/billing?payment=success",
          cancel_url: url.origin + "/billing?payment=cancelled",
        }, { idempotencyKey: "rd-onetime-" + paymentId });
        sessionId = session.id;
        const { error: updateError } = await db.from("billing_one_time_payments")
          .update({ stripe_checkout_session_id: session.id }).eq("id", paymentId).eq("status", "pending");
        if (updateError) throw updateError;
        return json({ url: session.url, payment_id: paymentId, gross_cents: pack.grossCents, mode: "payment" });
      } catch (error) {
        if (!sessionId) {
          await db.from("billing_one_time_payments").delete().eq("id", paymentId).eq("status", "pending");
        } else {
          try {
            await stripe.checkout.sessions.expire(sessionId);
            await db.from("billing_one_time_payments").update({ status: "expired" }).eq("id", paymentId).eq("status", "pending");
          } catch (expireError) {
            console.error("MANUAL RECONCILIATION REQUIRED: One-time Checkout cannot be expired", paymentId, sessionId, expireError);
          }
        }
        throw error;
      }
    }

    if (action === "portal" && Deno.env.get("HOTELCARE_MANUAL_BILLING_ENABLED") === "true") {
      const { data: manual } = await db.from("manual_billing_contracts")
        .select("stripe_customer_id").eq("organization_slug", slug)
        .in("status", ["active", "past_due", "needs_review"])
        .not("stripe_customer_id", "is", null).limit(1).maybeSingle();
      if (manual?.stripe_customer_id) {
        const safeOrigin = req.headers.get("origin") ?? "";
        if (!/^https:\/\//.test(safeOrigin) && !/^http:\/\/localhost(:[0-9]+)?$/.test(safeOrigin))
          return json({ error: "Invalid origin" }, 400);
        const session = await stripe.checkout.sessions.create({
          mode: "setup", customer: manual.stripe_customer_id,
          payment_method_types: ["card"],
          metadata: { kind: "hotelcare_manual_card", organization_slug: slug },
          setup_intent_data: { metadata: { kind: "hotelcare_manual_card", organization_slug: slug } },
          success_url: safeOrigin + "/billing?card=updated",
          cancel_url: safeOrigin + "/billing?card=cancelled",
        });
        return json({ url: session.url });
      }
    }

    if (action === "portal") {
      const customerId = (subs ?? []).find((s) => s.stripe_customer_id)?.stripe_customer_id;
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
          tax_cents: Math.max(0, (inv.total ?? 0) - (inv.subtotal ?? 0)),
          total_cents: inv.total ?? 0,
          status: inv.status,
          hosted_invoice_url: inv.hosted_invoice_url,
          invoice_pdf: inv.invoice_pdf,
        })),
      });
    }

    // Payment ledger is the source for manually issued Számlázz.hu invoices.
    if (action === "manual_payments") {
      const { data, error } = await db.from("manual_billing_payments")
        .select("id,contract_id,period_start,period_end,payment_source,status,currency,net_cents,vat_cents,gross_cents,paid_at,billing_details,szamlazz_invoice_number,invoiced_at")
        .eq("organization_slug", slug).order("created_at", { ascending: false }).limit(100);
      if (error) console.warn("Legacy manual monthly ledger has not been deployed", error.message);
      const { data: contracts, error: contractError } = await db.from("manual_billing_contracts")
        .select("id,status,currency,gross_cents,current_period_end,cancel_at_period_end,items,billing_details")
        .eq("organization_slug", slug).order("created_at", { ascending: false }).limit(100);
      if (contractError) console.warn("Legacy manual monthly contracts have not been deployed", contractError.message);
      const { data: oneTime, error: oneTimeError } = await db.from("billing_one_time_payments")
        .select("id,created_at,package_key,description,status,currency,net_cents,vat_cents,gross_cents,paid_at,billing_details,szamlazz_invoice_number,invoiced_at")
        .eq("organization_slug", slug).order("created_at", { ascending: false }).limit(100);
      if (oneTimeError) console.warn("One-time ledger unavailable until its migration is deployed", oneTimeError.message);
      const oneTimeRows = (oneTime ?? []).map((p) => ({
        ...p, contract_id: p.id, payment_source: "one_time",
        period_start: p.created_at, period_end: p.created_at,
      }));
      return json({ payments: [...oneTimeRows, ...(data ?? [])], contracts: contracts ?? [] });
    }

    if (action === "cancel_manual_renewal") {
      if (!caller.isSuperAdmin && caller.role !== "admin") return json({ error: "Admin access required" }, 403);
      const id = String(body.contractId ?? "");
      if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "Invalid contract" }, 400);
      const { data, error } = await db.from("manual_billing_contracts")
        .update({ cancel_at_period_end: true, updated_at: new Date().toISOString() })
        .eq("id", id).eq("organization_slug", slug).eq("status", "active")
        .eq("cancel_at_period_end", false).select("id,current_period_end").maybeSingle();
      if (error) throw error;
      if (!data) return json({ error: "Contract is not active or is already scheduled to cancel" }, 409);
      return json({ contract: data });
    }

    if (action === "mark_invoiced") {
      if (!caller.isSuperAdmin && caller.role !== "admin") return json({ error: "Admin access required" }, 403);
      const paymentId = String(body.paymentId ?? "");
      const number = String(body.invoiceNumber ?? "").trim();
      if (!/^[0-9a-f-]{36}$/i.test(paymentId) || !number || number.length > 128)
        return json({ error: "Valid payment ID and Számlázz invoice number are required" }, 400);
      const source = body.paymentSource === "one_time" ? "billing_one_time_payments" : "manual_billing_payments";
      const counterpart = source === "billing_one_time_payments" ? "manual_billing_payments" : "billing_one_time_payments";
      const { data: alreadyUsed } = await db.from(counterpart)
        .select("id").eq("organization_slug", slug).eq("szamlazz_invoice_number", number).limit(1);
      if (alreadyUsed?.length) return json({ error: "This Számlázz invoice number is already linked to another payment" }, 409);
      const { data, error } = await db.from(source)
        .update({ szamlazz_invoice_number: number, invoiced_at: new Date().toISOString() })
        .eq("id", paymentId).eq("organization_slug", slug).eq("status", "paid")
        .is("szamlazz_invoice_number", null)
        .select("id,szamlazz_invoice_number").maybeSingle();
      if (error) throw error;
      if (!data) return json({ error: "Payment is unpaid, missing, or already invoiced" }, 409);
      return json({ payment: data });
    }

    if (action === "checkout") {
      // RD Hotels has explicitly opted out of new Stripe Billing subscriptions.
      if (slug === "rdhotels") return json({ error: "RD Hotels uses one-time collection. New Stripe subscriptions are disabled." }, 403);
      const selections: { hotel_id: string; module: ModuleKey }[] = Array.isArray(body.selections)
        ? body.selections
        : [];
      if (!selections.length) return json({ error: "Nothing selected" }, 400);

      const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];
      const meta: Record<string, string> = { organization_slug: slug };
      const picked: string[] = [];
      const pickedItemIndexes: number[] = [];
      const sharedItemIndexes = new Map<string, number>();
      const seenSelections = new Set<string>();
      let netCents = 0;

      for (const sel of selections) {
        const module = normaliseModule(String(sel.module));
        if (!MODULES.includes(module)) continue;
        const hotel = hotels.find((h) => h.hotel_id === sel.hotel_id);
        if (!hotel) continue;
        if (!moduleEnabled(settings, module)) continue;
        // Existing active subscription items belong to an existing Stripe contract.
        // Never create another subscription for the same venue/module.
        if ((subs ?? []).some((sub) => sub.hotel_id === hotel.hotel_id
          && normaliseModule(String(sub.module)) === module
          && ['active','trialing','past_due'].includes(String(sub.status)))) continue;
        const selectionKey = `${hotel.hotel_id}:${module}`;
        if (seenSelections.has(selectionKey)) continue;
        seenSelections.add(selectionKey);
        const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Budapest', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
        if (trials.some((trial) => trial.enabled && trial.hotel_id === hotel.hotel_id && trial.module === module && trial.starts_on <= today && trial.ends_on >= today)) {
          return json({ error: `${hotel.hotel_name}: ${moduleLabel(settings,module)} has a free trial. Subscribe after the trial ends.` }, 400);
        }

        const pricing = resolveModulePricing(settings, hotel.hotel_id, module, moduleRows, agreements, entitlements);
        if (pricing.pricing_mode === "custom") continue;

        if (pricing.pricing_mode === "percent") {
          const pct = (settings.revenue_percent_bps / 100).toFixed(2).replace(/\.00$/, "");
          const itemIndex = lineItems.length;
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
          pickedItemIndexes.push(itemIndex);
          continue;
        }

        const unit = pricing.price_cents;
        const qty = pricing.pricing_mode === "fixed_monthly" ? 1 : hotel.rooms;
        if (unit <= 0 || qty <= 0) continue;

        // An organization-level fixed monthly agreement is one commercial charge
        // covering every selected property for that module, not one charge per hotel.
        const sharedKey = pricing.source === 'agreement' && pricing.agreement_key
          ? `agreement:${pricing.agreement_key}`
          : pricing.pricing_mode === "fixed_monthly" && pricing.source === "organization"
            ? `organization:${module}`
            : null;
        const existingSharedIndex = sharedKey ? sharedItemIndexes.get(sharedKey) : undefined;
        if (existingSharedIndex !== undefined) {
          picked.push(`${hotel.hotel_id}:${module}`);
          pickedItemIndexes.push(existingSharedIndex);
          continue;
        }

        const promotion = pricing.source === "standard" ? promotionForModule(settings, module) : null;
        const basis = sharedKey
          ? `Organization agreement · Fixed monthly fee ${(unit / 100).toFixed(2)} ${settings.currency} covering selected properties (excl. VAT)`
          : pricing.pricing_mode === "fixed_monthly"
            ? `Fixed monthly fee ${(unit / 100).toFixed(2)} ${settings.currency} (excl. VAT)`
            : `${qty} rooms × ${(unit / 100).toFixed(2)} ${settings.currency} per room / month (excl. VAT)`;
        const itemIndex = lineItems.length;

        lineItems.push({
          quantity: qty,
          price_data: {
            currency: settings.currency.toLowerCase(),
            unit_amount: unit,
            tax_behavior: "exclusive",
            recurring: { interval: "month" },
            product_data: {
              name: pricing.source === 'agreement'
                ? `${pricing.agreement_label ?? 'Negotiated modules'} — organization agreement`
                : sharedKey
                  ? `${moduleLabel(settings, module)} — organization agreement`
                  : `${moduleLabel(settings, module)} — ${hotel.hotel_name}`,
              description: `${basis}${promotion?.active ? ` · ${promotion.label}` : ""}`,
            },
          },
        });
        if (sharedKey) sharedItemIndexes.set(sharedKey, itemIndex);
        netCents += unit * qty;
        picked.push(`${hotel.hotel_id}:${module}`);
        pickedItemIndexes.push(itemIndex);
      }

      if (!lineItems.length) return json({ error: "Nothing billable in the selection" }, 400);
      meta.selections = picked.join(",");
      // Keeps module_subscriptions aligned when several hotel selections share one
      // organization-level Stripe subscription item.
      meta.selection_item_indexes = pickedItemIndexes.join(",");

      const existingCustomer = (subs ?? []).find((s) => s.stripe_customer_id)?.stripe_customer_id;
      const origin = String(body.returnUrl ?? req.headers.get("origin") ?? "");

      if (Deno.env.get("HOTELCARE_MANUAL_BILLING_ENABLED") === "true") {
        if (!settings.payments_enabled) return json({ error: "Payments are disabled for this organization" }, 403);
        const trialUntil = trialEndsAt(settings);
        if (trialUntil && new Date(trialUntil).getTime() > Date.now())
          return json({ error: "Wait until the free trial ends before starting paid monthly collection" }, 400);
        if (lineItems.some((line) => (line.price_data?.unit_amount ?? 0) <= 0) || netCents <= 0)
          return json({ error: "Percentage/zero-value plans require an agreed fixed amount before payment-only checkout" }, 400);
        const normalized = picked.map((pair, index) => {
          const [hotel_id, module] = pair.split(":");
          const itemIndex = pickedItemIndexes[index];
          const line = lineItems[itemIndex];
          return {
            hotel_id, module,
            quantity: pickedItemIndexes.indexOf(itemIndex) === index ? Number(line.quantity ?? 0) : 0,
            unit_amount_cents: Number(line.price_data?.unit_amount ?? 0),
          };
        });
        // The checkout session is a payment, not a Stripe subscription/invoice.
        const contractId = crypto.randomUUID();
        const contract = {
          id: contractId, organization_slug: slug, selections: picked, items: normalized,
          currency: settings.currency.toUpperCase(), net_cents: netCents,
          vat_percent_snapshot: Number(settings.vat_percent ?? 0), status: "pending",
        };
        const { error: draftError } = await db.from("manual_billing_contracts").insert(contract);
        if (draftError) throw draftError;
        let createdSessionId: string | null = null;
        try {
          const { error: scopeError } = await db.from("manual_billing_scopes")
            .insert(normalized.map((item) => ({ hotel_id: item.hotel_id, module: item.module, contract_id: contractId })));
          if (scopeError) throw new Error("These modules already have a pending/active payment contract: " + scopeError.message);

          const safeOrigin = req.headers.get("origin") ?? "";
          if (!/^https:\/\//.test(safeOrigin) && !/^http:\/\/localhost(:[0-9]+)?$/.test(safeOrigin))
            throw new Error("A valid checkout origin is required");
          const paymentItems: Stripe.Checkout.SessionCreateParams.LineItem[] = lineItems.map((line) => {
            if (!line.price_data) throw new Error("Unexpected stored-price line");
            const { recurring: _recurring, ...oneTimePrice } = line.price_data;
            return { ...line, price_data: oneTimePrice };
          });
          const sessionData: Stripe.Checkout.SessionCreateParams = {
            mode: "payment", line_items: paymentItems, customer: existingCustomer ?? undefined,
            customer_creation: existingCustomer ? undefined : "always",
            customer_update: existingCustomer ? { name: "auto", address: "auto" } : undefined,
            billing_address_collection: "required", tax_id_collection: { enabled: true },
            payment_method_types: ["card"],
            custom_text: { submit: { message:
              "By paying, you authorize automatic monthly card charges for your HotelCare services until cancelled. You can cancel future renewals from HotelCare Billing. Official VAT invoices are issued separately through Számlázz.hu." } },
            payment_intent_data: { setup_future_usage: "off_session",
              metadata: { kind: "hotelcare_manual_initial", organization_slug: slug, manual_contract_id: contractId } },
            invoice_creation: { enabled: false },
            client_reference_id: contractId,
            metadata: { kind: "hotelcare_manual_monthly", organization_slug: slug, manual_contract_id: contractId },
            success_url: safeOrigin + "/billing?billing=success",
            cancel_url: safeOrigin + "/billing?billing=cancelled",
          };
          // Stripe Tax validates the buyer's location and tax IDs. Never apply
          // a blanket 27% to foreign B2B buyers when registration is absent.
          const taxRegistrations = await stripe.tax.registrations.list({ status: "active", limit: 1 });
          if (!taxRegistrations.data.length)
            throw new Error("Configure Stripe Tax registrations before payment-only checkout to validate VAT");
          const paymentSession = await stripe.checkout.sessions.create({
            ...sessionData,
            automatic_tax: { enabled: true },
          });
          createdSessionId = paymentSession.id;
          const { error: sessionError } = await db.from("manual_billing_contracts")
            .update({ stripe_checkout_session_id: paymentSession.id })
            .eq("id", contractId).eq("status", "pending");
          if (sessionError) {
            await stripe.checkout.sessions.expire(paymentSession.id).catch((error) =>
              console.error("MANUAL REVIEW: Checkout session could not be expired", paymentSession.id, error));
            throw sessionError;
          }
          return json({ url: paymentSession.url, mode: "payment", invoicing: "szamlazz_manual" });
        } catch (error) {
          // Never release a reservation when a Stripe session might still accept
          // payment. An operator must reconcile a potentially orphaned session.
          if (!createdSessionId) {
            await db.from("manual_billing_contracts").delete().eq("id", contractId).eq("status", "pending");
          } else {
            console.error("MANUAL REVIEW: Stripe Checkout session was created", createdSessionId, error);
          }
          throw error;
        }
      }

      const trialEnd = trialEndsAt(settings);
      const graceDays = Math.max(0, Number(settings.grace_days ?? 0));
      const freeUntil = trialEnd
        ? new Date(new Date(trialEnd).getTime() + graceDays * 86400000).toISOString()
        : null;
      const trialEndSec = freeUntil ? Math.floor(new Date(freeUntil).getTime() / 1000) : 0;
      const nowSec = Math.floor(Date.now() / 1000);
      const useTrial = trialEndSec > nowSec + 48 * 3600 + 300;

      const base: Stripe.Checkout.SessionCreateParams = {
        mode: "subscription",
        line_items: lineItems,
        customer: existingCustomer ?? undefined,
        billing_address_collection: "required",
        payment_method_collection: "always",
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
        trial_end: useTrial ? freeUntil : null,
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