import { getActionableHousekeepingCarryForward, effectiveCarryServiceFlags, type HousekeepingCarryForward } from '@/lib/housekeepingCarryForward';
import { isMemoriesFinalOccupiedNight } from '@/lib/memoriesOperationalNotes';
import { isHotelMemoriesBudapest } from '@/lib/hotel-memories-housekeeping';

/**
 * HMB's live room board is displayed before today's assignments exist.
 * Read proven service debt from the dated room-level cache instead of relying
 * on previous_day_context in a non-existent assignment.
 *
 * Fail closed on the wrong property/date or stale payload. Only the DB's
 * original-due-date proof is allowed to publish a cache entry.
 */
export function getMemoriesDailyBoardCarry(args: {
  hotel?: string | null;
  selectedDate: string;
  today: string;
  isCheckout: boolean;
  cachedCarry: unknown;
  assignment?: { service_result?: string | null } | null;
}): HousekeepingCarryForward | null {
  if (!isHotelMemoriesBudapest(args.hotel)
    || args.selectedDate !== args.today
    || args.isCheckout) return null;

  const carry = getActionableHousekeepingCarryForward(
    { carry_forward: args.cachedCarry }, args.assignment,
  );
  if (!carry || carry.propertyId !== 'memories-budapest') return null;
  const selectedDay = Date.parse(`${args.selectedDate}T12:00:00Z`);
  if (!Number.isFinite(selectedDay)) return null;
  const expectedSource = new Date(selectedDay - 86_400_000).toISOString().slice(0, 10);
  if (carry.sourceBusinessDate !== expectedSource) return null;
  return carry;
}

/** Preview-only overlay: never writes the PMS room flag or its natural cycle. */
export function overlayMemoriesDailyCarryOnRooms<
  T extends {
    id: string;
    hotel?: string | null;
    is_checkout_room?: boolean | null;
    pms_metadata?: any;
    towel_change_required?: boolean | null;
    linen_change_required?: boolean | null;
  },
>(
  rooms: T[],
  cachedRows: Array<{ room_id: string; carry_forward: unknown }>,
  selectedDate: string,
  today: string,
): T[] {
  if (selectedDate !== today || cachedRows.length === 0) return rooms;
  const byId = new Map(cachedRows.map(row => [row.room_id, row.carry_forward]));
  return rooms.map(room => {
    if (!byId.has(room.id)) return room;
    const carry = getMemoriesDailyBoardCarry({
      hotel: room.hotel,
      selectedDate,
      today,
      isCheckout: room.is_checkout_room === true
        || room.pms_metadata?.scheduledDepartureToday === true,
      cachedCarry: byId.get(room.id),
    });
    if (!carry) return room;

    const finalNight = isMemoriesFinalOccupiedNight(
      room.pms_metadata as Record<string, unknown> | null, selectedDate,
    );
    const flags = effectiveCarryServiceFlags({
      towelChangeRequired: room.towel_change_required,
      linenChangeRequired: room.linen_change_required,
      carryForward: carry,
      forceTowelOnly: finalNight,
    });
    return { ...room, towel_change_required: flags.towelChangeRequired,
      linen_change_required: flags.linenChangeRequired } as T;
  });
}
