export const LOST_FOUND_UPDATED_EVENT = 'hotelcare:lost-and-found-updated';

export interface LostFoundVisibilityItem {
  room_id: string | null;
  reported_by: string;
  organization_slug?: string | null;
  hotel?: string | null;
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
 * Lost & Found rows are property-scoped by their persisted hotel key, with
 * the linked room retained as a compatibility fallback for older rows. Truly
 * unscoped legacy rows remain recoverable only by their reporter.
 */
export function isLostFoundItemVisibleInHotel(
  item: LostFoundVisibilityItem,
  scope: LostFoundVisibilityScope,
): boolean {
  const expectedOrg = String(scope.organizationSlug || '').trim().toLowerCase();
  const itemOrg = String(item.organization_slug || '').trim().toLowerCase();

  if (expectedOrg && itemOrg && expectedOrg !== itemOrg) return false;

  const itemHotel = normalizeLostFoundHotelKey(item.hotel || item.rooms?.hotel);
  if (itemHotel) {
    return scope.hotelKeys.some((key) => normalizeLostFoundHotelKey(key) === itemHotel);
  }

  return !!scope.userId && item.reported_by === scope.userId;
}
