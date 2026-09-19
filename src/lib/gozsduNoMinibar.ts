import { isGozsduCourtHotel } from './gozsdu-housekeeping';

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
): readonly string[] {
  return isGozsduNoMinibarRoom(selectedHotel, roomHotel)
    ? STANDARD_DAILY_PHOTOS.filter(category => category !== 'minibar')
    : STANDARD_DAILY_PHOTOS;
}
