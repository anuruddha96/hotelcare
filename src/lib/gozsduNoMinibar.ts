import { isGozsduCourtHotel } from './gozsdu-housekeeping';

export function isNoMinibarOrganization(orgSlug: string | null | undefined): boolean {
  const slug = String(orgSlug || '').toLowerCase();
  return slug === 'slnt' || slug === 'slnt-group';
}

/** Both the selected property AND the actual room must be Gozsdu.
 * Never suppress another hotel's controls based only on a stale room card. */
export function isGozsduNoMinibarRoom(
  selectedHotel: string | null | undefined,
  roomHotel: string | null | undefined,
): boolean {
  return isGozsduCourtHotel(selectedHotel) && isGozsduCourtHotel(roomHotel);
}

const STANDARD_DAILY_PHOTOS = ['trash_bin', 'bathroom', 'bed', 'minibar', 'tea_coffee_table'] as const;

export function requiredDailyPhotoCategories(
  selectedHotel: string | null | undefined,
  roomHotel: string | null | undefined,
  organizationSlug?: string | null,
): readonly string[] {
  return isNoMinibarRoom(organizationSlug, selectedHotel, roomHotel)
    ? STANDARD_DAILY_PHOTOS.filter(category => category !== 'minibar')
    : STANDARD_DAILY_PHOTOS;
}


/** Organization-aware capability guard. SLNT has no minibar at any venue. */
export function isNoMinibarRoom(
  organizationSlug: string | null | undefined,
  selectedHotel: string | null | undefined,
  roomHotel: string | null | undefined,
): boolean {
  return isNoMinibarOrganization(organizationSlug)
    || isGozsduNoMinibarRoom(selectedHotel, roomHotel);
}
