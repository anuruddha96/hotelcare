// Tenant feature flags.
//
// SLNT Group runs ~60 short-term / long-term rental units spread over many
// physical addresses, under a single merged property with two Previo
// accounts. Rather than forking the app we gate the extra behaviour behind
// per-organization flags. Every organization that is not explicitly listed
// keeps today's behaviour byte-for-byte (RD Hotels, Ottofiori, test orgs).

export type TenantFeatures = {
  /** Group units by physical venue/address and expose venue management. */
  venuesEnabled: boolean;
  /** Supervisors / housekeepers can be scoped to a subset of venues. */
  scopedStaffEnabled: boolean;
  /** One property may aggregate several PMS accounts into a single view. */
  multiPmsAccounts: boolean;
  /** Housekeeping-first tenant: revenue / breakfast modules are irrelevant. */
  housekeepingOnly: boolean;
};

const DEFAULT_FEATURES: TenantFeatures = {
  venuesEnabled: false,
  scopedStaffEnabled: false,
  multiPmsAccounts: false,
  housekeepingOnly: false,
};

const SLNT_FEATURES: Partial<TenantFeatures> = {
  venuesEnabled: true,
  scopedStaffEnabled: true,
  multiPmsAccounts: true,
  housekeepingOnly: true,
};

const ORG_FEATURES: Record<string, Partial<TenantFeatures>> = {
  slnt: SLNT_FEATURES,
  'slnt-group': SLNT_FEATURES,
};

/**
 * Resolve flags for an organization slug. `settings` (from
 * `organizations.settings`) can override any flag at runtime so a super admin
 * can flip behaviour without a deploy.
 */
export function tenantFeaturesFor(
  orgSlug: string | null | undefined,
  settings?: Record<string, unknown> | null,
): TenantFeatures {
  const slug = (orgSlug ?? '').toLowerCase();
  const base = { ...DEFAULT_FEATURES, ...(ORG_FEATURES[slug] ?? {}) };

  const overrides = (settings?.features ?? null) as Partial<TenantFeatures> | null;
  if (!overrides || typeof overrides !== 'object') return base;

  return {
    venuesEnabled: overrides.venuesEnabled ?? base.venuesEnabled,
    scopedStaffEnabled: overrides.scopedStaffEnabled ?? base.scopedStaffEnabled,
    multiPmsAccounts: overrides.multiPmsAccounts ?? base.multiPmsAccounts,
    housekeepingOnly: overrides.housekeepingOnly ?? base.housekeepingOnly,
  };
}

export function isVenueTenant(orgSlug: string | null | undefined): boolean {
  return tenantFeaturesFor(orgSlug).venuesEnabled;
}
