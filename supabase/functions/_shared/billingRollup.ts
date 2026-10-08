// Monthly settlement of percentage-based Revenue Management.
//
// Called automatically: on every Payments/admin summary load and from the
// monthly cron function. Trial months are never charged.

import Stripe from "npm:stripe@18";
import {
  admin,
  lastMonthRange,
  percentFeeCents,
  realisedRevenueCents,
  isRevenueModule,
  normaliseModule,
  trialCoversPeriod,
  type BillingSettings,
} from "./billing.ts";

export type UsageRow = {
  hotel_id: string;
  hotel_name: string;
  period_start: string;
  period_end: string;
  revenue_cents: number;
  room_nights: number;
  /** Amount actually charged — always 0 while the trial covers the month. */
  fee_cents: number;
  /** What the month would have cost without the trial (0 outside the trial). */
  waived_fee_cents: number;
  trial_waived: boolean;
  invoiced: boolean;
};

export function stripeClient() {
  const key = Deno.env.get("STRIPE_SECRET_KEY");
  if (!key) return null;
  return new Stripe(key, { apiVersion: "2025-03-31.basil" });
}

export async function rollupLastMonth(
  slug: string,
  settings: BillingSettings,
  hotels: { hotel_id: string; hotel_name: string; rooms: number }[],
  subs: any[],
  stripe: Stripe | null,
): Promise<{ period_start: string; period_end: string; rows: UsageRow[] }> {
  const db = admin();
  const { start, end } = lastMonthRange();
  const inTrial = trialCoversPeriod(settings, end);
  const { data: propertyTrials, error: trialError } = await db
    .from('billing_module_trials')
    .select('hotel_id,module,enabled,starts_on,ends_on')
    .eq('organization_slug', slug)
    .eq('enabled', true);
  if (trialError) console.warn('Individual billing trials unavailable',trialError.message);
  const rows: UsageRow[] = [];

  for (const hotel of hotels) {
    const { revenueCents, roomNights } = await realisedRevenueCents(hotel.hotel_id, start, end);
    const grossFee = revenueCents > 0 ? percentFeeCents(settings, revenueCents) : 0;

    const { data: existing } = await db
      .from("billing_revenue_usage")
      .select("id, billed_at, stripe_invoice_item_id, fee_cents")
      .eq("organization_slug", slug)
      .eq("hotel_id", hotel.hotel_id)
      .eq("period_month", start)
      .maybeSingle();

    const revenueSubs = (subs ?? []).filter((s) =>
      s.hotel_id === hotel.hotel_id && isRevenueModule(String(s.module)) &&
      ['active','past_due','trialing'].includes(String(s.status)));
    // A month that overlaps a selected module's free trial is waived in full.
    // Preserve months already invoiced; no retrospective Stripe refund or credit.
    const individualTrial = (propertyTrials ?? []).some((trial) =>
      trial.hotel_id === hotel.hotel_id && trial.enabled &&
      trial.starts_on < end && trial.ends_on >= start &&
      (revenueSubs.length === 0 || revenueSubs.some((sub) => normaliseModule(String(sub.module)) === normaliseModule(String(trial.module))))
    );
    const trialWaived = (inTrial || individualTrial) && !existing?.billed_at;
    const feeCents = trialWaived ? 0 : grossFee;

    const usageRow = {
      organization_slug: slug,
      hotel_id: hotel.hotel_id,
      period_month: start,
      realised_revenue_cents: revenueCents,
      room_nights: roomNights,
      currency: settings.currency,
      percent_bps: settings.revenue_percent_bps,
      fee_cents: feeCents,
      updated_at: new Date().toISOString(),
    };
    if (existing?.id) await db.from("billing_revenue_usage").update(usageRow).eq("id", existing.id);
    else await db.from("billing_revenue_usage").insert(usageRow);

    let invoiced = Boolean(existing?.billed_at);
    const sub = (subs ?? []).find(
      (s) => s.hotel_id === hotel.hotel_id && isRevenueModule(String(s.module)) && s.stripe_customer_id,
    );
    const chargeable =
      !trialWaived && !invoiced && feeCents > 0 && stripe && sub &&
      ["active", "past_due"].includes(String(sub.status));

    if (chargeable) {
      const item = await stripe!.invoiceItems.create({
        customer: String(sub!.stripe_customer_id),
        currency: settings.currency.toLowerCase(),
        amount: feeCents,
        description:
          `Revenue Management — ${hotel.hotel_name} · ${start.slice(0, 7)} · ` +
          `${(settings.revenue_percent_bps / 100).toFixed(2).replace(/\.00$/, "")}% of ` +
          `${(revenueCents / 100).toFixed(2)} ${settings.currency} realised revenue (excl. VAT)`,
        metadata: { organization_slug: slug, hotel_id: hotel.hotel_id, period_month: start },
      });
      await db
        .from("billing_revenue_usage")
        .update({ billed_at: new Date().toISOString(), stripe_invoice_item_id: item.id })
        .eq("organization_slug", slug)
        .eq("hotel_id", hotel.hotel_id)
        .eq("period_month", start);
      invoiced = true;
    }

    rows.push({
      hotel_id: hotel.hotel_id,
      hotel_name: hotel.hotel_name,
      period_start: start,
      period_end: end,
      revenue_cents: revenueCents,
      room_nights: roomNights,
      fee_cents: feeCents,
      waived_fee_cents: trialWaived ? grossFee : 0,
      trial_waived: trialWaived,
      invoiced,
    });
  }

  return { period_start: start, period_end: end, rows };
}
