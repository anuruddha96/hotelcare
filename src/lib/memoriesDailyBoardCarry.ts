import { getActionableHousekeepingCarryForward, type HousekeepingCarryForward } from '@/lib/housekeepingCarryForward';
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
