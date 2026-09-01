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

/**
 * How much a genuine new booking lifts a stay date. The further out the stay
 * date is, the larger the surcharge: a booking taken six months ahead says far
 * more about demand than one taken tomorrow, and there is time to sell the
 * remaining rooms higher.
 */
export interface PickupLadderBand {
  min_days_out: number;
  /** Inclusive; null means "to the end of the horizon". */
  max_days_out: number | null;
  /** Whole-currency step for one, two, and three-or-more genuine bookings. */
  one: number;
  two: number;
  three_plus: number;
  /** Largest total pickup-driven rise for this date in one local day. */
  max_per_day: number;
}

export const DEFAULT_PICKUP_LADDER: PickupLadderBand[] = [
  { min_days_out: 0, max_days_out: 2, one: 4, two: 6, three_plus: 8, max_per_day: 12 },
  { min_days_out: 3, max_days_out: 7, one: 6, two: 9, three_plus: 12, max_per_day: 18 },
  { min_days_out: 8, max_days_out: 30, one: 8, two: 12, three_plus: 16, max_per_day: 24 },
  { min_days_out: 31, max_days_out: 90, one: 12, two: 18, three_plus: 24, max_per_day: 36 },
  { min_days_out: 91, max_days_out: 180, one: 18, two: 27, three_plus: 36, max_per_day: 50 },
  { min_days_out: 181, max_days_out: null, one: 25, two: 38, three_plus: 50, max_per_day: 60 },
];

export function pickupLadderFor(
  daysOut: number,
  ladder: PickupLadderBand[] = DEFAULT_PICKUP_LADDER,
): PickupLadderBand {
  for (const band of ladder) {
    const lower = daysOut >= Number(band.min_days_out);
    const upper = band.max_days_out == null || daysOut <= Number(band.max_days_out);
    if (lower && upper) return band;
  }
  return ladder[ladder.length - 1] ?? DEFAULT_PICKUP_LADDER[DEFAULT_PICKUP_LADDER.length - 1];
}

/** Whole-currency rise for `bookings` genuine reservations at this lead time. */
export function pickupStep(
  band: PickupLadderBand,
  bookings: number,
  occupancyPct: number | null,
  strongOccupancyPct: number,
): number {
  const base = bookings >= 3
    ? Number(band.three_plus)
    : bookings === 2
      ? Number(band.two)
      : Number(band.one);
  const step = Number.isFinite(base) ? Math.max(0, base) : 0;
  const strong = occupancyPct != null && occupancyPct >= strongOccupancyPct;
  return Math.round(strong ? step * 1.5 : step);
}

/**
 * Occupancy-led lift. A date that is already selling well does not have to
 * produce a booking in the current run to earn a higher price: the occupancy
 * itself is the evidence. This is the rule that corrects "occupancy high but
 * price low" dates, which no pickup-only engine could ever reach.
 */
export interface OccupancyLiftBand {
  min_occupancy_pct: number;
  min_days_out: number;
  /** Rise as a percentage of the current price. */
  pct: number;
  /** Smallest whole-currency rise this band produces. */
  min_eur: number;
}

export const DEFAULT_OCCUPANCY_LIFT_LADDER: OccupancyLiftBand[] = [
  { min_occupancy_pct: 80, min_days_out: 7, pct: 8, min_eur: 10 },
  { min_occupancy_pct: 70, min_days_out: 14, pct: 5, min_eur: 6 },
  { min_occupancy_pct: 60, min_days_out: 30, pct: 3, min_eur: 4 },
];

/** Strongest band whose occupancy AND lead-time conditions both hold. */
export function occupancyLiftBandFor(
  occupancyPct: number | null,
  daysOut: number,
  ladder: OccupancyLiftBand[] = DEFAULT_OCCUPANCY_LIFT_LADDER,
): OccupancyLiftBand | null {
  if (occupancyPct == null || !Number.isFinite(occupancyPct)) return null;
  const eligible = ladder.filter((b) =>
    occupancyPct >= Number(b.min_occupancy_pct) && daysOut >= Number(b.min_days_out)
  );
  if (eligible.length === 0) return null;
  return eligible.reduce((best, b) => (Number(b.pct) > Number(best.pct) ? b : best));
}



/**
 * "Fill mode": inside the selling window the property is trying to reach a
 * full house, so the engine is allowed to react to a smaller shortfall, waits
 * less before acting and may take a slightly larger step down each day.
 * Increases are untouched — a booking still lifts the price immediately — and
 * the total drop per date is capped so pushing sales never becomes dumping.
 */
export interface FillSettings {
  enabled: boolean;
  /** Days before arrival inside which fill mode applies. */
  windowDays: number;
  /** Most a date may fall, as a percentage of its recent starting price. */
  maxTotalDropPct: number;
}

export const DEFAULT_FILL_SETTINGS: FillSettings = {
  enabled: false,
  windowDays: 60,
  maxTotalDropPct: 15,
};

/** Looser daily allowances for a window that is inside the fill campaign. */
export function fillWindowRule(win: WindowRule): WindowRule {
  switch (win.id) {
    case "w0_2":
      return { ...win, no_pickup_wait_hours: 4, max_daily_decrease: Math.max(win.max_daily_decrease, 15) };
    case "w3_7":
      return { ...win, no_pickup_wait_hours: 6, max_daily_decrease: Math.max(win.max_daily_decrease, 12) };
    case "w8_30":
      return { ...win, no_pickup_wait_hours: 8, max_daily_decrease: Math.max(win.max_daily_decrease, 10) };
    case "w31_90":
      return {
        ...win,
        no_pickup_wait_hours: 24,
        max_daily_decrease: Math.max(win.max_daily_decrease, 6),
        min_hours_between_decreases: Math.min(win.min_hours_between_decreases || 24, 24),
        require_above_anchor: false,
      };
    default:
      return win;
  }
}

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
  /**
   * Highest reference price this date carried recently. Fill mode never lets a
   * date fall more than the configured percentage below it, however many runs
   * happen. Null disables the campaign drop budget for the date.
   */
  campaignStartPrice?: number | null;
  /**
   * Grid price the date must not sell below if the hotel is to bank its ADR
   * target once channel discounting is taken into account. This is the hard
   * stop: a cell under it is LIFTED, not merely protected.
   */
  hardAdrFloor?: number | null;
  /** Floor the stay month still needs from its remaining rooms. */
  monthFloor?: number | null;
  /** True when the stay month is behind its ADR target: no markdowns at all. */
  monthMarkdownsFrozen?: boolean;
  /** Highest reference price for this date over the recent look-back. */
  recentPeakPrice?: number | null;
  /** Automated markdowns already taken for this date in the local day. */
  markdownsToday?: number;
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
  /** Occupancy campaign for the near horizon; off by default. */
  fill?: FillSettings | null;
  /** Lead-time surcharge ladder for genuine new bookings. */
  pickupLadder?: PickupLadderBand[] | null;
  /** When true (default) a single genuine booking always raises the price. */
  raiseOnAnyPickup?: boolean;
  /** Occupancy at or above which a pickup surcharge is increased by half. */
  strongOccupancyPct?: number;
  /** Occupancy-led lifts; on by default. */
  occupancyLiftEnabled?: boolean;
  occupancyLiftLadder?: OccupancyLiftBand[] | null;
  /**
   * Anti-arbitrage. A date that just took a booking is not marked down for this
   * many hours — otherwise the guest sees a lower price and rebooks the same
   * night cheaper.
   */
  bookedDateBrakeHours?: number;
  /** Hours after a cancellation during which the date may not be marked down. */
  rebookWindowHours?: number;
  /** Most automated markdowns a single date may take in one local day. */
  maxMarkdownsPerDay?: number;
  /** A markdown may never take a date more than this far below its recent peak. */
  maxMarkdownDepthPct?: number;
  /** Realised ÷ grid rate, used only for wording the explanations. */
  netRateFactor?: number;
}

export const DEFAULT_DECISION_SETTINGS: Omit<DecisionSettings, "now" | "paceBands"> = {
  windowRules: OTTOFIORI_WINDOW_RULES,
  marketValidation: DEFAULT_MARKET_VALIDATION,
  minMovementEur: 3,
  directionChangeHours: 6,
  cancellationWaitMinutes: 60,
  soldOutOccupancyPct: 98,
  minRoomsForMarkdown: 5,
  fill: DEFAULT_FILL_SETTINGS,
  pickupLadder: DEFAULT_PICKUP_LADDER,
  raiseOnAnyPickup: true,
  strongOccupancyPct: 85,
  occupancyLiftEnabled: true,
  occupancyLiftLadder: DEFAULT_OCCUPANCY_LIFT_LADDER,
  bookedDateBrakeHours: 72,
  rebookWindowHours: 24,
  maxMarkdownsPerDay: 1,
  maxMarkdownDepthPct: 12,
  netRateFactor: 1,
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
  /** Daily allowance this intent brings with it (pickup ladder), if any. */
  maxDailyOverride?: number;
}

/**
 * A genuine new booking always lifts the price, and the further out the stay
 * date is the larger the lift. This runs before every per-window rule, so no
 * occupancy test can ever swallow a real booking.
 */
export function pickupLadderIntent(input: DecisionInput, settings: DecisionSettings): RawIntent | null {
  if (settings.raiseOnAnyPickup === false) return null;
  const bookings = Math.max(0, input.pickup24h - input.cancellations24h);
  if (bookings <= 0) return null;
  const ladder = settings.pickupLadder && settings.pickupLadder.length > 0
    ? settings.pickupLadder
    : DEFAULT_PICKUP_LADDER;
  const band = pickupLadderFor(input.daysOut, ladder);
  const step = pickupStep(band, bookings, input.occupancyPct, settings.strongOccupancyPct ?? 85);
  if (step <= 0) return null;
  const occText = input.occupancyPct != null ? ` at ${Math.round(input.occupancyPct)}% sold` : "";
  const strong = input.occupancyPct != null && input.occupancyPct >= (settings.strongOccupancyPct ?? 85);
  return {
    raw: step,
    reason: "genuine_pickup",
    detail: `${bookings} new booking${bookings === 1 ? "" : "s"} for a date ${input.daysOut} days out${occText}: +${step}${strong ? " (strong demand surcharge)" : ""}.`,
    maxDailyOverride: Math.max(step, Number(band.max_per_day) || 0),
  };
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

  const ladderIntent = pickupLadderIntent(input, settings);
  if (ladderIntent) return ladderIntent;

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

/**
 * Fill-mode rules for the selling window. Increases are exactly the ordinary
 * ones — a booking is still rewarded — but a shortfall against pace is acted
 * on sooner and a little harder, because an empty room earns nothing.
 */
export function fillIntent(
  input: DecisionInput,
  win: WindowRule,
  gap: number | null,
  settings: DecisionSettings,
): RawIntent {
  const occ = input.occupancyPct;
  const pickup = Math.max(0, input.pickup24h - input.cancellations24h);
  const waited = win.no_pickup_wait_hours != null
    && (input.hoursSinceLastPickup == null || input.hoursSinceLastPickup >= win.no_pickup_wait_hours);

  const dec = (amount: number, detail: string): RawIntent => ({ raw: -amount, reason: "fill_markdown", detail });
  const none = (reason: string, detail: string): RawIntent => ({ raw: 0, reason, detail, blockReason: reason, blockDetail: detail });

  // Pickup always wins, and uses the ordinary rules so a selling date climbs
  // straight back up.
  if (pickup > 0) return windowIntent(input, win, gap, settings);

  if (!waited) {
    return none("awaiting_no_pickup_window", `Filling: waiting ${win.no_pickup_wait_hours}h without a booking before stepping down.`);
  }
  if (occ == null) return none("no_occupancy", "No occupancy reading for this date.");
  const behind = gap == null ? null : -gap;

  switch (win.id) {
    case "w0_2":
    case "w3_7": {
      if (occ >= 95) return none("occupancy_protected", `${occ}% sold: the last rooms keep their price.`);
      if (input.roomsRemaining != null && input.roomsRemaining <= 2) {
        return none("low_inventory", `${input.roomsRemaining} rooms left: the price holds.`);
      }
      if (occ < 60) return dec(6, `Filling: ${occ}% sold, ${win.id === "w0_2" ? "0–2" : "3–7"} days out and no new booking.`);
      if (occ < 80) return dec(4, `Filling: ${occ}% sold, ${win.id === "w0_2" ? "0–2" : "3–7"} days out and no new booking.`);
      return dec(3, `Filling: ${occ}% sold, ${win.id === "w0_2" ? "0–2" : "3–7"} days out and no new booking.`);
    }
    case "w8_30": {
      if (occ >= 90) return none("occupancy_protected", `${occ}% sold: no markdown 8–30 days out.`);
      if (input.roomsRemaining != null && input.roomsRemaining <= Math.min(3, settings.minRoomsForMarkdown)) {
        return none("low_inventory", `${input.roomsRemaining} rooms left: no markdown 8–30 days out.`);
      }
      if (behind == null) return none("no_pace_data", "No pace target or occupancy for this date.");
      if (behind >= 15) return dec(6, `Filling: ${Math.round(behind)} points behind pace, 8–30 days out.`);
      if (behind >= 5) return dec(4, `Filling: ${Math.round(behind)} points behind pace, 8–30 days out.`);
      return none("on_pace", "On pace for this lead time: the price holds.");
    }
    default: {
      // 31 days out to the edge of the fill window.
      if (occ >= 85) return none("occupancy_protected", `${occ}% sold this far out: the price holds.`);
      if (behind == null) return none("no_pace_data", "No pace target or occupancy for this date.");
      if (behind >= 15) return dec(5, `Filling: ${Math.round(behind)} points behind pace, ${win.min_days_out}+ days out.`);
      if (behind >= 8) return dec(3, `Filling: ${Math.round(behind)} points behind pace, ${win.min_days_out}+ days out.`);
      return none("on_pace", "Less than 8 points behind pace: the price holds.");
    }
  }
}

export function decideDate(input: DecisionInput, settings: DecisionSettings): Decision {
  const { now } = settings;
  const fill = settings.fill?.enabled ? settings.fill : null;
  const inFillWindow = fill != null && input.daysOut <= Math.max(0, fill.windowDays);
  const baseWin = windowFor(input.daysOut, settings.windowRules);
  const win = inFillWindow ? fillWindowRule(baseWin) : baseWin;
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
  let intent = inFillWindow
    ? fillIntent(input, win, gap, settings)
    : windowIntent(input, win, gap, settings);

  // --- ADR-first overrides ---------------------------------------------------
  // 1. Hard ADR stop. A cell sitting under the rate the hotel must load to bank
  //    its ADR target (after channel discounting) is lifted, whatever the
  //    pickup story says. Nothing else in the engine can produce this move.
  const netFloor = input.hardAdrFloor != null && Number.isFinite(input.hardAdrFloor)
    && Number(input.hardAdrFloor) > 0 ? whole(Number(input.hardAdrFloor)) : null;
  if (netFloor != null && current < netFloor) {
    const step = netFloor - current;
    intent = {
      raw: step,
      reason: "net_adr_floor",
      detail: `€${current} is below the €${netFloor} this date must be loaded at to bank the ADR target; lifting.`,
      maxDailyOverride: step,
    };
  } else if (intent.raw <= 0 && settings.occupancyLiftEnabled !== false) {
    // 2. Occupancy-led lift. A date already selling well earns a higher price on
    //    the strength of its occupancy alone — no new booking required.
    const band = occupancyLiftBandFor(
      input.occupancyPct, input.daysOut,
      settings.occupancyLiftLadder ?? DEFAULT_OCCUPANCY_LIFT_LADDER,
    );
    if (band) {
      const step = Math.max(whole(Number(band.min_eur) || 0), whole(current * (Number(band.pct) || 0) / 100));
      if (step > 0) {
        intent = {
          raw: step,
          reason: "occupancy_lift",
          detail: `${Math.round(input.occupancyPct ?? 0)}% sold ${input.daysOut} days out; lifting €${step} on strength of demand.`,
          maxDailyOverride: step,
        };
      }
    }
  }

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
    // The month comes first: a stay month running under its ADR target does not
    // discount at all. Only pickup and occupancy lifts move those dates.
    if (input.monthMarkdownsFrozen) {
      return blocked(
        "month_adr_pace",
        "This stay month is behind its average-rate target; markdowns are frozen until it catches up.",
      );
    }
    const sinceCancellation = hoursSince(input.lastCancellationAt, now);
    if (sinceCancellation != null && sinceCancellation * 60 < settings.cancellationWaitMinutes) {
      return blocked("cancellation_cooldown", "A cancellation just landed; waiting before repricing.");
    }
    // Anti-arbitrage 1: after a cancellation the room goes back on sale at the
    // price it was sold at, never cheaper, for the rebooking window.
    const rebookHours = Math.max(0, settings.rebookWindowHours ?? 0);
    if (sinceCancellation != null && rebookHours > 0 && sinceCancellation < rebookHours) {
      return blocked(
        "rebook_window",
        `A cancellation landed ${Math.round(sinceCancellation)}h ago; the date is held at its sold price for ${rebookHours}h.`,
      );
    }
    // Anti-arbitrage 2: a date that just took a booking is not cut, or the same
    // guest cancels and rebooks the same night cheaper.
    const brakeHours = Math.max(0, settings.bookedDateBrakeHours ?? 0);
    if (brakeHours > 0 && input.hoursSinceLastPickup != null && input.hoursSinceLastPickup < brakeHours) {
      return blocked(
        "booked_date_brake",
        `This date took a booking ${Math.round(input.hoursSinceLastPickup)}h ago; it is not marked down for ${brakeHours}h.`,
      );
    }

    // One markdown per date per day, and never on a day the date already rose.
    const maxMarkdowns = Math.max(0, settings.maxMarkdownsPerDay ?? 0);
    if (maxMarkdowns > 0 && (input.markdownsToday ?? 0) >= maxMarkdowns) {
      return blocked(
        "markdown_limit",
        `This date has already been lowered ${input.markdownsToday} time(s) today; the limit is ${maxMarkdowns}.`,
      );
    }
    if (Math.abs(input.movedUpTodayEur) > 0) {
      return blocked("one_way_day", "This date went up earlier today; it is not cut back on the same day.");
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

  // A pickup surcharge brings its own daily allowance from the ladder, so a
  // long-lead raise is never clipped down to the ordinary window step.
  const dailyIncreaseAllowance = Math.max(
    win.max_daily_increase,
    intent.maxDailyOverride ?? 0,
  );
  const budget = wantsIncrease
    ? Math.max(0, dailyIncreaseAllowance - Math.abs(input.movedUpTodayEur))
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
  // Fill mode may push sales, never dump them: a date can only fall so far
  // below the price it started the campaign at.
  const campaignFloor = inFillWindow
    && input.campaignStartPrice != null && Number.isFinite(input.campaignStartPrice)
    && input.campaignStartPrice > 0
    ? whole(input.campaignStartPrice * (1 - Math.max(0, fill!.maxTotalDropPct) / 100))
    : null;
  // The stay month must still be able to reach its average-rate target, and a
  // date may never be discounted far below the price it recently held.
  const monthFloor = input.monthFloor != null && Number.isFinite(input.monthFloor)
    && Number(input.monthFloor) > 0 ? whole(Number(input.monthFloor)) : null;
  const depthPct = Math.max(0, settings.maxMarkdownDepthPct ?? 0);
  const depthFloor = depthPct > 0 && input.recentPeakPrice != null
    && Number.isFinite(input.recentPeakPrice) && Number(input.recentPeakPrice) > 0
    ? whole(Number(input.recentPeakPrice) * (1 - depthPct / 100))
    : null;
  const floor = Math.max(
    whole(input.minPrice),
    adrFloor ?? 0,
    campaignFloor ?? 0,
    netFloor ?? 0,
    monthFloor ?? 0,
    depthFloor ?? 0,
  );


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
