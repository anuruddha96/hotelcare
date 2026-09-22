/**
 * UI-level guard for the existing manager hotel switcher.
 * This is defense in depth only. Database RLS and a server-validated duty
 * entitlement are mandatory before exposing temporary cross-property duty.
 */
export interface SwitchOrganization {
  id: string;
  slug: string;
}

export interface SwitchHotel {
  hotel_id: string;
  organization_id: string;
  is_active: boolean;
}

export function canSwitchWithinOrganization(
  profileOrganizationSlug: string | null | undefined,
  organization: SwitchOrganization | null | undefined,
  hotel: SwitchHotel | null | undefined,
  requestedHotelId: string,
): boolean {
  return Boolean(
    profileOrganizationSlug &&
    organization?.id &&
    organization.slug === profileOrganizationSlug &&
    hotel?.is_active === true &&
    hotel.hotel_id === requestedHotelId &&
    hotel.organization_id === organization.id,
  );
}
