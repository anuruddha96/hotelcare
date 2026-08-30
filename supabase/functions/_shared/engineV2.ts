// Revenue automation engine, version 2 — pure decision logic (Hotel Ottofiori).
//
// One stay date in, one decision out. No I/O here on purpose: every rule below
// is exercised directly by unit tests, and the orchestrator (runV2.ts) only
// gathers the facts and applies the outcome.
//
// Design commitments that came out of the Ottofiori incident:
//  * every price is a whole euro, everywhere, always;
//  * step limits are NEVER used as absolute price bounds;
//  * a markdown needs a real reason (behind pace / occupancy AND a genuine
//    no-pickup wait), never just "no booking arrived in the last two hours";
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
  /** Stable identifier used by the per-window rule implementation. */
  id: "w0_2" | "w3_7" | "w8_30" | "w31_90" | "w91_180" | "w181_365";
  min_days_out: number;
  /** Inclusive upper bound; null means "to the end of the horizon". */
  max_days_out: number | null;
  /** Hours without genuine pickup before a markdown may be considered. */
  no_pickup_wait_hours: number | null;
  /** Largest total downward movement for one stay date within one local day. */
  max_daily_decrease: number;
  /** Largest total upward movement for one stay date within one local day. */
  max_daily_increase: number;
  /** Minimum hours between two decreases for this date (0 = no extra limit). */
  min_hours_between_decreases: number;
  /** Decrease requires the current price to sit above the validated anchor. */
  require_above_anchor: boolean;
}

/** The agreed Ottofiori lead-time strategy, expressed as data. */
export const OTTOFIORI_WINDOW_RULES: WindowRule[] = [
  { id: "w0_2", min_days_out: 0, max_days_out: 2, no_pickup_wait_hours: 6, max_daily_decrease: 15, max_daily_increase: 10, min_hours_between_decreases: 0, require_above_anchor: false },
  { id: "w3_7", min_days_out: 3, max_days_out: 7, no_pickup_wait_hours: 12, max_daily_decrease: 10, max_daily_increase: 12, min_hours_between_decreases: 0, require_above_anchor: false },
  { id: "w8_30", min_days_out: 8, max_days_out: 30, no_pickup_wait_hours: 24, max_daily_decrease: 5, max_daily_increase: 15, min_hours_between_decreases: 0, require_above_anchor: false },
  { id: "w31_90", min_days_out: 31, max_days_out: 90, no_pickup_wait_hours: 72, max_daily_decrease: 5, max_daily_increase: 12, min_hours_between_decreases: 48, require_above_anchor: true },
  { id: "w91_180", min_days_out: 91, max_days_out: 180, no_pickup_wait_hours: 24 * 7, max_daily_decrease: 3, max_daily_increase: 8, min_hours_between_decreases: 72, require_above_anchor: true },
  { id: "w181_365", min_days_out: 181, max_days_out: null, no_pickup_wait_hours: null, max_daily_decrease: 0, max_daily_increase: 13, min_hours_between_decreases: 0, require_above_anchor: true },
];

/** Kept as the exported default so callers never fall back to generic bands. */
export const DEFAULT_WINDOW_RULES = OTTOFIORI_WINDOW_RULES;

export function windowFor(daysOut: number, rules: WindowRule[] = OTTOFIORI_WINDOW_RULES): WindowRule {
  for (const rule of rules) {
    const withinLower = daysOut >= rule.min_days_out;
    const withinUpper = rule.max_days_out === null || daysOut <= rule.max_days_out;
    if (withinLower && withinUpper) return rule;
  }
  return rules[rules.length - 1] ?? OTTOFIORI_WINDOW_RULES[OTTOFIORI_WINDOW_RULES.length - 1];
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

export interface CompetitorObservation {
  competitor_id: string;
  stay_date: string;
  rate: number;
  captured_at: string;
}

export interface MarketSignal {
  /** Median competitor price for the date, in the hotel's currency. */
  median: number | null;
  /** How many DISTINCT competitors that median rests on. */
  sampleSize: number;
  /** Age of the freshest observation, in hours. */
  ageHours: number | null;
  /** Why the signal is unusable, when it is. */
  rejected?: string;
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

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * Latest observation per competitor, invalid values and statistical outliers
 * removed, then the median across DISTINCT competitors.
 */
export function buildMarketSignal(
  observations: CompetitorObservation[],
  now: Date,
  validation: MarketValidation = DEFAULT_MARKET_VALIDATION,
): MarketSignal {
  const latest = new Map<string, CompetitorObservation>();
  for (const obs of observations) {
    const rate = Number(obs.rate);
    if (!Number.isFinite(rate) || rate <= 0) continue;
    const at = Date.parse(obs.captured_at);
    if (!Number.isFinite(at)) continue;
    if ((now.getTime() - at) / 3_600_000 > validation.max_age_hours) continue;
    const seen = latest.get(obs.competitor_id);
    if (!seen || Date.parse(seen.captured_at) < at) latest.set(obs.competitor_id, obs);
  }
  const rows = [...latest.values()];
  if (rows.length === 0) return { median: null, sampleSize: 0, ageHours: null, rejected: "no_fresh_observations" };

  // Outlier strip: drop anything further than 1.5 IQR from the quartiles.
  const prices = rows.map((r) => Number(r.rate)).sort((a, b) => a - b);
  const q = (p: number) => prices[Math.min(prices.length - 1, Math.max(0, Math.floor(p * (prices.length - 1))))];
  const q1 = q(0.25);
  const q3 = q(0.75);
  const iqr = q3 - q1;
  const lo = q1 - 1.5 * iqr;
  const hi = q3 + 1.5 * iqr;
  const kept = rows.filter((r) => Number(r.rate) >= lo && Number(r.rate) <= hi);

  if (kept.length < validation.min_competitors) {
    return { median: null, sampleSize: kept.length, ageHours: null, rejected: "too_few_competitors" };
  }
  const newest = Math.max(...kept.map((r) => Date.parse(r.captured_at)));
  return {
    median: median(kept.map((r) => Number(r.rate))),
    sampleSize: kept.length,
    ageHours: (now.getTime() - newest) / 3_600_000,
  };
}

export interface DecisionInput {
  stayDate: string;
  daysOut: number;
  /** Whole-euro reference price for the date (2-pax reference cell). */
  currentPrice: number | null;
  occupancyPct: number | null;
  roomsSold: number | null;
  roomsRemaining: number | null;
  /** Genuine new reservations first seen by the ledger, per window. */
  pickup1h: number;
  pickup6h: number;
  pickup24h: number;
  pickup48h: number;
  pickup7d: number;
  cancellations24h: number;
  /** Hours since the ledger last discovered a reservation for this date. */
  hoursSinceLastPickup: number | null;
  /** Newest cancellation for the date, ISO, or null. */
  lastCancellationAt: string | null;
  /** Direction and time of the previous automated decision for this date. */
  lastDirection: Direction | null;
  lastDecisionAt: string | null;
  /** Newest automated decrease for this date, ISO, or null. */
  lastDecreaseAt: string | null;
  /** Whole-euro movement already spent by this date in the local day. */
  movedUpTodayEur: number;
  movedDownTodayEur: number;
  /** A human touched this date recently; automation stands back until then. */
  manualHoldUntil: string | null;
  /**
   * "soft" — an ordinary manual price edit: markdowns wait, but genuine new
   * pickup may still raise the price once.
   * "hard" — a manager lock: nothing moves until it expires.
   */
  holdKind?: "soft" | "hard" | null;
  /** Whole-euro floor and ceiling for the reference cell; null = unresolved. */
  minPrice: number | null;
  maxPrice: number | null;
  /**
   * Lowest price this date may be sold at without breaking the rolling ADR
   * target across the guard window. Null when the guard is off or infeasible.
   */
  adrFloor?: number | null;
  /** Validated weekday/seasonal anchor price for this date. */
  anchorPrice: number | null;
  /** Occupancy crossed 60% since the last decision (31–90 day rule). */
  crossed60Occupancy: boolean;
  /** Uplift from an event that has NOT yet been applied to this date. */
  pendingEventUplift: number;
  market: MarketSignal;
  /** True when the PMS feed for this date is stale or failed. */
  dataStale?: boolean;
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
  /** Occupancy at or above which the date counts as effectively sold out. */
  soldOutOccupancyPct: number;
  /** Rooms left at or below which 8–30 day markdowns are switched off. */
  minRoomsForMarkdown: number;
}

export const DEFAULT_DECISION_SETTINGS: Omit<DecisionSettings, "now" | "paceBands"> = {
  windowRules: OTTOFIORI_WINDOW_RULES,
  marketValidation: DEFAULT_MARKET_VALIDATION,
  minMovementEur: 3,
  directionChangeHours: 6,
  cancellationWaitMinutes: 60,
  soldOutOccupancyPct: 98,
  minRoomsForMarkdown: 5,
};

export interface Decision {
  stayDate: string;
  daysOut: number;
  windowId: string;
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

function hold(
  input: DecisionInput,
  windowId: string,
  reason: string,
  detail: string,
  paceTarget: number | null,
  gap: number | null,
): Decision {
  return {
    stayDate: input.stayDate,
    daysOut: input.daysOut,
    windowId,
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

/** Highest price the market evidence supports, or null when evidence is thin. */
export function marketCeiling(
  market: MarketSignal,
  occupancyPct: number | null,
  hasPickup: boolean,
  validation: MarketValidation,
): number | null {
  if (market.median == null || !(market.median > 0)) return null;
  if (market.sampleSize < validation.min_competitors) return null;
  if (market.ageHours == null || market.ageHours > validation.max_age_hours) return null;
  const strong = (occupancyPct ?? 0) >= 85 && hasPickup;
  const pct = strong ? validation.median_cap_high_occ_pct : validation.median_cap_low_occ_pct;
  return whole(market.median * (pct / 100));
}

interface RawIntent {
  raw: number;
  reason: string;
  detail: string;
  /** Set when the window explicitly refuses to move. */
  blockReason?: string;
  blockDetail?: string;
}

/** The agreed per-window rule set, expressed exactly as specified. */
export function windowIntent(
  input: DecisionInput,
  win: WindowRule,
  gap: number | null,
  settings: DecisionSettings,
): RawIntent {
  const occ = input.occupancyPct;
  const pickup = Math.max(0, input.pickup24h - input.cancellations24h);
  const waited = win.no_pickup_wait_hours != null
    && (input.hoursSinceLastPickup == null || input.hoursSinceLastPickup >= win.no_pickup_wait_hours);
  const noPickupNow = pickup <= 0;
  const aboveAnchor = input.anchorPrice == null ? false : (input.currentPrice ?? 0) > input.anchorPrice;

  const inc = (amount: number, detail: string): RawIntent => ({ raw: amount, reason: "genuine_pickup", detail });
  const dec = (amount: number, detail: string): RawIntent => ({ raw: -amount, reason: "no_pickup_markdown", detail });
  const none = (reason: string, detail: string): RawIntent => ({ raw: 0, reason, detail, blockReason: reason, blockDetail: detail });

  switch (win.id) {
    case "w0_2": {
      if (pickup > 0) {
        if (occ != null && occ >= 90) return inc(8, `${pickup} new booking(s) with ${occ}% sold, 0–2 days out.`);
        if (occ != null && occ >= 80) return inc(5, `${pickup} new booking(s) with ${occ}% sold, 0–2 days out.`);
        if (pickup >= 2) return inc(5, `${pickup} new bookings under 80% sold, 0–2 days out.`);
        return none("single_pickup_hold", "One booking under 80% sold is not enough to raise this close in.");
      }
      if (!waited) return none("awaiting_no_pickup_window", "Waiting the full 6 hours without a booking before any markdown.");
      if (occ == null) return none("no_occupancy", "No occupancy reading for this date.");
      if (occ >= 80) return none("occupancy_protected", `${occ}% sold, 0–2 days out: the price holds.`);
      if (occ >= 60) return dec(3, `${occ}% sold and no booking for 6 hours, 0–2 days out.`);
      return dec(5, `${occ}% sold and no booking for 6 hours, 0–2 days out.`);
    }
    case "w3_7": {
      if (pickup > 0) {
        if (occ != null && occ >= 85) return inc(8, `${pickup} new booking(s) with ${occ}% sold, 3–7 days out.`);
        if (occ != null && occ >= 75) return inc(5, `${pickup} new booking(s) with ${occ}% sold, 3–7 days out.`);
        if (pickup >= 2) return inc(3, `${pickup} new bookings under 75% sold, 3–7 days out.`);
        return none("single_pickup_hold", "One booking under 75% sold is not enough to raise yet.");
      }
      if (!waited) return none("awaiting_no_pickup_window", "Waiting the full 12 hours without a booking before any markdown.");
      if (occ == null) return none("no_occupancy", "No occupancy reading for this date.");
      if (occ >= 75) return none("occupancy_protected", `${occ}% sold, 3–7 days out: the price holds.`);
      if (occ >= 60) return dec(3, `${occ}% sold and no booking for 12 hours, 3–7 days out.`);
      return dec(5, `${occ}% sold and no booking for 12 hours, 3–7 days out.`);
    }
    case "w8_30":
    case "w31_90": {
      if (pickup > 0) {
        const step = pickup >= 3 ? 12 : pickup === 2 ? 8 : 5;
        return inc(step, `${pickup} new booking(s) for this date, ${win.id === "w8_30" ? "8–30" : "31–90"} days out.`);
      }
      if (win.id === "w31_90" && input.crossed60Occupancy) {
        return { raw: 5, reason: "occupancy_crossing", detail: "Occupancy crossed 60% for this date — one-off €5 increase." };
      }
      if (!waited) {
        return none("awaiting_no_pickup_window", `Waiting ${win.no_pickup_wait_hours} hours without a booking before any markdown.`);
      }
      if (!noPickupNow) return none("recent_pickup", "Bookings arrived recently; no markdown.");
      if (gap == null) return none("no_pace_data", "No pace target or occupancy for this date.");
      if (win.id === "w8_30") {
        if (occ != null && occ >= 75) return none("occupancy_protected", `${occ}% sold: no markdown 8–30 days out.`);
        if (input.roomsRemaining != null && input.roomsRemaining <= settings.minRoomsForMarkdown) {
          return none("low_inventory", `${input.roomsRemaining} rooms left: no markdown 8–30 days out.`);
        }
        if (gap <= -20) return dec(5, `${Math.abs(gap)} points behind pace with no booking for 24 hours.`);
        if (gap <= -10) return dec(3, `${Math.abs(gap)} points behind pace with no booking for 24 hours.`);
        return none("on_pace", "Not far enough behind pace to justify a markdown.");
      }
      // 31–90 days
      if (!aboveAnchor) return none("at_anchor", "The price is already at or below its seasonal anchor.");
      if (gap <= -25) return dec(5, `${Math.abs(gap)} points behind pace, 31–90 days out, above anchor.`);
      if (gap <= -15) return dec(3, `${Math.abs(gap)} points behind pace, 31–90 days out, above anchor.`);
      return none("on_pace", "Less than 15 points behind pace: no markdown 31–90 days out.");
    }
    case "w91_180": {
      if (pickup >= 2) return inc(8, `${pickup} new bookings within 24 hours, 91–180 days out.`);
      if (pickup === 1) return inc(5, "One genuine booking, 91–180 days out.");
      if (!waited) return none("far_out_no_markdown", "Long-lead dates do not mark down for an hourly no-pickup check.");
      if (gap == null || gap >= 0) return none("on_pace", "Not behind pace: long-lead price holds.");
      if (!aboveAnchor) return none("at_anchor", "The price is already at or below its seasonal anchor.");
      return dec(3, `No booking for seven days and ${Math.abs(gap)} points behind pace, 91–180 days out.`);
    }
    case "w181_365":
    default: {
      if (pickup >= 2) return inc(13, `${pickup} bookings within 24 hours, 181+ days out (€5 + €8).`);
      if (pickup === 1) return inc(5, "First genuine booking, 181+ days out.");
      return none("far_out_no_markdown", "Dates beyond 180 days never mark down for a lack of pickup.");
    }
  }
}

export function decideDate(input: DecisionInput, settings: DecisionSettings): Decision {
  const { now } = settings;
  const win = windowFor(input.daysOut, settings.windowRules);
  const paceTarget = paceTargetFor(input.daysOut, settings.paceBands);
  const gap = paceTarget != null && input.occupancyPct != null
    ? Math.round((input.occupancyPct - paceTarget) * 10) / 10
    : null;
  const blocked = (reason: string, detail: string) => hold(input, win.id, reason, detail, paceTarget, gap);

  if (input.dataStale) {
    return blocked("stale_data", "The PMS feed is stale; no price may change.");
  }
  if (input.currentPrice == null || !(input.currentPrice > 0)) {
    return blocked("no_price", "No current price on file for this date.");
  }
  // Bounds are a hard requirement — never guessed.
  if (input.minPrice == null || input.maxPrice == null
    || !Number.isFinite(input.minPrice) || !Number.isFinite(input.maxPrice)) {
    return blocked("bounds_missing", "No resolvable minimum and maximum price for this date.");
  }
  if (input.maxPrice < input.minPrice) {
    return blocked("bounds_invalid", `Maximum €${input.maxPrice} is below minimum €${input.minPrice}.`);
  }
  const current = whole(input.currentPrice);

  // A manager lock stops everything; an ordinary manual edit only protects the
  // price from being marked down, and genuine new pickup may still lift it.
  const holdActive = Boolean(input.manualHoldUntil && Date.parse(input.manualHoldUntil) > now.getTime());
  const hardLock = holdActive && input.holdKind === "hard";
  if (hardLock) {
    return blocked("manual_lock", "A manager locked this date; automation leaves it alone.");
  }

  const soldOut = (input.roomsRemaining != null && input.roomsRemaining <= 0)
    || (input.occupancyPct != null && input.occupancyPct >= settings.soldOutOccupancyPct);
  if (soldOut) {
    return blocked("sold_out", "The date is sold out; the closing price stays.");
  }

  // --- Pickup is always evaluated before any markdown branch -----------------
  const intent = windowIntent(input, win, gap, settings);
  let raw = intent.raw;
  let reason = intent.reason;
  let detail = intent.detail;
  if (raw === 0) return blocked(intent.blockReason ?? "hold", intent.blockDetail ?? detail);

  if (holdActive) {
    const genuinePickup = Math.max(0, input.pickup24h - input.cancellations24h) > 0;
    if (raw < 0) {
      return blocked("manual_hold", "A manual price change is protected for now; no markdown.");
    }
    if (!genuinePickup) {
      return blocked("manual_hold", "A manual price change is protected for now.");
    }
    detail += " Manual protection overridden by genuine new pickup.";
  }

  const hasPickup = Math.max(0, input.pickup24h - input.cancellations24h) > 0;

  if (raw < 0) {
    // Cancellation cooldown: a cancellation must never trigger an instant cut.
    const sinceCancellation = hoursSince(input.lastCancellationAt, now);
    if (sinceCancellation != null && sinceCancellation * 60 < settings.cancellationWaitMinutes) {
      return blocked("cancellation_cooldown", "A cancellation just landed; waiting before repricing.");
    }
    if (win.min_hours_between_decreases > 0) {
      const sinceDecrease = hoursSince(input.lastDecreaseAt, now);
      if (sinceDecrease != null && sinceDecrease < win.min_hours_between_decreases) {
        return blocked(
          "decrease_frequency",
          `This date was already lowered ${Math.round(sinceDecrease)}h ago; ${win.min_hours_between_decreases}h must pass.`,
        );
      }
    }
    if (win.max_daily_decrease <= 0) {
      return blocked("window_blocks_decrease", "This lead window never marks down.");
    }
  }

  // A confirmed event lifts the date once, and only upwards.
  if (input.pendingEventUplift > 0 && raw >= 0) {
    raw += whole(input.pendingEventUplift);
    reason = `${reason}+event`;
    detail += ` Event uplift €${whole(input.pendingEventUplift)} applied once.`;
  }

  // Direction cannot flip inside the cooldown — this is what stops oscillation.
  const wantsIncrease = raw > 0;
  const sinceLast = hoursSince(input.lastDecisionAt, now);
  const reversing = input.lastDirection && input.lastDirection !== "hold"
    && ((wantsIncrease && input.lastDirection === "decrease") || (!wantsIncrease && input.lastDirection === "increase"));
  if (reversing && sinceLast != null && sinceLast < settings.directionChangeHours) {
    // Genuine new pickup is the only justification for an early upward turn.
    const justified = wantsIncrease && hasPickup;
    if (!justified) {
      return blocked(
        "direction_cooldown",
        `The price moved ${input.lastDirection === "increase" ? "up" : "down"} ${Math.round(sinceLast)}h ago; direction changes wait ${settings.directionChangeHours}h.`,
      );
    }
  }

  // --- Clamp ----------------------------------------------------------------
  let capApplied: number | null = null;
  let movement = whole(raw);

  const budget = wantsIncrease
    ? Math.max(0, win.max_daily_increase - Math.abs(input.movedUpTodayEur))
    : Math.max(0, win.max_daily_decrease - Math.abs(input.movedDownTodayEur));
  if (budget <= 0) {
    return blocked(
      "daily_budget_spent",
      `This date already moved its full ${wantsIncrease ? "increase" : "decrease"} allowance today.`,
    );
  }
  if (Math.abs(movement) > budget) {
    movement = Math.sign(movement) * budget;
    capApplied = budget;
  }

  let target = whole(current + movement);
  // The rolling ADR guard raises the effective floor for markdowns: the engine
  // may sell a date down, but never below the rate the next few nights still
  // need to hold the average rate target.
  const adrFloor = input.adrFloor != null && Number.isFinite(input.adrFloor) ? whole(input.adrFloor) : null;
  const floor = adrFloor != null ? Math.max(whole(input.minPrice), adrFloor) : whole(input.minPrice);
  const ceiling = whole(input.maxPrice);
  // Bounds limit where automation may MOVE a price; they never force a move of
  // their own. A rise stops at the ceiling, a cut stops at the floor, and a
  // price already outside its band (a manual New Year's Eve rate, say) is left
  // exactly where the human put it.
  if (target > current && target > ceiling) { target = Math.max(current, ceiling); capApplied = ceiling; }
  if (target < current && target < floor) { target = Math.min(current, floor); capApplied = floor; }

  const marketCap = marketCeiling(input.market, input.occupancyPct, hasPickup, settings.marketValidation);
  if (marketCap != null && target > marketCap && target > current) {
    target = Math.max(current, marketCap);
    capApplied = marketCap;
  }

  movement = target - current;
  if (Math.abs(movement) < settings.minMovementEur) {
    return blocked("below_min_movement", `The change would be under €${settings.minMovementEur}.`);
  }

  return {
    stayDate: input.stayDate,
    daysOut: input.daysOut,
    windowId: win.id,
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
