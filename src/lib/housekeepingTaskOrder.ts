import { todayBudapest } from './budapestTime';
import { parseRoomFlags } from './room-service-flags';
import { getMemoriesCarryForwardService, hasMemoriesGreenBoardRequest, isHotelMemoriesBudapest } from './hotel-memories-housekeeping';
import { getHousekeepingCarryForward, isPortfolioCarryForwardHotel } from './housekeepingCarryForward';

export type HousekeepingOrderView = 'mobile' | 'desktop';

export interface HousekeepingOrderAssignment {
  room_id?: string;
  assignment_date?: string;
  assignment_type: string;
  is_dnd?: boolean | null;
  pms_hold?: boolean | null;
  service_result?: string | null;
  status: string;
  priority?: number | null;
  ready_to_clean?: boolean | null;
  dnd_retry_unlocked_at?: string | null;
  notes?: string | null;
  previous_day_context?: Parameters<typeof getHousekeepingCarryForward>[0] & Parameters<typeof getMemoriesCarryForwardService>[0];
  rooms?: {
    hotel?: string | null;
    is_dnd?: boolean | null;
    status?: string | null;
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

export interface BreakfastSignal {
  id: string;
  room_id: string;
  signal_date: string;
  first_seen_at: string;
  last_seen_at: string;
  window_ends_at: string;
  guests_seen: number;
  guests_expected: number | null;
  closed_at: string | null;
}

export function breakfastSignalForAssignment(x: HousekeepingOrderAssignment, signal: BreakfastSignal | undefined, now: Date): BreakfastSignal | undefined {
  if (!signal || !x.room_id || x.room_id !== signal.room_id ||
      x.assignment_date !== signal.signal_date || signal.signal_date !== todayBudapest(now) ||
      signal.closed_at || x.status !== 'assigned' || x.assignment_type !== 'daily_cleaning' ||
      !x.rooms || x.is_dnd || x.rooms.is_dnd || x.pms_hold || isCheckoutAssignment(x, now) ||
      x.service_result === 'guest_declined' || x.service_result === 'cleaned' ||
      ['dnd', 'out_of_order', 'out_of_service', 'maintenance'].includes(x.rooms.status || '') ||
      [x.notes, x.rooms.notes].some(n => n?.includes('[NO_SERVICE]') || n?.includes('[NO_BOARD_NO_CLEANING]'))) return undefined;
  return signal;
}

export function activeBreakfastSignal(x: HousekeepingOrderAssignment, signal: BreakfastSignal | undefined, now: Date): BreakfastSignal | undefined {
  const eligible = breakfastSignalForAssignment(x, signal, now);
  return eligible && Date.parse(eligible.window_ends_at) > now.getTime() ? eligible : undefined;
}

/** Preserve existing view ordering when no breakfast signal is present. */
export function housekeepingTaskBucket(x: HousekeepingOrderAssignment, view: HousekeepingOrderView, now: Date, signal?: BreakfastSignal, breakfastOrdering = false): number {
  const mobile = view === 'mobile';
  if (x.status === 'in_progress') return 0;
  if (x.status === 'completed') return mobile ? 8 : 6;
  if (x.status === 'cancelled') return mobile ? 9 : 7;
  if (x.status === 'dnd_pending_retry') return mobile
    ? (x.dnd_retry_unlocked_at ? 6 : 7)
    : (x.dnd_retry_unlocked_at ? 4 : 5);

  const checkout = isCheckoutAssignment(x, now);
  const breakfast = activeBreakfastSignal(x, signal, now);
  if (isHotelMemoriesBudapest(x.rooms?.hotel)) {
    const flags = parseRoomFlags(x.rooms?.notes ?? null);
    const greenBoardRequest = hasMemoriesGreenBoardRequest(x.notes);
    const carryForward = !checkout ? getMemoriesCarryForwardService(x.previous_day_context) : null;
    if (checkout && x.ready_to_clean) return 1;
    if (breakfast) return 1.5;
    if (!checkout && (x.rooms?.towel_change_required || carryForward?.serviceType === 'towel_change')) return 2;
    if (!checkout && (flags.roomCleaning || greenBoardRequest || carryForward?.serviceType === 'full_clean')) return 3;
    if (!checkout && x.assignment_type === 'daily_cleaning') return 4;
    if (checkout && !x.ready_to_clean) return 5;
    return 4;
  }
  if (isPortfolioCarryForwardHotel(x.rooms?.hotel)) {
    const carryForward = !checkout ? getHousekeepingCarryForward(x.previous_day_context) : null;
    if (checkout && x.ready_to_clean) return 1;
    if (breakfast) return 1.5;
    if (carryForward?.serviceType === 'full_clean' || carryForward?.serviceType === 'towel_change') return 2;
    if (checkout && !x.ready_to_clean) return 4;
  }
  if ((x.priority ?? 1) >= 3) return 1;
  const genericCheckout = mobile || breakfastOrdering ? checkout : x.assignment_type === 'checkout_cleaning';
  if (genericCheckout && x.ready_to_clean) return 2;
  if (breakfast) return 2.5;
  if (genericCheckout && !x.ready_to_clean) return 4;
  return 3;
}

export function compareHousekeepingTasks(a: HousekeepingOrderAssignment, b: HousekeepingOrderAssignment, view: HousekeepingOrderView, now: Date, signals?: ReadonlyMap<string, BreakfastSignal>): number {
  const aSignal = signals?.get(a.room_id || '');
  const bSignal = signals?.get(b.room_id || '');
  const useBreakfast = !!signals?.size;
  const aBucket = housekeepingTaskBucket(a, view, now, aSignal, useBreakfast);
  const bBucket = housekeepingTaskBucket(b, view, now, bSignal, useBreakfast);
  const bucketDiff = aBucket - bBucket;
  if (bucketDiff !== 0) return bucketDiff;
  if ((aBucket === 1.5 || aBucket === 2.5) && aSignal && bSignal) {
    const arrivalDiff = Date.parse(aSignal.window_ends_at) - Date.parse(bSignal.window_ends_at);
    if (arrivalDiff !== 0) return arrivalDiff;
  }
  const floorDiff = (a.rooms?.floor_number ?? 999) - (b.rooms?.floor_number ?? 999);
  if (floorDiff !== 0) return floorDiff;
  const roomNumber = (x: HousekeepingOrderAssignment) => parseInt(x.rooms?.room_number?.replace(/\D/g, '') || '999');
  return roomNumber(a) - roomNumber(b);
}
