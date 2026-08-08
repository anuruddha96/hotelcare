// Demand-driven pricing: the rules a revenue manager applies by hand, written
// down once so the app can propose the same move consistently.
//
// Everything here is pure. Amounts are held in EUR because that is how the
// rules are agreed ("+11 EUR on the first pickup"); `toBase` converts them to
// the hotel's own currency for HUF properties. Nothing in this file writes to
// Previo — it only produces a suggested price plus the reasons behind it.

export type DemandRating = "high" | "medium" | "low";

export const DEMAND_RATING_LABEL: Record<DemandRating, string> = {
  high: "High demand",
  medium: "Normal demand",
  low: "Low demand",
};

export interface LadderSettings {
  /** The price is never proposed below this, in the hotel's own currency. */
  minAdr: number | null;
  /** First booking inside the burst window. */
  step1Eur: number;
  /** Second booking — the day's total uplift, not an extra step. */
  step2Eur: number;
  /** Third and further bookings — again a total. */
  step3Eur: number;
  /** How close together bookings must land to count as a burst. */
  burstMinutes: number;
  /** No booking for this many hours → shave the price. */
  idleDecayHours: number;
  idleDecayEur: number;
  /** Applied when the manager grades the day as low demand. */
  lowDemandDecreaseEur: number;
  /** Applied when the manager grades the day as high demand. */
  highDemandIncreaseEur: number;
  /** 1 for EUR hotels; the EUR→HUF rate for forint hotels. */
  eurToBase: number;
}

export const DEFAULT_LADDER: LadderSettings = {
  minAdr: null,
  step1Eur: 11,
  step2Eur: 18,
  step3Eur: 40,
  burstMinutes: 60,
  idleDecayHours: 3,
  idleDecayEur: 1,
  lowDemandDecreaseEur: 2,
  highDemandIncreaseEur: 11,
  eurToBase: 1,
};

export interface PriceDriver {
  kind: "pickup" | "idle" | "demand" | "floor" | "manual";
  label: string;
  /** In the hotel's own currency; positive raises the price. */
  deltaBase: number;
}

export interface LadderInput {
  /** Published price for the day, in the hotel's own currency. */
  currentPrice: number | null;
  /** Booking timestamps for this stay date, most recent last (ISO). */
  bookingTimes: string[];
  /** "Now" — injected so the result is testable. */
  now: Date;
  /** Manager's grade for the day, when one was given. */
  rating?: DemandRating | null;
  settings: LadderSettings;
  /** Skip the idle discount for dates the manager priced by hand today. */
  manuallyPriced?: boolean;
}

export interface LadderResult {
  currentPrice: number | null;
  suggestedPrice: number | null;
  deltaBase: number;
  drivers: PriceDriver[];
  /** Bookings that landed inside the burst window. */
  burstBookings: number;
  /** Whole hours since the most recent booking, null when there are none. */
  hoursIdle: number | null;
  /** True when the floor stopped the price from going lower. */
  clampedByMinAdr: boolean;
}

/** EUR rule amount → the hotel's own currency, rounded to a whole unit. */
export function toBase(eurAmount: number, settings: LadderSettings): number {
  const rate = settings.eurToBase > 0 ? settings.eurToBase : 1;
  return Math.round(eurAmount * rate);
}

/** How many bookings landed within `burstMinutes` of the newest one. */
export function burstCount(bookingTimes: string[], now: Date, burstMinutes: number): number {
  const cutoff = now.getTime() - burstMinutes * 60_000;
  return bookingTimes.filter((t) => {
    const ms = Date.parse(t);
    return Number.isFinite(ms) && ms >= cutoff && ms <= now.getTime();
  }).length;
}

/**
 * Total uplift for a burst, in EUR. The tiers are cumulative totals, not
 * increments: one booking is +11, two is +18 for the day, three or more +40.
 */
export function pickupUpliftEur(bookings: number, s: LadderSettings): number {
  if (bookings <= 0) return 0;
  if (bookings === 1) return s.step1Eur;
  if (bookings === 2) return s.step2Eur;
  return s.step3Eur;
}

/** Whole hours since the newest booking, or null when nothing has sold. */
export function hoursSinceLastBooking(bookingTimes: string[], now: Date): number | null {
  let newest = -Infinity;
  for (const t of bookingTimes) {
    const ms = Date.parse(t);
    if (Number.isFinite(ms) && ms > newest) newest = ms;
  }
  if (!Number.isFinite(newest)) return null;
  return Math.max(0, Math.floor((now.getTime() - newest) / 3_600_000));
}

/**
 * The whole ladder in one call: pickup uplift, idle decay, the manager's
 * demand grade, then the minimum-ADR floor which always has the last word.
 */
export function suggestLadderPrice(input: LadderInput): LadderResult {
  const s = input.settings;
  const drivers: PriceDriver[] = [];
  const bookings = burstCount(input.bookingTimes, input.now, s.burstMinutes);
  const idle = hoursSinceLastBooking(input.bookingTimes, input.now);

  let delta = 0;

  if (bookings > 0) {
    const up = toBase(pickupUpliftEur(bookings, s), s);
    delta += up;
    drivers.push({
      kind: "pickup",
      label: `${bookings} booking${bookings === 1 ? "" : "s"} in the last ${s.burstMinutes} minutes`,
      deltaBase: up,
    });
  } else if (!input.manuallyPriced && idle !== null && s.idleDecayHours > 0 && idle >= s.idleDecayHours) {
    const blocks = Math.floor(idle / s.idleDecayHours);
    const down = -toBase(blocks * s.idleDecayEur, s);
    delta += down;
    drivers.push({
      kind: "idle",
      label: `No booking for ${idle}h (${blocks} × ${s.idleDecayHours}h)`,
      deltaBase: down,
    });
  }

  if (input.rating === "low") {
    const down = -toBase(s.lowDemandDecreaseEur, s);
    delta += down;
    drivers.push({ kind: "demand", label: "Graded low demand", deltaBase: down });
  } else if (input.rating === "high") {
    const up = toBase(s.highDemandIncreaseEur, s);
    delta += up;
    drivers.push({ kind: "demand", label: "Graded high demand", deltaBase: up });
  }

  const current = input.currentPrice;
  if (current === null || !Number.isFinite(current)) {
    return {
      currentPrice: null, suggestedPrice: null, deltaBase: delta, drivers,
      burstBookings: bookings, hoursIdle: idle, clampedByMinAdr: false,
    };
  }

  let next = Math.round(current + delta);
  let clamped = false;
  if (s.minAdr !== null && next < s.minAdr) {
    drivers.push({
      kind: "floor",
      label: `Held at your minimum rate of ${Math.round(s.minAdr)}`,
      deltaBase: Math.round(s.minAdr) - next,
    });
    next = Math.round(s.minAdr);
    clamped = true;
  }

  return {
    currentPrice: current,
    suggestedPrice: next,
    deltaBase: next - current,
    drivers,
    burstBookings: bookings,
    hoursIdle: idle,
    clampedByMinAdr: clamped,
  };
}

/** Presets for the bulk editor — plain-language moves, not formulas. */
export interface GroupPreset {
  id: string;
  label: string;
  description: string;
  /** Percentage change, or a flat EUR change; exactly one is set. */
  percent?: number;
  eur?: number;
}

export const GROUP_PRESETS: GroupPreset[] = [
  { id: "high_1", label: "High demand · step 1", description: "Raise prices 5% — the first move on a day that is selling well.", percent: 5 },
  { id: "high_2", label: "High demand · step 2", description: "Raise prices 10% — the day is close to selling out.", percent: 10 },
  { id: "peak", label: "Peak / event", description: "Raise prices 20% for a confirmed event or a sold-out neighbourhood.", percent: 20 },
  { id: "soft", label: "Soft day", description: "Lower prices 5% to unstick a slow date.", percent: -5 },
  { id: "clear", label: "Clear inventory", description: "Lower prices 10% for a date close in with rooms left.", percent: -10 },
  { id: "plus_pickup", label: "Add one pickup step", description: "Add the first pickup step (+11 EUR equivalent) to every selected date.", eur: 11 },
  { id: "plus_pickup_2", label: "Add two pickup steps", description: "Apply the two-booking uplift (+18 EUR equivalent) to every selected date.", eur: 18 },
];

/** Apply a preset to one price. Returns null when there is nothing to change. */
export function applyPreset(
  current: number | null | undefined,
  preset: GroupPreset,
  settings: LadderSettings,
): number | null {
  if (current === null || current === undefined || !Number.isFinite(current)) return null;
  const raw = preset.percent !== undefined
    ? current * (1 + preset.percent / 100)
    : current + toBase(preset.eur ?? 0, settings);
  let next = Math.round(raw);
  if (settings.minAdr !== null && next < settings.minAdr) next = Math.round(settings.minAdr);
  return next > 0 ? next : null;
}
