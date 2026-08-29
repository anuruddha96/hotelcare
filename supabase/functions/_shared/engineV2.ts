// Revenue automation engine, version 2 — pure decision logic.
//
// One stay date in, one decision out. No I/O here on purpose: every rule below
// is exercised directly by unit tests, and the orchestrator (runV2.ts) only
// gathers the facts and applies the outcome.
//
// Design commitments that came out of the Ottofiori incident:
//  * every price is a whole euro, everywhere, always;
//  * a date can move at most ONE step per run and at most one "budget" per day;
//  * a markdown needs a real reason (behind pace AND no genuine pickup), never
//    just "no booking arrived in the last two hours";
//  * genuine pickup means a reservation the ledger saw for the first time, so a
//    full re-sync of old bookings can never look like demand;
//  * direction cannot flip inside a cooldown, so a date cannot oscillate.

export type Direction = "increase" | "decrease" | "hold";

export interface PaceBand {
  min_days_out: number;
  max_days_out: number;
  target_occupancy_pct: number;
}

export interface WindowRule {
  /** Inclusive lower bound of days-out for this window. */
  min_days_out: number;
  /** Inclusive upper bound; null means "to the end of the horizon". */
  max_days_out: number | null;
  /** Largest single step, in whole euros. */
  max_step: number;
  /** Largest total movement for one stay date within one local day. */
  max_daily: number;
  /** Whether increases are allowed in this window at all. */
  allow_increase: boolean;
  /** Whether decreases are allowed in this window at all. */
  allow_decrease: boolean;
}

export const DEFAULT_WINDOW_RULES: WindowRule[] = [
  // Selling window: protect the sale, never chase the price up hard.
  { min_days_out: 0, max_days_out: 3, max_step: 10, max_daily: 20, allow_increase: true, allow_decrease: true },
  { min_days_out: 4, max_days_out: 14, max_step: 8, max_daily: 16, allow_increase: true, allow_decrease: true },
  { min_days_out: 15, max_days_out: 60, max_step: 6, max_daily: 12, allow_increase: true, allow_decrease: true },
  // Long lead: hold strength, small moves only, never a panic markdown.
  { min_days_out: 61, max_days_out: null, max_step: 5, max_daily: 5, allow_increase: true, allow_decrease: false },
];

export function windowFor(daysOut: number, rules: WindowRule[] = DEFAULT_WINDOW_RULES): WindowRule {
  for (const rule of rules) {
    const withinLower = daysOut >= rule.min_days_out;
    const withinUpper = rule.max_days_out === null || daysOut <= rule.max_days_out;
    if (withinLower && withinUpper) return rule;
  }
  return rules[rules.length - 1] ?? DEFAULT_WINDOW_RULES[DEFAULT_WINDOW_RULES.length - 1];
}

/** Expected occupancy for this lead time; null when no band covers it. */
export function paceTargetFor(daysOut: number, bands: PaceBand[]): number | null {
  for (const band of bands) {
    if (daysOut >= band.min_days_out && daysOut <= band.max_days_out) {
      return Number(band.target_occupancy_pct);
    }
  }
  return null;
}

export interface MarketSignal {
  /** Median competitor price for the date, in the hotel's currency. */
  median: number | null;
  /** How many competitor observations that median rests on. */
  sampleSize: number;
  /** Age of the freshest observation, in hours. */
  ageHours: number | null;
}

export interface MarketValidation {
  min_competitors: number;
  max_age_hours: number;
  /** Cap as a percentage of the market median when occupancy is soft. */
  median_cap_low_occ_pct: number;
  /** Cap as a percentage of the market median when the date is filling well. */
  median_cap_high_occ_pct: number;
}

export const DEFAULT_MARKET_VALIDATION: MarketValidation = {
  min_competitors: 4,
  max_age_hours: 24,
  median_cap_low_occ_pct: 125,
  median_cap_high_occ_pct: 140,
};

export interface DecisionInput {
  stayDate: string;
  daysOut: number;
  /** Whole-euro reference price for the date (2-pax reference cell). */
  currentPrice: number | null;
  occupancyPct: number | null;
  roomsSold: number | null;
  roomsRemaining: number | null;
  /** Reservations first seen by the ledger in each window. */
  pickup1h: number;
  pickup24h: number;
  pickup48h: number;
  pickup7d: number;
  cancellations24h: number;
  /** Newest cancellation for the date, ISO, or null. */
  lastCancellationAt: string | null;
  /** Direction and time of the previous automated decision for this date. */
  lastDirection: Direction | null;
  lastDecisionAt: string | null;
  /** Total whole-euro movement this date already made in the local day. */
  movedTodayEur: number;
  /** A human touched this date recently; automation stands back until then. */
  manualHoldUntil: string | null;
  /** Whole-euro floor and ceiling already resolved for the reference cell. */
  minPrice: number;
  maxPrice: number;
  /** Uplift from an event that has NOT yet been applied to this date. */
  pendingEventUplift: number;
  market: MarketSignal;
}

export interface DecisionSettings {
  now: Date;
  paceBands: PaceBand[];
  windowRules: WindowRule[];
  marketValidation: MarketValidation;
  /** Smallest movement worth publishing, in whole euros. */
  minMovementEur: number;
  /** A date may not reverse direction inside this many hours. */
  directionChangeHours: number;
  /** Minutes to wait after a cancellation before a markdown is allowed. */
  cancellationWaitMinutes: number;
  /** Reservations in 24h that count as a genuine demand signal. */
  abnormalPickupThreshold: number;
  /** Occupancy at or above which the date counts as effectively sold out. */
  soldOutOccupancyPct: number;
}

export const DEFAULT_DECISION_SETTINGS: Omit<DecisionSettings, "now" | "paceBands"> = {
  windowRules: DEFAULT_WINDOW_RULES,
  marketValidation: DEFAULT_MARKET_VALIDATION,
  minMovementEur: 3,
  directionChangeHours: 6,
  cancellationWaitMinutes: 60,
  abnormalPickupThreshold: 2,
  soldOutOccupancyPct: 98,
};

export interface Decision {
  stayDate: string;
  daysOut: number;
  direction: Direction;
  /** Signed whole-euro movement against the current price. */
  movement: number;
  currentPrice: number | null;
  targetPrice: number | null;
  paceTargetPct: number | null;
  paceGapPct: number | null;
  reason: string;
  reasonDetail: string;
  capApplied: number | null;
  /** True when the date was skipped and no price row should be produced. */
  blocked: boolean;
}

const hoursSince = (iso: string | null, now: Date): number | null => {
  if (!iso) return null;
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return null;
  return (now.getTime() - parsed) / 3_600_000;
};

const whole = (value: number): number => Math.round(value);

function hold(input: DecisionInput, reason: string, detail: string, paceTarget: number | null, gap: number | null): Decision {
  return {
    stayDate: input.stayDate,
    daysOut: input.daysOut,
    direction: "hold",
    movement: 0,
    currentPrice: input.currentPrice,
    targetPrice: input.currentPrice,
    paceTargetPct: paceTarget,
    paceGapPct: gap,
    reason,
    reasonDetail: detail,
    capApplied: null,
    blocked: true,
  };
}

/**
 * Size of the move suggested by how far the date is from its pace target.
 * Deliberately gentle: pricing is a nudge every hour, not a correction.
 */
export function paceStep(gapPct: number, windowRule: WindowRule): number {
  const magnitude = Math.abs(gapPct);
  let step: number;
  if (magnitude >= 30) step = windowRule.max_step;
  else if (magnitude >= 20) step = Math.max(3, Math.round(windowRule.max_step * 0.75));
  else if (magnitude >= 10) step = Math.max(3, Math.round(windowRule.max_step * 0.5));
  else return 0;
  return gapPct > 0 ? step : -step;
}

/** Highest price the market evidence supports, or null when evidence is thin. */
export function marketCeiling(
  market: MarketSignal,
  occupancyPct: number | null,
  validation: MarketValidation,
): number | null {
  if (market.median == null || !(market.median > 0)) return null;
  if (market.sampleSize < validation.min_competitors) return null;
  if (market.ageHours == null || market.ageHours > validation.max_age_hours) return null;
  const strong = (occupancyPct ?? 0) >= 70;
  const pct = strong ? validation.median_cap_high_occ_pct : validation.median_cap_low_occ_pct;
  return whole(market.median * (pct / 100));
}

export function decideDate(input: DecisionInput, settings: DecisionSettings): Decision {
  const { now } = settings;
  const paceTarget = paceTargetFor(input.daysOut, settings.paceBands);
  const gap = paceTarget != null && input.occupancyPct != null
    ? Math.round((input.occupancyPct - paceTarget) * 10) / 10
    : null;

  if (input.currentPrice == null || !(input.currentPrice > 0)) {
    return hold(input, "no_price", "No current price on file for this date.", paceTarget, gap);
  }
  const current = whole(input.currentPrice);

  // A person owns the date for as long as their hold lasts.
  if (input.manualHoldUntil && Date.parse(input.manualHoldUntil) > now.getTime()) {
    return hold(input, "manual_hold", "A manual price change is protected for now.", paceTarget, gap);
  }

  // Nothing left to sell — no price change can earn anything.
  const soldOut = (input.roomsRemaining != null && input.roomsRemaining <= 0)
    || (input.occupancyPct != null && input.occupancyPct >= settings.soldOutOccupancyPct);
  if (soldOut) {
    return hold(input, "sold_out", "The date is sold out; the closing price stays.", paceTarget, gap);
  }

  const windowRule = windowFor(input.daysOut, settings.windowRules);

  // Movement budget already consumed by earlier runs in this local day.
  const remainingBudget = Math.max(0, windowRule.max_daily - Math.abs(input.movedTodayEur));
  if (remainingBudget <= 0) {
    return hold(input, "daily_budget_spent", `This date already moved €${Math.abs(input.movedTodayEur)} today.`, paceTarget, gap);
  }

  // --- Build the raw intent -------------------------------------------------
  let raw = 0;
  let reason = "hold";
  let detail = "No signal strong enough to move the price.";

  const genuinePickup = input.pickup24h;
  const netDemand = genuinePickup - input.cancellations24h;

  if (gap == null) {
    return hold(input, "no_pace_data", "No occupancy or pace target available for this date.", paceTarget, gap);
  }

  if (netDemand >= settings.abnormalPickupThreshold) {
    // Real, verified demand: reward it, on top of any pace pressure.
    const demandStep = Math.min(windowRule.max_step, Math.max(3, netDemand * 2));
    raw = demandStep + Math.max(0, paceStep(gap, windowRule));
    reason = "genuine_pickup";
    detail = `${genuinePickup} new booking${genuinePickup === 1 ? "" : "s"} in 24h with ${input.occupancyPct}% sold (target ${paceTarget}%).`;
  } else if (gap >= 10) {
    raw = paceStep(gap, windowRule);
    reason = "ahead_of_pace";
    detail = `${input.occupancyPct}% sold against a ${paceTarget}% target for ${input.daysOut} days out.`;
  } else if (gap <= -10) {
    // A markdown needs BOTH: behind pace AND no genuine demand recently.
    if (input.pickup48h > 0) {
      return hold(input, "recent_pickup", `Behind pace, but ${input.pickup48h} booking${input.pickup48h === 1 ? "" : "s"} arrived in the last 48h.`, paceTarget, gap);
    }
    const sinceCancellation = hoursSince(input.lastCancellationAt, now);
    if (sinceCancellation != null && sinceCancellation * 60 < settings.cancellationWaitMinutes) {
      return hold(input, "cancellation_cooldown", "A cancellation just landed; waiting before repricing.", paceTarget, gap);
    }
    raw = paceStep(gap, windowRule);
    reason = "behind_pace";
    detail = `${input.occupancyPct}% sold against a ${paceTarget}% target for ${input.daysOut} days out, with no bookings in 48h.`;
  } else {
    return hold(input, "on_pace", `${input.occupancyPct}% sold is in line with the ${paceTarget}% target.`, paceTarget, gap);
  }

  // A confirmed event lifts the date once, and only upwards.
  if (input.pendingEventUplift > 0 && raw >= 0) {
    raw += whole(input.pendingEventUplift);
    reason = reason === "hold" ? "event" : `${reason}+event`;
    detail += ` Event uplift €${whole(input.pendingEventUplift)} applied once.`;
  }

  if (raw === 0) {
    return hold(input, "no_movement", detail, paceTarget, gap);
  }

  const wantsIncrease = raw > 0;
  if (wantsIncrease && !windowRule.allow_increase) {
    return hold(input, "window_blocks_increase", "Increases are not allowed this close to arrival.", paceTarget, gap);
  }
  if (!wantsIncrease && !windowRule.allow_decrease) {
    return hold(input, "window_blocks_decrease", "Long-lead dates hold their strength instead of marking down.", paceTarget, gap);
  }

  // Direction cannot flip inside the cooldown — this is what stops oscillation.
  const sinceLast = hoursSince(input.lastDecisionAt, now);
  if (
    input.lastDirection && input.lastDirection !== "hold"
    && ((wantsIncrease && input.lastDirection === "decrease") || (!wantsIncrease && input.lastDirection === "increase"))
    && sinceLast != null && sinceLast < settings.directionChangeHours
  ) {
    return hold(
      input,
      "direction_cooldown",
      `The price moved ${input.lastDirection === "increase" ? "up" : "down"} ${Math.round(sinceLast)}h ago; direction changes wait ${settings.directionChangeHours}h.`,
      paceTarget,
      gap,
    );
  }

  // --- Clamp ----------------------------------------------------------------
  let capApplied: number | null = null;
  let movement = raw;

  if (Math.abs(movement) > windowRule.max_step) {
    movement = Math.sign(movement) * windowRule.max_step;
    capApplied = windowRule.max_step;
  }
  if (Math.abs(movement) > remainingBudget) {
    movement = Math.sign(movement) * remainingBudget;
    capApplied = remainingBudget;
  }

  let target = whole(current + movement);
  const floor = whole(input.minPrice);
  const ceiling = whole(input.maxPrice);
  if (target < floor) { target = floor; capApplied = floor; }
  if (target > ceiling) { target = ceiling; capApplied = ceiling; }

  const marketCap = marketCeiling(input.market, input.occupancyPct, settings.marketValidation);
  if (marketCap != null && target > marketCap && target > current) {
    target = Math.max(current, marketCap);
    capApplied = marketCap;
  }

  movement = target - current;
  if (Math.abs(movement) < settings.minMovementEur) {
    return hold(input, "below_min_movement", `The change would be under €${settings.minMovementEur}.`, paceTarget, gap);
  }

  return {
    stayDate: input.stayDate,
    daysOut: input.daysOut,
    direction: movement > 0 ? "increase" : "decrease",
    movement,
    currentPrice: current,
    targetPrice: target,
    paceTargetPct: paceTarget,
    paceGapPct: gap,
    reason,
    reasonDetail: detail,
    capApplied,
    blocked: false,
  };
}

/** Plain-language sentence for the activity feed and the morning digest. */
export function explainDecision(decision: Decision): string {
  if (decision.blocked) {
    return `${decision.stayDate}: no change — ${decision.reasonDetail}`;
  }
  const verb = decision.direction === "increase" ? "up" : "down";
  return `${decision.stayDate}: €${decision.currentPrice} → €${decision.targetPrice} (${verb} €${Math.abs(decision.movement)}) — ${decision.reasonDetail}`;
}
