import {
  admin,
  isRevenueModule,
  normaliseModule,
  priceFor,
  type BillingSettings,
  type ModuleKey,
} from './billing.ts';

export type BillingPricingMode = 'per_room' | 'fixed_monthly' | 'percent' | 'custom';

export type ModuleOverrideRow = {
  hotel_id: string | null;
  module: ModuleKey;
  pricing_mode: 'inherit' | 'per_room' | 'fixed_monthly';
  price_cents: number;
};

export type AccessOverrideRow = {
  hotel_id: string | null;
  bypass_billing: boolean;
  expires_at: string | null;
};

export type ResolvedModulePricing = {
  hotel_id: string;
  module: ModuleKey;
  pricing_mode: BillingPricingMode;
  price_cents: number;
  source: 'standard' | 'organization' | 'hotel' | 'agreement';
  agreement_key?: string;
  agreement_label?: string;
};

export type FixedAgreement = { agreement_code: string; label: string; price_cents: number; enabled: boolean };
export type AgreementEntitlement = { agreement_code: string; hotel_id: string; module: ModuleKey; enabled: boolean };
export type ModuleTrial = { hotel_id: string; module: ModuleKey; enabled: boolean; starts_on: string; ends_on: string };

export async function loadBillingOverrides(organizationSlug: string) {
  const db = admin();
  const [{ data: moduleRows, error: moduleError }, { data: accessRows, error: accessError },
    { data: agreements, error: agreementError }, { data: entitlements, error: entitlementError },
    { data: trials, error: trialError }] = await Promise.all([
    db
      .from('billing_module_overrides')
      .select('hotel_id, module, pricing_mode, price_cents')
      .eq('organization_slug', organizationSlug),
    db
      .from('billing_access_overrides')
      .select('hotel_id, bypass_billing, expires_at')
      .eq('organization_slug', organizationSlug),
    db.from('billing_fixed_agreements').select('agreement_code,label,price_cents,enabled').eq('organization_slug', organizationSlug),
    db.from('billing_agreement_entitlements').select('agreement_code,hotel_id,module,enabled').eq('organization_slug', organizationSlug),
    db.from('billing_module_trials').select('hotel_id,module,enabled,starts_on,ends_on').eq('organization_slug', organizationSlug),
  ]);

  // The new tables may not exist during a staggered deploy. In that case billing
  // keeps using the legacy settings rather than taking Payments offline.
  if (moduleError) console.warn('billing module overrides unavailable', moduleError.message);
  if (accessError) console.warn('billing access overrides unavailable', accessError.message);
  if (agreementError) console.warn('billing agreements unavailable', agreementError.message);
  if (entitlementError) console.warn('billing entitlements unavailable', entitlementError.message);
  if (trialError) console.warn('billing trials unavailable', trialError.message);

  return {
    moduleRows: (moduleRows ?? []) as ModuleOverrideRow[],
    accessRows: (accessRows ?? []) as AccessOverrideRow[],
    agreements: (agreements ?? []) as FixedAgreement[],
    entitlements: (entitlements ?? []) as AgreementEntitlement[],
    trials: (trials ?? []) as ModuleTrial[],
  };
}

function usableOverride(row: ModuleOverrideRow | undefined) {
  return row && row.pricing_mode !== 'inherit' && Number(row.price_cents) > 0 ? row : null;
}

export function resolveModulePricing(
  settings: BillingSettings,
  hotelId: string,
  module: ModuleKey,
  rows: ModuleOverrideRow[],
  agreements: FixedAgreement[] = [],
  entitlements: AgreementEntitlement[] = [],
): ResolvedModulePricing {
  const key = normaliseModule(module);
  const hotelRow = usableOverride(
    rows.find((row) => row.hotel_id === hotelId && normaliseModule(row.module) === key),
  );
  // The explicitly agreed property-specific price wins even over a shared contract.
  if (hotelRow) {
    return { hotel_id: hotelId, module: key, pricing_mode: hotelRow.pricing_mode,
      price_cents: Number(hotelRow.price_cents), source: 'hotel' };
  }
  const matched = entitlements.find((row) => row.enabled && row.hotel_id === hotelId && normaliseModule(row.module) === key);
  const fixed = matched && agreements.find((row) => row.enabled && row.agreement_code === matched.agreement_code);
  if (fixed && fixed.price_cents > 0) {
    return {
      hotel_id: hotelId, module: key, pricing_mode: 'fixed_monthly', price_cents: fixed.price_cents,
      source: 'agreement', agreement_key: fixed.agreement_code, agreement_label: fixed.label,
    };
  }
  const orgRow = usableOverride(
    rows.find((row) => row.hotel_id == null && normaliseModule(row.module) === key),
  );
  const override = orgRow;

  if (override) {
    return {
      hotel_id: hotelId,
      module: key,
      pricing_mode: override.pricing_mode,
      price_cents: Number(override.price_cents),
      source: 'organization',
    };
  }

  if (isRevenueModule(key) && settings.revenue_pricing_mode !== 'per_room') {
    return { hotel_id: hotelId, module: key, pricing_mode: 'percent', price_cents: 0, source: 'standard' };
  }
  if (key === 'maintenance' && settings.maintenance_pricing_mode !== 'per_room') {
    return { hotel_id: hotelId, module: key, pricing_mode: 'custom', price_cents: 0, source: 'standard' };
  }

  return {
    hotel_id: hotelId,
    module: key,
    pricing_mode: 'per_room',
    price_cents: priceFor(settings, key),
    source: 'standard',
  };
}

function rowActive(row: AccessOverrideRow | undefined) {
  if (!row?.bypass_billing) return false;
  if (!row.expires_at) return true;
  return new Date(row.expires_at).getTime() > Date.now();
}

export function resolveBillingBypass(rows: AccessOverrideRow[], hotelId: string) {
  const hotel = rows.find((row) => row.hotel_id === hotelId);
  if (rowActive(hotel)) return { active: true, scope: 'hotel' as const };
  const organization = rows.find((row) => row.hotel_id == null);
  if (rowActive(organization)) return { active: true, scope: 'organization' as const };
  return { active: false, scope: null };
}
