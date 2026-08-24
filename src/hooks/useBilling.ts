import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export type BillingModule = 'revenue' | 'operations';

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
  /** 'per_room' = fixed price per room, 'percent' = share of realised revenue. */
  revenue_pricing_mode: 'per_room' | 'percent';
  revenue_percent_bps: number;
  revenue_percent_min_cents: number;
  revenue_percent_cap_cents: number;
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

/** A module is usable while the trial runs or a subscription is active. */
export function moduleUnlocked(summary: BillingSummary | null, hotelId: string, module: BillingModule) {
  if (!summary) return true;
  if (trialIsRunning(summary)) return true;
  return isSubscriptionActive(
    summary.subscriptions.find((s) => s.hotel_id === hotelId && s.module === module),
  );
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
