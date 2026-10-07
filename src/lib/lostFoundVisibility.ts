export const LOST_FOUND_UPDATED_EVENT = 'hotelcare:lost-and-found-updated';

export interface LostFoundVisibilityItem {
  room_id: string | null;
  reported_by: string;
  organization_slug?: string | null;
  rooms?: {
    hotel?: string | null;
  } | null;
}

export interface LostFoundVisibilityScope {
  hotelKeys: string[];
  organizationSlug?: string | null;
  userId?: string | null;
}

export function normalizeLostFoundHotelKey(value: string | null | undefined): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/^hotel\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Lost & Found rows are primarily property-scoped through their linked room.
 * Older manager-created "General" rows have no room/property column in the
 * legacy schema; keep those recoverable only by the reporter instead of
 * leaking them to managers at other properties.
 */
export function isLostFoundItemVisibleInHotel(
  item: LostFoundVisibilityItem,
  scope: LostFoundVisibilityScope,
): boolean {
  const expectedOrg = String(scope.organizationSlug || '').trim().toLowerCase();
  const itemOrg = String(item.organization_slug || '').trim().toLowerCase();

  if (expectedOrg && itemOrg && expectedOrg !== itemOrg) return false;

  const roomHotel = normalizeLostFoundHotelKey(item.rooms?.hotel);
  if (roomHotel) {
    return scope.hotelKeys.some((key) => normalizeLostFoundHotelKey(key) === roomHotel);
  }

  return !!scope.userId && item.reported_by === scope.userId;
}
