import { isGozsduCourtHotel } from './gozsdu-housekeeping';
import { readGozsduRoomOverride } from './gozsduRoomBucketOverride';

/** Presentation-only normalization: a manager's date-specific HotelCare cleaning
 * plan should be visible to the housekeeper even when the real PMS departure
 * differs. Never write these derived fields back to the PMS or room record. */
export function gozsduWorkPresentation<T extends {
  assignment_type: string;
  assignment_date?: string;
  rooms: {
    hotel: string;
    pms_metadata?: any;
    is_checkout_room?: boolean | null;
    towel_change_required?: boolean;
    linen_change_required?: boolean;
  } | null;
}>(assignment: T, date: string): T {
  const room = assignment.rooms;
  if (!room || !isGozsduCourtHotel(room.hotel)) return assignment;
  const override = readGozsduRoomOverride(room.pms_metadata, date);
  if (!override || override.bucket === 'other') return assignment;
  const checkout = override.bucket === 'checkout';
  const metadata = room.pms_metadata && typeof room.pms_metadata === 'object' ? room.pms_metadata : {};
  return {
    ...assignment,
    assignment_type: checkout ? 'checkout_cleaning' : 'daily_cleaning',
    rooms: {
      ...room,
      is_checkout_room: checkout,
      towel_change_required: override.bucket === 'service' && override.service === 'towel_change',
      linen_change_required: override.bucket === 'service' && override.service === 'change_room',
      pms_metadata: { ...metadata, scheduledDepartureToday: checkout },
    },
  };
}
