import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export type BillingModule = 'revenue_bi' | 'revenue_automation' | 'operations' | 'maintenance';

/** Old rows/clients used a single 'revenue' key — it means the automation tier. */
export function normaliseModule(module: string): BillingModule {
  return (module === 'revenue' ? 'revenue_automation' : module) as BillingModule;
}

export function isRevenueModule(module: string) {
  return ['revenue', 'revenue_bi', 'revenue_automation'].includes(module);
}

export interface BillingSettings {
  organization_slug: string;
  currency: string;
  revenue_price_cents: number;
  revenue_module_enabled: boolean;
  operations_price_cents: number;
  operations_module_enabled: boolean;
  operations_module_label: string;
  trial_enabled: boolean;
  trial_months: number;
  trial_start: string;
  stripe_publishable_key: string | null;
  payments_enabled: boolean;
  stripe_secret_configured?: boolean;
  /** Analytics-only Revenue tier. */
  revenue_bi_price_cents: number;
  /** Revenue tier including the automated pricing engine. */
  revenue_automation_price_cents: number;
  maintenance_module_enabled: boolean;
  maintenance_pricing_mode: 'custom' | 'per_room';
  maintenance_price_cents: number;
  /** VAT added on top of every net amount (27% in Hungary). */
  vat_percent: number;
  billing_company_name: string | null;
  billing_address_line1: string | null;
  billing_address_line2: string | null;
  billing_address_city: string | null;
  billing_address_postal_code: string | null;
  billing_address_country: string | null;
  billing_tax_id: string | null;
  /** 'per_room' = fixed price per room, 'percent' = share of realised revenue. */
  revenue_pricing_mode: 'per_room' | 'percent';
  revenue_percent_bps: number;
  revenue_percent_min_cents: number;
  revenue_percent_cap_cents: number;
  /** Standard (list) prices — shown struck through while the promotion runs. */
  standard_revenue_bi_price_cents: number;
  standard_revenue_automation_price_cents: number;
  standard_operations_price_cents: number;
  /** Housekeeping promotion. Dates are inclusive; null means no boundary. */
  operations_promotion_enabled: boolean;
  operations_promotion_label: string;
  operations_promotion_note: string;
  operations_promotion_starts_on: string | null;
  operations_promotion_ends_on: string | null;
  /** Revenue promotion shared by BI and BI + Automation, with separate prices per tier. */
  revenue_promotion_enabled: boolean;
  revenue_promotion_label: string;
  revenue_promotion_note: string;
  revenue_promotion_starts_on: string | null;
  revenue_promotion_ends_on: string | null;
  /** Legacy single-promotion fields kept while older clients age out. */
  early_bird_enabled: boolean;
  early_bird_label: string;
  early_bird_note: string;
  early_bird_ends_at: string | null;
  /** Days of continued access after the free trial ends. */
  grace_days: number;
}


/** Last full month's realised revenue and the resulting percentage fee. */
export interface RevenueUsage {
  hotel_id: string;
  hotel_name?: string;
  period_start: string;
  period_end: string;
  revenue_cents: number;
  room_nights: number;
  /** Charged amount — always 0 while the free trial covers the month. */
  fee_cents: number;
  /** What the month would have cost without the trial. */
  waived_fee_cents?: number;
  trial_waived?: boolean;
  invoiced?: boolean;
}

export interface BillingHotel {
  hotel_id: string;
  hotel_name: string;
  rooms: number;
}

export interface ModuleSubscription {
  hotel_id: string;
  module: BillingModule;
  status: string;
  quantity: number;
  unit_amount_cents: number;
  currency: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
}

export interface BillingInvoice {
  id: string;
  number: string | null;
  created: number;
  period_start: number;
  period_end: number;
  currency: string;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  status: string | null;
  hosted_invoice_url: string | null;
  invoice_pdf: string | null;
}

export interface BillingSummary {
  settings: BillingSettings;
  hotels: BillingHotel[];
  subscriptions: ModuleSubscription[];
  trial_ends_at: string | null;
  revenue_usage?: RevenueUsage[];
}

const ACTIVE = ['active', 'trialing', 'past_due'];

export function isSubscriptionActive(sub?: ModuleSubscription | null) {
  return !!sub && ACTIVE.includes(sub.status);
}

export function trialIsRunning(summary: BillingSummary | null) {
  if (!summary?.trial_ends_at) return false;
  return new Date(summary.trial_ends_at).getTime() > Date.now();
}

/** End of the courtesy access period an administrator grants after the trial. */
export function graceEndsAt(summary: BillingSummary | null): string | null {
  if (!summary?.trial_ends_at) return null;
  const days = Math.max(0, Number(summary.settings?.grace_days ?? 14));
  if (!days) return null;
  return new Date(new Date(summary.trial_ends_at).getTime() + days * 86400000).toISOString();
}

/** True once the trial is over but the courtesy period still runs. */
export function inGracePeriod(summary: BillingSummary | null) {
  if (!summary || trialIsRunning(summary)) return false;
  const end = graceEndsAt(summary);
  return !!end && new Date(end).getTime() > Date.now();
}

/** Access is open while the trial runs, during the grace period, or when paid. */
function courtesyOpen(summary: BillingSummary | null) {
  return trialIsRunning(summary) || inGracePeriod(summary);
}

/** A module is usable while the trial runs or a subscription is active. */
export function moduleUnlocked(summary: BillingSummary | null, hotelId: string, module: BillingModule) {
  if (!summary) return true;
  if (courtesyOpen(summary)) return true;
  return isSubscriptionActive(
    summary.subscriptions.find(
      (s) => s.hotel_id === hotelId && normaliseModule(s.module) === normaliseModule(module),
    ),
  );
}

/** Any Revenue tier unlocks the revenue screens. */
export function revenueUnlocked(summary: BillingSummary | null, hotelId: string) {
  if (!summary) return true;
  if (courtesyOpen(summary)) return true;
  return summary.subscriptions.some(
    (s) => s.hotel_id === hotelId && isRevenueModule(s.module) && isSubscriptionActive(s),
  );
}

/** Only the BI + Automation tier unlocks the automated pricing engine. */
export function automationUnlocked(summary: BillingSummary | null, hotelId: string) {
  if (!summary) return true;
  if (courtesyOpen(summary)) return true;
  return moduleUnlocked(summary, hotelId, 'revenue_automation');
}

/** Standard (pre-promotion) list price for a module, in cents. */
export function listPriceFor(settings: BillingSettings | undefined | null, module: BillingModule) {
  if (!settings) return 0;
  switch (normaliseModule(module)) {
    case 'revenue_bi':
      return settings.standard_revenue_bi_price_cents ?? 0;
    case 'revenue_automation':
      return settings.standard_revenue_automation_price_cents ?? 0;
    case 'operations':
      return settings.standard_operations_price_cents ?? 0;
    case 'maintenance':
      return settings.maintenance_pricing_mode === 'per_room' ? settings.maintenance_price_cents ?? 0 : 0;
    default:
      return 0;
  }
}

/** Price configured for the promotional window. */
export function promotionalPriceFor(settings: BillingSettings | undefined | null, module: BillingModule) {
  if (!settings) return 0;
  switch (normaliseModule(module)) {
    case 'revenue_bi':
      return settings.revenue_bi_price_cents ?? 0;
    case 'revenue_automation':
      return settings.revenue_automation_price_cents || settings.revenue_price_cents || 0;
    case 'operations':
      return settings.operations_price_cents ?? 0;
    case 'maintenance':
      return settings.maintenance_pricing_mode === 'per_room' ? settings.maintenance_price_cents ?? 0 : 0;
    default:
      return 0;
  }
}

export type PromotionStatus = 'disabled' | 'scheduled' | 'active' | 'ended' | 'invalid';

export type ModulePromotion = {
  scope: 'operations' | 'revenue';
  enabled: boolean;
  active: boolean;
  status: PromotionStatus;
  label: string;
  note: string;
  startsOn: string | null;
  endsOn: string | null;
  regularPriceCents: number;
  promotionalPriceCents: number;
  savingsPercent: number;
};

const dateKey = (value: Date | string) =>
  typeof value === 'string'
    ? value.slice(0, 10)
    : new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Budapest' }).format(value);

/** Module-specific promotion state. Start and end dates both include the selected day. */
export function promotionForModule(
  settings: BillingSettings | undefined | null,
  module: BillingModule,
  asOf: Date | string = new Date(),
): ModulePromotion | null {
  if (!settings || normaliseModule(module) === 'maintenance') return null;

  const scope = normaliseModule(module) === 'operations' ? 'operations' : 'revenue';
  const enabled = scope === 'operations'
    ? settings.operations_promotion_enabled
    : settings.revenue_promotion_enabled;
  const label = scope === 'operations'
    ? settings.operations_promotion_label
    : settings.revenue_promotion_label;
  const note = scope === 'operations'
    ? settings.operations_promotion_note
    : settings.revenue_promotion_note;
  const startsOn = scope === 'operations'
    ? settings.operations_promotion_starts_on
    : settings.revenue_promotion_starts_on;
  const endsOn = scope === 'operations'
    ? settings.operations_promotion_ends_on
    : settings.revenue_promotion_ends_on;
  const regularPriceCents = listPriceFor(settings, module);
  const promotionalPriceCents = promotionalPriceFor(settings, module);
  const validPrice = regularPriceCents > 0 && promotionalPriceCents > 0 && promotionalPriceCents < regularPriceCents;
  const validDates = !startsOn || !endsOn || startsOn <= endsOn;
  const today = dateKey(asOf);

  let status: PromotionStatus = 'disabled';
  if (enabled && (!validPrice || !validDates)) status = 'invalid';
  else if (enabled && startsOn && today < startsOn) status = 'scheduled';
  else if (enabled && endsOn && today > endsOn) status = 'ended';
  else if (enabled) status = 'active';

  return {
    scope,
    enabled,
    active: status === 'active',
    status,
    label: label || (scope === 'operations' ? 'Housekeeping offer' : 'Revenue Management offer'),
    note: note || '',
    startsOn,
    endsOn,
    regularPriceCents,
    promotionalPriceCents,
    savingsPercent: validPrice
      ? Math.round((1 - promotionalPriceCents / regularPriceCents) * 10000) / 100
      : 0,
  };
}

/** Amount a new checkout must use today. */
export function effectivePriceFor(
  settings: BillingSettings | undefined | null,
  module: BillingModule,
  asOf: Date | string = new Date(),
) {
  if (!settings) return 0;
  if (normaliseModule(module) === 'maintenance') return promotionalPriceFor(settings, module);
  const promotion = promotionForModule(settings, module, asOf);
  return promotion?.active ? promotion.promotionalPriceCents : listPriceFor(settings, module);
}

/** Backward-compatible aggregate used by any client still expecting a single promotion flag. */
export function earlyBirdActive(settings: BillingSettings | undefined | null, asOf: Date | string = new Date()) {
  return Boolean(
    promotionForModule(settings, 'operations', asOf)?.active ||
      promotionForModule(settings, 'revenue_automation', asOf)?.active,
  );
}

/** One-off read of the billing summary (used by the activation gate). */
export async function fetchBillingSummary(organizationSlug?: string | null) {
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return null;
  const { data } = await supabase.functions.invoke('billing-manage', {
    body: { action: 'summary', organizationSlug: organizationSlug ?? undefined },
  });
  const payload = data as (BillingSummary & { error?: string }) | null;
  if (!payload || payload.error) return null;
  return payload;
}


/** VAT for a net amount, using the organization's rate. */
export function vatCents(summary: BillingSummary | null, netCents: number) {
  const pct = Number(summary?.settings?.vat_percent ?? 27) || 0;
  return Math.round((netCents * pct) / 100);
}

export function formatMoney(cents: number, currency: string) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currency || 'EUR',
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export function useBilling(organizationSlug?: string | null) {
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    // Billing requires a real user token; invoking before the session is
    // restored sends the anon key and returns 401.
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) { setLoading(false); return; }
    const { data, error: err } = await supabase.functions.invoke('billing-manage', {
      body: { action: 'summary', organizationSlug: organizationSlug ?? undefined },
    });
    if (err) setError(err.message);
    else if ((data as { error?: string })?.error) setError((data as { error: string }).error);
    else setSummary(data as BillingSummary);
    setLoading(false);
  }, [organizationSlug]);

  useEffect(() => {
    load();
  }, [load]);

  return { summary, loading, error, reload: load };
}
