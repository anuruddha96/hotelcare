import { todayBudapest } from './budapestTime';
import { parseRoomFlags } from './room-service-flags';
import { getMemoriesCarryForwardService, hasMemoriesGreenBoardRequest, isHotelMemoriesBudapest } from './hotel-memories-housekeeping';
import { getHousekeepingCarryForward, isPortfolioCarryForwardHotel } from './housekeepingCarryForward';

export type HousekeepingOrderView = 'mobile' | 'desktop';

export interface HousekeepingOrderAssignment {
  assignment_type: string;
  status: string;
  priority?: number | null;
  ready_to_clean?: boolean | null;
  dnd_retry_unlocked_at?: string | null;
  notes?: string | null;
  previous_day_context?: Parameters<typeof getHousekeepingCarryForward>[0] & Parameters<typeof getMemoriesCarryForwardService>[0];
  rooms?: {
    hotel?: string | null;
    room_number?: string | null;
    floor_number?: number | null;
    notes?: string | null;
    towel_change_required?: boolean | null;
    is_checkout_room?: boolean | null;
    pms_metadata?: { pmsSyncDate?: string; scheduledDepartureToday?: boolean } | null;
  } | null;
}

export function isCheckoutAssignment(x: HousekeepingOrderAssignment, now = new Date()): boolean {
  const meta = x.rooms?.pms_metadata;
  const fresh = meta?.pmsSyncDate === todayBudapest(now);
  const pmsCheckout = !!x.rooms?.is_checkout_room || meta?.scheduledDepartureToday === true;
  return fresh ? pmsCheckout : x.assignment_type === 'checkout_cleaning' || pmsCheckout;
}

/** Preserve each existing view's ordering, including legacy retry ties.
 * Breakfast promotion will be inserted separately after the eligibility contract is verified.
 */
export function housekeepingTaskBucket(x: HousekeepingOrderAssignment, view: HousekeepingOrderView, now: Date): number {
  const mobile = view === 'mobile';
  if (x.status === 'in_progress') return 0;
  if (x.status === 'completed') return mobile ? 8 : 6;
  if (x.status === 'cancelled') return mobile ? 9 : 7;
  if (x.status === 'dnd_pending_retry') return mobile
    ? (x.dnd_retry_unlocked_at ? 6 : 7)
    : (x.dnd_retry_unlocked_at ? 4 : 5);

  const checkout = isCheckoutAssignment(x, now);
  if (isHotelMemoriesBudapest(x.rooms?.hotel)) {
    const flags = parseRoomFlags(x.rooms?.notes ?? null);
    const greenBoardRequest = hasMemoriesGreenBoardRequest(x.notes);
    const carryForward = !checkout ? getMemoriesCarryForwardService(x.previous_day_context) : null;
    if (checkout && x.ready_to_clean) return 1;
    if (!checkout && (x.rooms?.towel_change_required || carryForward?.serviceType === 'towel_change')) return 2;
    if (!checkout && (flags.roomCleaning || greenBoardRequest || carryForward?.serviceType === 'full_clean')) return 3;
    if (!checkout && x.assignment_type === 'daily_cleaning') return 4;
    if (checkout && !x.ready_to_clean) return 5;
    return 4;
  }
  if (isPortfolioCarryForwardHotel(x.rooms?.hotel)) {
    const carryForward = !checkout ? getHousekeepingCarryForward(x.previous_day_context) : null;
    if (checkout && x.ready_to_clean) return 1;
    if (carryForward?.serviceType === 'full_clean' || carryForward?.serviceType === 'towel_change') return 2;
    if (checkout && !x.ready_to_clean) return 4;
  }
  if ((x.priority ?? 1) >= 3) return 1;
  const genericCheckout = mobile ? checkout : x.assignment_type === 'checkout_cleaning';
  if (genericCheckout && x.ready_to_clean) return 2;
  if (genericCheckout && !x.ready_to_clean) return 4;
  return 3;
}

export function compareHousekeepingTasks(a: HousekeepingOrderAssignment, b: HousekeepingOrderAssignment, view: HousekeepingOrderView, now: Date): number {
  const bucketDiff = housekeepingTaskBucket(a, view, now) - housekeepingTaskBucket(b, view, now);
  if (bucketDiff !== 0) return bucketDiff;
  const floorDiff = (a.rooms?.floor_number ?? 999) - (b.rooms?.floor_number ?? 999);
  if (floorDiff !== 0) return floorDiff;
  const roomNumber = (x: HousekeepingOrderAssignment) => parseInt(x.rooms?.room_number?.replace(/\D/g, '') || '999');
  return roomNumber(a) - roomNumber(b);
}
