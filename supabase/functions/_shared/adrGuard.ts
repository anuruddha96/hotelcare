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

// ---------------------------------------------------------------------------
// Month-end ADR pacing.
//
// The rolling window above only protects the next few nights. The manager is
// judged on the MONTH: what matters is the average rate the month lands on once
// it is over. So for every stay month the guard works out the rate the rooms
// still to sell must average for the month to finish on target, and turns that
// into a floor for the remaining dates of that month.
//
//  * A month running ABOVE target can afford to discount weak dates — the guard
//    releases markdowns there (that is how September fills without collapsing).
//  * A month running BELOW target freezes markdowns entirely — only pickup and
//    occupancy-driven increases pass.
// ---------------------------------------------------------------------------

export interface MonthPaceNight {
  stayDate: string;      // YYYY-MM-DD
  roomsSold: number | null;
  roomsRemaining: number | null;
  revenueOnBooks: number | null;
}

export interface MonthPaceStatus {
  month: string;         // YYYY-MM
  targetAdr: number;
  /** Average rate the month has achieved so far on the books. */
  onBooksAdr: number | null;
  roomsSold: number;
  roomsRemaining: number;
  /** Rate the remaining rooms must average for the month to land on target. */
  requiredRate: number | null;
  /** Floor applied to every remaining date of the month. */
  floor: number | null;
  /** True when the month is at or above its target on the books. */
  aheadOfTarget: boolean;
  /** True when markdowns are frozen for the month. */
  markdownsFrozen: boolean;
  reason: string;
}

export interface MonthPaceGuardResult {
  byMonth: Record<string, MonthPaceStatus>;
  /** Convenience: floor per stay date. */
  floors: Record<string, number>;
  /** Convenience: stay dates on which markdowns are frozen. */
  frozenMonths: string[];
}

export interface MonthPaceSettings {
  /** Fallback ADR target when a month has no explicit one. */
  defaultTargetAdr: number;
  /** Per-month overrides keyed by YYYY-MM or by month number "1".."12". */
  monthlyTargets?: Record<string, number> | null;
  /** The guard never demands more than this percentage of the target. */
  maxFloorPct?: number;
}

const monthOf = (stayDate: string) => stayDate.slice(0, 7);

function targetFor(month: string, settings: MonthPaceSettings): number {
  const targets = settings.monthlyTargets ?? {};
  const exact = Number(targets[month]);
  if (Number.isFinite(exact) && exact > 0) return exact;
  const num = String(Number(month.slice(5, 7)));
  const byNumber = Number(targets[num]);
  if (Number.isFinite(byNumber) && byNumber > 0) return byNumber;
  return Number(settings.defaultTargetAdr);
}

export function computeMonthPaceGuard(
  nights: MonthPaceNight[],
  settings: MonthPaceSettings,
): MonthPaceGuardResult {
  const grouped = new Map<string, MonthPaceNight[]>();
  for (const night of nights) {
    if (!night.stayDate || night.stayDate.length < 7) continue;
    const month = monthOf(night.stayDate);
    const list = grouped.get(month) ?? [];
    list.push(night);
    grouped.set(month, list);
  }

  const byMonth: Record<string, MonthPaceStatus> = {};
  const floors: Record<string, number> = {};
  const frozenMonths: string[] = [];

  for (const [month, list] of grouped) {
    const target = targetFor(month, settings);
    const sold = list.reduce((s, n) => s + Math.max(0, Number(n.roomsSold ?? 0)), 0);
    const remaining = list.reduce((s, n) => s + Math.max(0, Number(n.roomsRemaining ?? 0)), 0);
    const revenue = list.reduce((s, n) => s + Math.max(0, Number(n.revenueOnBooks ?? 0)), 0);
    const onBooksAdr = sold > 0 ? whole(revenue / sold) : null;

    if (!Number.isFinite(target) || target <= 0) {
      byMonth[month] = {
        month, targetAdr: target, onBooksAdr, roomsSold: sold, roomsRemaining: remaining,
        requiredRate: null, floor: null, aheadOfTarget: false, markdownsFrozen: false, reason: "no_target",
      };
      continue;
    }
    if (remaining <= 0 || sold + remaining <= 0) {
      byMonth[month] = {
        month, targetAdr: target, onBooksAdr, roomsSold: sold, roomsRemaining: remaining,
        requiredRate: null, floor: null, aheadOfTarget: (onBooksAdr ?? 0) >= target,
        markdownsFrozen: false, reason: "nothing_left_to_sell",
      };
      continue;
    }

    const requiredRate = whole((target * (sold + remaining) - revenue) / remaining);
    const ahead = onBooksAdr != null && onBooksAdr >= target;
    const cap = whole(target * ((settings.maxFloorPct ?? 130) / 100));

    // A month already above its target may discount: no floor, markdowns free.
    if (ahead) {
      byMonth[month] = {
        month, targetAdr: target, onBooksAdr, roomsSold: sold, roomsRemaining: remaining,
        requiredRate, floor: null, aheadOfTarget: true, markdownsFrozen: false,
        reason: "ahead_of_target",
      };
      continue;
    }

    // Behind target: freeze markdowns and floor the remaining dates at the rate
    // the month still needs (capped so one bad month cannot price us out).
    const floor = Math.min(requiredRate, cap);
    const usable = floor > 0;
    byMonth[month] = {
      month, targetAdr: target, onBooksAdr, roomsSold: sold, roomsRemaining: remaining,
      requiredRate, floor: usable ? floor : null, aheadOfTarget: false, markdownsFrozen: true,
      reason: requiredRate > cap ? "behind_target_capped" : "behind_target",
    };
    frozenMonths.push(month);
    if (usable) {
      for (const night of list) {
        if ((night.roomsRemaining ?? 0) <= 0) continue;
        floors[night.stayDate] = floor;
      }
    }
  }

  return { byMonth, floors, frozenMonths };
}

