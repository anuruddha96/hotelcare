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
 * - Previo 1/5 is the first night of five, NOT a completed first night.
 * - After two nights, towel service is due at PMS 3/N, then 7/N, 11/N, ...
 * - After four nights, Complete Textile Change is due at PMS 5/N,
 *   then 9/N, 13/N, ... only when at least two nights remain.
 * - Downgrade that complete change to towel-only when departure is too close
 *   (5/6 => towel, while 5/7 => Complete Textile Change).
 * - Checkout always wins and is handled as checkout cleaning instead.
 */
export function getGozsduHousekeepingCycle(
  input: GozsduHousekeepingCycleInput,
): GozsduHousekeepingCycleResult {
  const currentNight = positiveInteger(input.currentNight);
  const totalNights = positiveInteger(input.totalNights);
  const remainingNightsAfterToday = Math.max(0, totalNights - currentNight);

  if (input.isCheckout || currentNight < 3 || currentNight > totalNights || currentNight % 2 === 0) {
    return {
      service: 'none',
      serviceDue: false,
      currentNight,
      totalNights,
      remainingNightsAfterToday,
    };
  }

  const fullChangeDue = (currentNight - 1) % 4 === 0 && remainingNightsAfterToday > 1;
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
  if (service === 'change_room') return 'Complete Textile Change';
  if (service === 'towel_change') return 'Towel change';
  return 'No service today';
}
