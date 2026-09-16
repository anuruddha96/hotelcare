export const GOZSDU_COURT_HOTEL_ID = 'gozsdu-court';
export const GOZSDU_COURT_HOTEL_NAME = 'Gozsdu Court Budapest';

const GOZSDU_ALIASES = new Set([
  GOZSDU_COURT_HOTEL_ID,
  GOZSDU_COURT_HOTEL_NAME.toLowerCase(),
]);

export type GozsduHousekeepingService = 'none' | 'towel_change' | 'change_room';

export interface GozsduHousekeepingCycleInput {
  currentNight: number | null | undefined;
  totalNights: number | null | undefined;
  isCheckout?: boolean | null;
}

export interface GozsduHousekeepingCycleResult {
  service: GozsduHousekeepingService;
  serviceDue: boolean;
  currentNight: number;
  totalNights: number;
  remainingNightsAfterToday: number;
}

function positiveInteger(value: number | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

/**
 * Exact property gate for the custom Gozsdu housekeeping workflow.
 * Never use fuzzy matching here: this rule must not leak to another hotel.
 */
export function isGozsduCourtHotel(value: string | null | undefined): boolean {
  if (!value) return false;
  return GOZSDU_ALIASES.has(String(value).trim().toLowerCase());
}

/**
 * Gozsdu Court Budapest stay-over service policy.
 *
 * - No normal daily cleaning.
 * - Every second stay night is a service day: 2, 4, 6, 8, ...
 * - Every fourth stay night becomes a full Change Room only when the guest
 *   still has at least two nights after today.
 * - If a fourth-night Change Room would be immediately before departure,
 *   downgrade it to towel-only (4/5 => towel, while 4/6 => Change Room).
 * - Checkout always wins and is handled as checkout cleaning instead.
 */
export function getGozsduHousekeepingCycle(
  input: GozsduHousekeepingCycleInput,
): GozsduHousekeepingCycleResult {
  const currentNight = positiveInteger(input.currentNight);
  const totalNights = positiveInteger(input.totalNights);
  const remainingNightsAfterToday = Math.max(0, totalNights - currentNight);

  if (input.isCheckout || currentNight < 2 || currentNight % 2 !== 0) {
    return {
      service: 'none',
      serviceDue: false,
      currentNight,
      totalNights,
      remainingNightsAfterToday,
    };
  }

  const fullChangeDue = currentNight % 4 === 0 && remainingNightsAfterToday > 1;
  const service: GozsduHousekeepingService = fullChangeDue ? 'change_room' : 'towel_change';

  return {
    service,
    serviceDue: true,
    currentNight,
    totalNights,
    remainingNightsAfterToday,
  };
}

export function gozsduServiceLabel(service: GozsduHousekeepingService): string {
  if (service === 'change_room') return 'Change Room';
  if (service === 'towel_change') return 'Towel change';
  return 'No service today';
}
