import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTenantFeatures } from '@/hooks/useTenantFeatures';

export type Venue = {
  id: string;
  hotel_id: string;
  organization_slug: string;
  name: string;
  address: string | null;
  notes: string | null;
  sort_order: number;
  is_active: boolean;
};

/**
 * Venues (physical addresses/buildings) for the current tenant, plus the
 * venue ids the signed-in user is scoped to.
 *
 * For tenants without the venue feature this returns empty data and never
 * queries, so existing organizations are untouched.
 */
export function useVenues() {
  const { profile } = useAuth();
  const { venuesEnabled, orgSlug } = useTenantFeatures();
  const [venues, setVenues] = useState<Venue[]>([]);
  const [myVenueIds, setMyVenueIds] = useState<string[]>([]);
  const [hasScopes, setHasScopes] = useState(false);
  const [loading, setLoading] = useState(venuesEnabled);

  const slug = orgSlug ?? profile?.organization_slug ?? null;

  const refresh = useCallback(async () => {
    if (!venuesEnabled || !slug) {
      setVenues([]);
      setMyVenueIds([]);
      setHasScopes(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    const [{ data: venueRows }, { data: scopeRows }] = await Promise.all([
      supabase
        .from('venues')
        .select('id, hotel_id, organization_slug, name, address, notes, sort_order, is_active')
        .eq('organization_slug', slug)
        .eq('is_active', true)
        .order('sort_order')
        .order('name'),
      profile?.id
        ? supabase.from('user_property_scopes').select('venue_id').eq('user_id', profile.id)
        : Promise.resolve({ data: [] as { venue_id: string }[] }),
    ]);

    setVenues((venueRows ?? []) as Venue[]);
    const ids = (scopeRows ?? []).map((r: { venue_id: string }) => r.venue_id);
    setMyVenueIds(ids);
    setHasScopes(ids.length > 0);
    setLoading(false);
  }, [venuesEnabled, slug, profile?.id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  /** Venues the current user may act on — all of them when unscoped. */
  const visibleVenues = useMemo(
    () => (hasScopes ? venues.filter((v) => myVenueIds.includes(v.id)) : venues),
    [venues, myVenueIds, hasScopes],
  );

  const venueName = useCallback(
    (id: string | null | undefined) => venues.find((v) => v.id === id)?.name ?? null,
    [venues],
  );

  return { venues, visibleVenues, myVenueIds, hasScopes, loading, refresh, venueName, venuesEnabled };
}
