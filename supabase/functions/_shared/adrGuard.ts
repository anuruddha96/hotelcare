// Rolling ADR guard (Hotel Ottofiori).
//
// The hotel commits to an average rate across the next few nights, not to a
// price per night. This module turns that commitment into a per-date floor:
//  * work out the revenue the window still needs to reach the target ADR;
//  * subtract what is already on the books at the prices already sold;
//  * spread the remainder over the rooms still to sell, weighted towards the
//    dates that still have inventory left;
//  * never demand a rate the date cannot plausibly achieve — when the required
//    rate exceeds what the window's own ceiling allows the guard reports the
//    window as infeasible and stands down rather than freezing every markdown.
//
// Pure functions only: the orchestrator feeds it facts and applies the result.

export interface AdrGuardNight {
  stayDate: string;
  daysOut: number;
  /** Rooms already sold for the date. */
  roomsSold: number | null;
  /** Rooms still available for the date. */
  roomsRemaining: number | null;
  /** Realised room revenue on the books for the date, hotel currency. */
  revenueOnBooks: number | null;
  /** Current reference price for the date. */
  currentPrice: number | null;
  /** Hard ceiling for the date, when known. */
  maxPrice?: number | null;
}

export interface AdrGuardSettings {
  /** Target average rate across the window, hotel currency. */
  targetAdr: number;
  /** How many nights from today the guard covers. */
  windowDays: number;
  /**
   * The guard never lifts a floor more than this above the target — a single
   * badly sold night must not price the rest of the week out of the market.
   */
  maxFloorPct?: number;
}

export interface AdrGuardResult {
  /** Floor per stay date; a date missing from the map is unconstrained. */
  floors: Record<string, number>;
  /** Average rate the window is currently on track for. */
  projectedAdr: number | null;
  /** Rate the remaining rooms need to average to hit the target. */
  requiredRate: number | null;
  /** False when the target cannot be reached; the guard then applies no floor. */
  feasible: boolean;
  reason: string;
}

const whole = (v: number) => Math.round(v);

export function computeAdrGuard(
  nights: AdrGuardNight[],
  settings: AdrGuardSettings,
): AdrGuardResult {
  const empty = (reason: string): AdrGuardResult => ({
    floors: {}, projectedAdr: null, requiredRate: null, feasible: false, reason,
  });

  const target = Number(settings.targetAdr);
  if (!Number.isFinite(target) || target <= 0) return empty("no_target");

  const window = nights
    .filter((n) => n.daysOut >= 0 && n.daysOut < Math.max(1, settings.windowDays))
    .filter((n) => n.currentPrice != null && Number(n.currentPrice) > 0);
  if (!window.length) return empty("no_nights");

  const sold = window.reduce((s, n) => s + Math.max(0, Number(n.roomsSold ?? 0)), 0);
  const remaining = window.reduce((s, n) => s + Math.max(0, Number(n.roomsRemaining ?? 0)), 0);
  const revenue = window.reduce((s, n) => s + Math.max(0, Number(n.revenueOnBooks ?? 0)), 0);

  if (sold + remaining <= 0) return empty("no_inventory");

  const projectedRevenue = revenue + window.reduce(
    (s, n) => s + Math.max(0, Number(n.roomsRemaining ?? 0)) * Number(n.currentPrice ?? 0), 0,
  );
  const projectedAdr = sold + remaining > 0 ? projectedRevenue / (sold + remaining) : null;

  if (remaining <= 0) {
    return { floors: {}, projectedAdr, requiredRate: null, feasible: true, reason: "window_sold_out" };
  }

  // Revenue the window still needs from the rooms that are left.
  const needed = target * (sold + remaining) - revenue;
  const requiredRate = needed / remaining;

  if (!(requiredRate > 0)) {
    return { floors: {}, projectedAdr, requiredRate: whole(requiredRate), feasible: true, reason: "target_already_met" };
  }

  const cap = target * ((settings.maxFloorPct ?? 130) / 100);
  if (requiredRate > cap) {
    // Asking for more than the guard is allowed to demand: the target is out of
    // reach for this window, so the guard stands down instead of freezing sales.
    return { floors: {}, projectedAdr, requiredRate: whole(requiredRate), feasible: false, reason: "target_unreachable" };
  }

  const floors: Record<string, number> = {};
  for (const n of window) {
    if ((n.roomsRemaining ?? 0) <= 0) continue;
    let floor = whole(requiredRate);
    if (n.maxPrice != null && Number.isFinite(Number(n.maxPrice))) {
      floor = Math.min(floor, whole(Number(n.maxPrice)));
    }
    floors[n.stayDate] = floor;
  }

  return {
    floors,
    projectedAdr: projectedAdr == null ? null : whole(projectedAdr),
    requiredRate: whole(requiredRate),
    feasible: true,
    reason: "guard_applied",
  };
}
