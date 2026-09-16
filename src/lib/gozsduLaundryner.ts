import { isGozsduCourtHotel } from './gozsdu-housekeeping';

export type LaundryRoom = {
  id: string;
  hotel: string | null;
  room_number: string;
  status: string | null;
  is_checkout_room: boolean | null;
  is_dnd: boolean | null;
  pms_metadata?: Record<string, any> | null;
};
export type LaundryBucket = 'checkout' | 'second_day' | 'other';

/** Exact property gate and operating-room filter: no cross-property room access. */
export function isEligibleLaundryRoom(room: LaundryRoom): boolean {
  const metadata = room.pms_metadata || {};
  return isGozsduCourtHotel(room.hotel)
    && room.status !== 'out_of_order'
    && metadata.gozsduAvailability?.status === 'operating'
    && metadata.isNoShow !== true
    && Number(metadata.reservationStatusId ?? 0) !== 8;
}

/** This is *collection priority*, not a new cleaning cadence or a PMS write. */
export function getLaundryBucket(room: LaundryRoom): LaundryBucket {
  const metadata = room.pms_metadata || {};
  if (room.is_checkout_room === true || metadata.scheduledDepartureToday === true) return 'checkout';
  if (Number(metadata.currentNight ?? 0) === 2) return 'second_day';
  return 'other';
}

export function groupLaundryRooms(rooms: LaundryRoom[]) {
  const buckets: Record<LaundryBucket, LaundryRoom[]> = {
    checkout: [], second_day: [], other: [],
  };
  for (const room of rooms) {
    if (isEligibleLaundryRoom(room)) buckets[getLaundryBucket(room)].push(room);
  }
  for (const rows of Object.values(buckets)) {
    rows.sort((a, b) => a.room_number.localeCompare(b.room_number, undefined, { numeric: true }));
  }
  return buckets;
}
