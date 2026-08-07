import { useMemo } from 'react';
import { useTenant } from '@/contexts/TenantContext';
import { useAuth } from '@/hooks/useAuth';
import { tenantFeaturesFor, type TenantFeatures } from '@/lib/tenantFeatures';

/**
 * Feature flags for the current tenant. Safe to call outside a TenantProvider
 * (falls back to the profile's organization_slug, then to defaults, which
 * means "behave exactly as before").
 */
export function useTenantFeatures(): TenantFeatures & { orgSlug: string | null } {
  const { profile } = useAuth();

  let orgSlug: string | null = profile?.organization_slug ?? null;
  let settings: Record<string, unknown> | null = null;
  try {
    const tenant = useTenant();
    orgSlug = tenant.organization?.slug ?? orgSlug;
    settings = (tenant.organization?.settings ?? null) as Record<string, unknown> | null;
  } catch {
    /* rendered above TenantProvider — use profile slug */
  }

  return useMemo(
    () => ({ ...tenantFeaturesFor(orgSlug, settings), orgSlug }),
    [orgSlug, settings],
  );
}
