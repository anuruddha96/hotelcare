/**
 * Browser-side defense in depth. Database RLS and RPC permissions remain the
 * authority for every record and object; these guards cannot grant access.
 */
export function isOwnOrganizationRoute(profileSlug: string | null | undefined, routeSlug: string | null | undefined): boolean {
  const profile = profileSlug?.trim().toLowerCase();
  const route = routeSlug?.trim().toLowerCase();
  return Boolean(profile && route && profile === route);
}

type HotelWithScope = { organization_id: string | null; is_active: boolean };

/** Never display a row from another organization, even if the API returns it. */
export function restrictHotelsToOrganization<T extends HotelWithScope>(hotels: T[] | null | undefined, organizationId: string): T[] {
  if (!organizationId) return [];
  return (hotels ?? []).filter(hotel => hotel.organization_id === organizationId && hotel.is_active === true);
}

/**
 * Fallback RPC has no independent organization record. Reject mixed/unknown
 * organization results rather than accepting an arbitrary response as hotels.
 * The RPC itself must still enforce auth.uid() and organization permissions.
 */
export function validateRpcHotelScope<T extends HotelWithScope>(hotels: T[] | null | undefined): T[] {
  if (!hotels?.length) return [];
  const organizationId = hotels[0].organization_id;
  if (!organizationId || hotels.some(hotel => hotel.organization_id !== organizationId)) return [];
  return restrictHotelsToOrganization(hotels, organizationId);
}
