export const DUTY_ROLES = [
  'maintenance', 'maintenance_manager', 'reception', 'reception_manager',
  'front_office', 'manager', 'admin', 'top_management', 'top_management_manager',
] as const;

export type DutyHotel = {
  hotel_configuration_id: string;
  hotel_id: string;
  hotel_name: string;
  organization_slug: string;
  can_manage: boolean;
};

export type ActiveDuty = {
  id: string;
  hotel_configuration_id: string;
  hotel_id: string;
  hotel_name: string;
  organization_slug: string;
  started_at: string;
  expires_at: string;
};

export function mayRequestPropertyDuty(role: string | null | undefined): boolean {
  return Boolean(role && DUTY_ROLES.some(eligible => eligible === role));
}

export function dutyMarkerKey(userId: string, organizationSlug: string): string {
  return `hotelcare.duty:${userId}:${organizationSlug.toLowerCase()}`;
}

/** Only trust RPC results if they match the authenticated organization AND the
 * server-provided authorized destination list. This is defense in depth; the
 * SECURITY DEFINER RPC and ticket RLS remain the security boundary. */
export function verifyDuty(
  duty: ActiveDuty | null | undefined,
  organizationSlug: string,
  authorized: DutyHotel[],
  now = Date.now(),
): duty is ActiveDuty {
  return Boolean(duty?.id && duty.hotel_configuration_id && duty.hotel_id
    && duty.organization_slug === organizationSlug
    && Number.isFinite(Date.parse(duty.expires_at))
    && Date.parse(duty.expires_at) > now
    && authorized.some(h => h.organization_slug === organizationSlug
      && h.hotel_configuration_id === duty.hotel_configuration_id
      && h.hotel_id === duty.hotel_id));
}
