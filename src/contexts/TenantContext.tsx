import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { isTransientBackendError, retryTransient } from '@/lib/transientRetry';
import { isOwnOrganizationRoute, restrictHotelsToOrganization } from '@/lib/tenantRouteScope';

interface Organization {
  id: string;
  name: string;
  slug: string;
  settings: any;
  is_active: boolean;
}

interface HotelConfig {
  id: string;
  hotel_name: string;
  hotel_id: string;
  organization_id: string;
  settings: any;
  is_active: boolean;
}

interface TenantContextType {
  organization: Organization | null;
  hotels: HotelConfig[];
  loading: boolean;
  error: string | null;
  refreshTenant: () => Promise<void>;
}

const TenantContext = createContext<TenantContextType | undefined>(undefined);

export const TenantProvider: React.FC<{
  children: React.ReactNode;
  organizationSlug: string;
}> = ({ children, organizationSlug }) => {
  const { user, profile, loading: authLoading, profileStatus } = useAuth();
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [hotels, setHotels] = useState<HotelConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Reject late responses when the signed-in user or route changes mid-request.
  const requestVersion = useRef(0);

  const fetchTenantData = async () => {
    const version = ++requestVersion.current;
    const isCurrent = () => version === requestVersion.current;
    setLoading(true);
    setError(null);
    setOrganization(null);
    setHotels([]);

    // A route parameter and a client-side hotel choice are not tenant permissions.
    if (!user || !profile || user.id !== profile.id ||
        !isOwnOrganizationRoute(profile.organization_slug, organizationSlug)) {
      setError('This organization is not available for your account.');
      setLoading(false);
      return;
    }

    try {
      // Some manager accounts cannot read organizations directly under RLS.
      const { data: orgData, error: orgError } = await retryTransient(async () => {
        const result = await supabase
          .from('organizations')
          .select('*')
          .eq('slug', organizationSlug)
          .eq('is_active', true)
          .single();
        if (result.error && result.error.code !== 'PGRST116' && isTransientBackendError(result.error)) throw result.error;
        return result;
      }, { attempts: 4 });
      if (!isCurrent()) return;

      if (orgError || !orgData) {
        // Only a SECURITY DEFINER RPC which derives the organization from
        // auth.uid() can recover a manager whose direct organization SELECT
        // is hidden by RLS. A hotel-only RPC cannot prove caller ownership.
        const { data: verifiedContext, error: contextError } = await retryTransient(async () => {
          const result = await supabase.rpc('get_authenticated_tenant_context' as any,
            { _organization_slug: organizationSlug } as any);
          if (result.error) throw result.error;
          return result;
        }, { attempts: 4 });
        if (!isCurrent()) return;
        if (contextError) throw contextError;

        const payload = verifiedContext as unknown as {
          organization?: Organization;
          hotels?: HotelConfig[];
        } | null;
        const verifiedOrg = payload?.organization;
        if (!verifiedOrg?.id || !verifiedOrg.is_active ||
            !isOwnOrganizationRoute(profile.organization_slug, verifiedOrg.slug) ||
            verifiedOrg.slug !== organizationSlug || !Array.isArray(payload?.hotels)) {
          setError('Organization access could not be verified. Please contact an administrator.');
          setLoading(false);
          return;
        }
        // The server verifies the caller; this extra filter guards against a
        // future malformed response without granting any new permissions.
        setOrganization(verifiedOrg);
        setHotels(restrictHotelsToOrganization(payload.hotels, verifiedOrg.id));
        setLoading(false);
        return;
      }

      if (!isOwnOrganizationRoute(profile.organization_slug, orgData.slug)) {
        setError('Organization mismatch. Access denied.');
        setLoading(false);
        return;
      }
      setOrganization(orgData);

      const { data: hotelsData, error: hotelsError } = await retryTransient(async () => {
        const result = await supabase
          .from('hotel_configurations')
          .select('*')
          .eq('organization_id', orgData.id)
          .eq('is_active', true)
          .order('hotel_name');
        if (result.error) throw result.error;
        return result;
      }, { attempts: 4 });
      if (!isCurrent()) return;

      if (hotelsError) {
        setError(hotelsError.message);
      } else {
        setHotels(restrictHotelsToOrganization((hotelsData ?? []) as HotelConfig[], orgData.id));
      }
      setLoading(false);
    } catch (err) {
      if (!isCurrent()) return;
      console.error('Error in fetchTenantData:', err);
      setOrganization(null);
      setHotels([]);
      setError('Failed to load organization data');
      setLoading(false);
    }
  };

  useEffect(() => {
    // Invalidate any outstanding responses before allowing a new identity
    // or organization to render tenant-specific information.
    requestVersion.current += 1;
    if (authLoading) {
      setOrganization(null);
      setHotels([]);
      setLoading(true);
      return;
    }
    if (!user || !profile || user.id !== profile.id) {
      setOrganization(null);
      setHotels([]);
      setError(user && (profileStatus === 'failed' || profileStatus === 'missing')
        ? 'Unable to load your account profile.' : null);
      setLoading(Boolean(user && profileStatus !== 'failed' && profileStatus !== 'missing'));
      return;
    }
    void fetchTenantData();
    return () => { requestVersion.current += 1; };
  }, [organizationSlug, user?.id, profile?.id, profile?.organization_slug, authLoading, profileStatus]);

  const refreshTenant = async () => {
    await fetchTenantData();
  };

  return (
    <TenantContext.Provider value={{ organization, hotels, loading, error, refreshTenant }}>
      {children}
    </TenantContext.Provider>
  );
};

export const useTenant = () => {
  const context = useContext(TenantContext);
  if (context === undefined) {
    throw new Error('useTenant must be used within a TenantProvider');
  }
  return context;
};
