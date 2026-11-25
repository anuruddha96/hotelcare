import type { RoomForAssignment } from '@/lib/roomAssignmentAlgorithm';
import { isUnsoldPlanningRoom } from '@/lib/nextDayHousekeepingSnapshot';

/**
 * Previo's business date is the MORNING housekeeping date, not the previous
 * evening's booking date. Only exact-date snapshot-based rooms are accepted.
 * Never use today's mutable rooms.is_checkout_room as a future classification.
 */
export function groupFutureHousekeepingRooms(rooms: readonly RoomForAssignment[], selectedDate: string) {
  const checkouts: RoomForAssignment[] = [];
  const dayTwoStayovers: RoomForAssignment[] = [];
  const laterStayovers: RoomForAssignment[] = [];
  const otherStayovers: RoomForAssignment[] = [];
  const unbookedMorning: RoomForAssignment[] = [];

  const selectedDay = Date.parse(selectedDate + 'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(selectedDate)
    || !Number.isFinite(selectedDay)
    || new Date(selectedDay).toISOString().slice(0, 10) !== selectedDate) {
    throw new Error('Invalid future housekeeping date');
  }

  for (const room of rooms) {
    if (isUnsoldPlanningRoom(room)) {
      unbookedMorning.push(room);
    } else if (room.is_checkout_room) {
      checkouts.push(room);
    } else {
      const arrival = room.pms_metadata?.selectedDateArrival;
      const arrivalDay = typeof arrival === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(arrival)
        ? Date.parse(arrival + 'T00:00:00Z') : Number.NaN;
      const stayDay = Number.isFinite(arrivalDay)
        ? Math.round((selectedDay - arrivalDay) / 86_400_000) + 1 : null;
      if (stayDay === 2) dayTwoStayovers.push(room);
      else if (stayDay !== null && stayDay > 2) laterStayovers.push(room);
      else otherStayovers.push(room);
    }
  }

  return {
    checkouts,
    dayTwoStayovers,
    laterStayovers,
    otherStayovers,
    unbookedMorning,
    stayoverCount: dayTwoStayovers.length + laterStayovers.length + otherStayovers.length,
    roomCount: rooms.length,
  };
}
