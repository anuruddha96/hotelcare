// Pace ratchet — commercial planner for Hotel Ottofiori (owner brief, 18 Nov 2026).
//
// What it replaces: the revenue director raised only on a fresh booking and cut
// in flat euros after a quiet window. The data showed the result — the hotel
// filled every night, but ordinary dates sat far above their seasonal level
// for two months, sold nothing, and were then dumped in the last three days.
//
// What it does instead (Ricsi's manual method, written down):
//   • every date has a TIER (normal / high / peak) that sizes its steps;
//   • a booking RAISES the price by a percentage of the price (the ratchet);
//   • quiet hours DECAY it a little, but only while the date is behind its
//     booking curve, never far below the last price that converted, and never
//     under the seasonal base before the free-cancellation deadline;
//   • far-out dates priced well above their seasonal base GLIDE down early so
//     they enter the booking window at a price that can sell;
//   • the last days SELL DOWN in proportion to rooms left versus the pickup
//     still expected, aiming for a couple of unsold rooms at most;
//   • the arrival day DISCOVERS the clearing price: step down through the day,
//     hold the price that converts.
//
// Pure functions only. The planner produces an intent; engineV2Core.decideDate
// remains the final authority for locks, cooldowns, budgets and bounds, and the
// database triggers stay exactly as they are.

import {
  decideDate as coreDecision,
  windowFor,
  type Decision,
  type DecisionInput,
  type DecisionSettings,
  type PaceBand,
  type WindowRule,
} from "./engineV2Core.ts";

export type PaceMode = "off" | "shadow" | "live";
export type PaceTier = "normal" | "high" | "peak";
export type PaceZone = "arrival_day" | "sell_down" | "close_in" | "booking_window" | "far_out";

export interface PaceFieldSpec {
  label: string;
  group: "guardrails" | "raises" | "decay" | "arrival_day" | "tiers";
  min: number;
  max: number;
  def: number;
  integer?: boolean;
  unit?: "EUR" | "%" | "hours" | "minutes" | "days" | "rooms" | "x" | "points" | "hour";
}

/**
 * Every tunable number of the policy, with the range a person (or the
 * assistant) may set it to. Anything outside the range is clamped back, so a
 * bad saved value can never produce an unsafe decision.
 */
export const PACE_POLICY_FIELDS = {
  // --- Guardrails -----------------------------------------------------------
  floor_net_eur: { label: "Lowest banked rate (after OTA discounts, before commission)", group: "guardrails", min: 30, max: 400, def: 65, unit: "EUR" },
  net_rate_factor: { label: "Banked rate as a share of the list price", group: "guardrails", min: 0.5, max: 1, def: 0.75, unit: "x" },
  ceiling_eur: { label: "Highest list price on ordinary dates", group: "guardrails", min: 150, max: 2000, def: 500, unit: "EUR" },
  peak_ceiling_eur: { label: "Highest list price on Peak dates", group: "guardrails", min: 150, max: 3000, def: 900, unit: "EUR" },
  unsold_ok_rooms: { label: "Rooms that may stay unsold at arrival", group: "guardrails", min: 0, max: 5, def: 2, integer: true, unit: "rooms" },
  free_cancel_days: { label: "Free-cancellation deadline before arrival", group: "guardrails", min: 0, max: 30, def: 7, integer: true, unit: "days" },
  sell_down_days: { label: "Final sell-down window", group: "guardrails", min: 1, max: 7, def: 3, integer: true, unit: "days" },
  booking_window_days: { label: "Main booking window ends this many days out", group: "guardrails", min: 10, max: 60, def: 30, integer: true, unit: "days" },
  max_step_eur: { label: "Largest single move", group: "guardrails", min: 5, max: 80, def: 80, integer: true, unit: "EUR" },
  min_step_eur: { label: "Smallest move worth publishing", group: "guardrails", min: 1, max: 10, def: 2, integer: true, unit: "EUR" },
  base_floor_pct: { label: "Lowest price before the cancellation deadline, as a share of the seasonal base", group: "guardrails", min: 50, max: 100, def: 80, unit: "%" },
  selling_start_hour: { label: "Price cuts start at this local hour", group: "guardrails", min: 0, max: 12, def: 7, integer: true, unit: "hour" },
  selling_end_hour: { label: "Price cuts stop at this local hour", group: "guardrails", min: 16, max: 24, def: 22, integer: true, unit: "hour" },
  supervised_factor: { label: "Step size while newly live", group: "guardrails", min: 0.25, max: 1, def: 0.5, unit: "x" },

  // --- Raises (the ratchet) --------------------------------------------------
  raise_pct_normal: { label: "Raise per booking, Normal dates", group: "raises", min: 1, max: 25, def: 7, unit: "%" },
  raise_pct_high: { label: "Raise per booking, High dates", group: "raises", min: 2, max: 40, def: 13, unit: "%" },
  raise_pct_peak: { label: "Raise per booking, Peak dates", group: "raises", min: 5, max: 80, def: 35, unit: "%" },
  raise_min_eur_normal: { label: "Smallest raise, Normal dates", group: "raises", min: 2, max: 40, def: 8, unit: "EUR" },
  raise_min_eur_high: { label: "Smallest raise, High dates", group: "raises", min: 2, max: 60, def: 18, unit: "EUR" },
  raise_min_eur_peak: { label: "Smallest raise, Peak dates", group: "raises", min: 2, max: 80, def: 50, unit: "EUR" },
  raise_max_eur_normal: { label: "Largest raise, Normal dates", group: "raises", min: 5, max: 80, def: 25, unit: "EUR" },
  raise_max_eur_high: { label: "Largest raise, High dates", group: "raises", min: 5, max: 80, def: 45, unit: "EUR" },
  raise_max_eur_peak: { label: "Largest raise, Peak dates", group: "raises", min: 5, max: 80, def: 80, unit: "EUR" },
  raise_day_cap_pct_normal: { label: "Most a Normal date may rise in a day", group: "raises", min: 5, max: 100, def: 20, unit: "%" },
  raise_day_cap_pct_high: { label: "Most a High date may rise in a day", group: "raises", min: 5, max: 150, def: 35, unit: "%" },
  raise_day_cap_pct_peak: { label: "Most a Peak date may rise in a day", group: "raises", min: 5, max: 200, def: 90, unit: "%" },
  second_booking_factor: { label: "Raise multiplier for two bookings together", group: "raises", min: 1, max: 3, def: 1.6, unit: "x" },
  third_booking_factor: { label: "Raise multiplier for three or more bookings together", group: "raises", min: 1, max: 4, def: 2.2, unit: "x" },
  far_raise_factor: { label: "Raise multiplier 31–60 days out", group: "raises", min: 1, max: 2.5, def: 1.3, unit: "x" },
  very_far_raise_factor: { label: "Raise multiplier beyond 60 days out", group: "raises", min: 1, max: 3, def: 1.6, unit: "x" },
  hot_pace_points: { label: "Ahead of the booking curve by this much counts as hot", group: "raises", min: 3, max: 40, def: 10, unit: "points" },
  hot_raise_factor: { label: "Raise multiplier on hot dates", group: "raises", min: 1, max: 2, def: 1.3, unit: "x" },
  cold_pace_points: { label: "Behind the booking curve by this much counts as cold", group: "raises", min: 5, max: 60, def: 15, unit: "points" },
  cold_raise_factor: { label: "Raise multiplier on cold dates", group: "raises", min: 0.25, max: 1, def: 0.5, unit: "x" },
  scarce_rooms: { label: "Rooms left at or below which a raise is larger", group: "raises", min: 1, max: 6, def: 3, integer: true, unit: "rooms" },

  // --- Decay ------------------------------------------------------------------
  quiet_hours_far: { label: "Quiet hours before a cut, beyond the booking window", group: "decay", min: 2, max: 72, def: 12, unit: "hours" },
  quiet_hours_window: { label: "Quiet hours before a cut, in the booking window", group: "decay", min: 1, max: 48, def: 6, unit: "hours" },
  quiet_hours_close: { label: "Quiet hours before a cut, inside the cancellation deadline", group: "decay", min: 1, max: 24, def: 4, unit: "hours" },
  quiet_hours_selldown: { label: "Quiet hours before a cut, final sell-down", group: "decay", min: 1, max: 12, def: 3, unit: "hours" },
  decay_pct_far: { label: "Largest glide step far out", group: "decay", min: 0.5, max: 8, def: 3, unit: "%" },
  decay_pct_window: { label: "Cut per quiet period, booking window", group: "decay", min: 0.5, max: 8, def: 2, unit: "%" },
  decay_pct_close: { label: "Cut per quiet period, inside the cancellation deadline", group: "decay", min: 0.5, max: 10, def: 3, unit: "%" },
  decay_pct_selldown: { label: "Cut per quiet period, final sell-down", group: "decay", min: 0.5, max: 12, def: 3, unit: "%" },
  day_cap_pct_far: { label: "Most a date may fall in a day, far out", group: "decay", min: 1, max: 15, def: 5, unit: "%" },
  day_cap_pct_window: { label: "Most a date may fall in a day, booking window", group: "decay", min: 1, max: 15, def: 5, unit: "%" },
  day_cap_pct_close: { label: "Most a date may fall in a day, inside the cancellation deadline", group: "decay", min: 1, max: 25, def: 10, unit: "%" },
  day_cap_pct_selldown: { label: "Most a date may fall in a day, final sell-down", group: "decay", min: 1, max: 35, def: 15, unit: "%" },
  markdowns_per_day_far: { label: "Cuts per day, far out", group: "decay", min: 1, max: 6, def: 2, integer: true },
  markdowns_per_day_window: { label: "Cuts per day, booking window", group: "decay", min: 1, max: 8, def: 3, integer: true },
  markdowns_per_day_close: { label: "Cuts per day, inside the cancellation deadline", group: "decay", min: 1, max: 8, def: 4, integer: true },
  markdowns_per_day_selldown: { label: "Cuts per day, final sell-down", group: "decay", min: 1, max: 10, def: 4, integer: true },
  pace_tolerance_points: { label: "Behind the booking curve by more than this before any cut", group: "decay", min: 0, max: 30, def: 5, unit: "points" },
  glide_band_pct: { label: "Far-out prices may sit this far above the seasonal base", group: "decay", min: 0, max: 100, def: 15, unit: "%" },
  glide_band_pct_high: { label: "Far-out High dates may sit this far above the seasonal base", group: "decay", min: 0, max: 150, def: 30, unit: "%" },
  glide_target_days_out: { label: "Far-out prices reach their base band by this many days out", group: "decay", min: 14, max: 90, def: 35, integer: true, unit: "days" },
  conv_guard_pct: { label: "Cuts stay within this much of the last price that converted", group: "decay", min: 0, max: 30, def: 5, unit: "%" },
  conv_memory_hours_far: { label: "How long a converting price is remembered, far out", group: "decay", min: 0, max: 720, def: 168, unit: "hours" },
  conv_memory_hours_window: { label: "How long a converting price is remembered, booking window", group: "decay", min: 0, max: 336, def: 72, unit: "hours" },
  conv_memory_hours_close: { label: "How long a converting price is remembered, inside the cancellation deadline", group: "decay", min: 0, max: 96, def: 24, unit: "hours" },

  // --- Arrival day ------------------------------------------------------------
  quiet_minutes_arrival: { label: "Quiet minutes before a cut on the arrival day", group: "arrival_day", min: 30, max: 240, def: 60, integer: true, unit: "minutes" },
  arrival_start_hour: { label: "Arrival-day cuts start at this local hour", group: "arrival_day", min: 5, max: 14, def: 8, integer: true, unit: "hour" },
  arrival_end_hour: { label: "Arrival-day cuts stop at this local hour", group: "arrival_day", min: 16, max: 24, def: 22, integer: true, unit: "hour" },
  arrival_step_pct_morning: { label: "Arrival-day cut before noon", group: "arrival_day", min: 1, max: 10, def: 3, unit: "%" },
  arrival_step_pct_afternoon: { label: "Arrival-day cut from noon to 16:00", group: "arrival_day", min: 1, max: 15, def: 5, unit: "%" },
  arrival_step_pct_evening: { label: "Arrival-day cut after 16:00", group: "arrival_day", min: 1, max: 20, def: 8, unit: "%" },
  day_cap_pct_arrival: { label: "Most the arrival day may fall", group: "arrival_day", min: 5, max: 60, def: 30, unit: "%" },
  markdowns_per_day_arrival: { label: "Cuts on the arrival day", group: "arrival_day", min: 1, max: 14, def: 8, integer: true },
  arrival_lock_hours: { label: "Hours a converting arrival-day price is held", group: "arrival_day", min: 0.5, max: 6, def: 2, unit: "hours" },
  arrival_raise_pct: { label: "Arrival-day raise when bookings keep coming", group: "arrival_day", min: 1, max: 10, def: 3, unit: "%" },

  // --- Tiers --------------------------------------------------------------------
  high_pace_points: { label: "Ahead of the booking curve by this much makes a date High", group: "tiers", min: 5, max: 60, def: 15, unit: "points" },
  high_pace_min_occupancy: { label: "Occupancy needed before pace alone makes a date High", group: "tiers", min: 10, max: 90, def: 40, unit: "%" },
  high_special_ratio: { label: "Sister-hotel price versus their normal that makes a date High", group: "tiers", min: 1.1, max: 3, def: 1.35, unit: "x" },
  peak_special_ratio: { label: "Sister-hotel price versus their normal that flags a Peak candidate", group: "tiers", min: 1.3, max: 5, def: 1.9, unit: "x" },
} as const satisfies Record<string, PaceFieldSpec>;

export type PaceNumericKey = keyof typeof PACE_POLICY_FIELDS;

export type PaceSettings = Record<PaceNumericKey, number> & {
  mode: PaceMode;
  /** ISO timestamp; while it lies in the future every step and cap is scaled down. */
  supervised_until: string | null;
  /** Hotels whose published prices define the seasonal base. */
  sister_hotels: string[];
};

export const PACE_POLICY_DEFAULTS: PaceSettings = (() => {
  const out: Record<string, unknown> = { mode: "off", supervised_until: null, sister_hotels: [] };
  for (const [key, spec] of Object.entries(PACE_POLICY_FIELDS)) out[key] = spec.def;
  return out as unknown as PaceSettings;
})();

const clamp = (value: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, value));
const whole = (value: number): number => Math.round(value);
const round1 = (value: number): number => Math.round(value * 10) / 10;

/** Validate one numeric setting; null when it is not a usable number. */
export function coercePaceField(key: PaceNumericKey, raw: unknown): number | null {
  const spec: PaceFieldSpec = PACE_POLICY_FIELDS[key];
  const value = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const bounded = clamp(value, spec.min, spec.max);
  return spec.integer ? Math.round(bounded) : Math.round(bounded * 1000) / 1000;
}

/** Saved JSON → complete, clamped settings. Unknown keys are ignored. */
export function resolvePaceSettings(raw: unknown): PaceSettings {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const out: PaceSettings = { ...PACE_POLICY_DEFAULTS, sister_hotels: [] };
  for (const key of Object.keys(PACE_POLICY_FIELDS) as PaceNumericKey[]) {
    const value = coercePaceField(key, source[key]);
    if (value != null) out[key] = value;
  }
  const mode = String(source.mode ?? "off");
  out.mode = mode === "live" || mode === "shadow" ? mode : "off";
  const until = typeof source.supervised_until === "string" && Number.isFinite(Date.parse(source.supervised_until))
    ? source.supervised_until
    : null;
  out.supervised_until = until;
  out.sister_hotels = Array.isArray(source.sister_hotels)
    ? source.sister_hotels.filter((v): v is string => typeof v === "string" && /^[a-z0-9-]{2,60}$/.test(v)).slice(0, 8)
    : [];
  // Cross-field sanity: a tier's largest raise is never below its smallest, the
  // sell-down window sits inside the cancellation window, hours are ordered.
  for (const tier of ["normal", "high", "peak"] as const) {
    const minKey = `raise_min_eur_${tier}` as PaceNumericKey;
    const maxKey = `raise_max_eur_${tier}` as PaceNumericKey;
    out[maxKey] = Math.min(out.max_step_eur, Math.max(out[maxKey], out[minKey]));
    out[minKey] = Math.min(out[minKey], out[maxKey]);
  }
  out.peak_ceiling_eur = Math.max(out.peak_ceiling_eur, out.ceiling_eur);
  out.selling_end_hour = Math.max(out.selling_end_hour, out.selling_start_hour + 1);
  out.arrival_end_hour = Math.max(out.arrival_end_hour, out.arrival_start_hour + 1);
  out.booking_window_days = Math.max(out.booking_window_days, out.free_cancel_days + 1, out.sell_down_days + 1);
  return out;
}

/** The cheapest grid cell that still banks the owner's floor after discounts. */
export function paceGridFloor(s: PaceSettings): number {
  return Math.ceil(s.floor_net_eur / clamp(s.net_rate_factor, 0.5, 1) - 1e-9);
}

export function paceZoneFor(daysOut: number, s: PaceSettings): PaceZone {
  const days = Math.max(0, Math.round(Number(daysOut) || 0));
  if (days <= 0) return "arrival_day";
  if (days <= s.sell_down_days) return "sell_down";
  if (days <= Math.max(s.sell_down_days, s.free_cancel_days)) return "close_in";
  if (days <= s.booking_window_days) return "booking_window";
  return "far_out";
}

/** Hours without a booking before this zone may cut a price. */
export function paceQuietHours(zone: PaceZone, s: PaceSettings): number {
  switch (zone) {
    case "arrival_day": return s.quiet_minutes_arrival / 60;
    case "sell_down": return s.quiet_hours_selldown;
    case "close_in": return s.quiet_hours_close;
    case "booking_window": return s.quiet_hours_window;
    default: return s.quiet_hours_far;
  }
}

const ZONE_LABEL: Record<PaceZone, string> = {
  arrival_day: "arrival day",
  sell_down: "final sell-down",
  close_in: "inside the cancellation deadline",
  booking_window: "booking window",
  far_out: "far out",
};

/**
 * Expected occupancy at a lead time, read off the saved pace targets. The
 * targets are bands; a date does not jump 30 points at midnight when it crosses
 * a band edge, so the curve is interpolated between band midpoints.
 */
export function expectedOccupancyPct(daysOut: number, bands: PaceBand[]): number | null {
  const points = (bands ?? [])
    .filter((b) => Number.isFinite(Number(b.min_days_out)) && Number.isFinite(Number(b.max_days_out))
      && Number.isFinite(Number(b.target_occupancy_pct)))
    .map((b) => ({
      x: (Number(b.min_days_out) + Number(b.max_days_out)) / 2,
      y: clamp(Number(b.target_occupancy_pct), 0, 100),
    }))
    .sort((a, b) => a.x - b.x);
  if (points.length === 0) return null;
  const days = Math.max(0, Number(daysOut) || 0);
  if (days <= points[0].x) return round1(points[0].y);
  const last = points[points.length - 1];
  if (days >= last.x) return round1(last.y);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (days <= b.x) {
      const ratio = b.x === a.x ? 0 : (days - a.x) / (b.x - a.x);
      return round1(a.y + (b.y - a.y) * ratio);
    }
  }
  return round1(last.y);
}

// ---------------------------------------------------------------------------
// Tiers
// ---------------------------------------------------------------------------

/**
 * Stadium-scale or citywide demand: a Peak candidate, always flagged for a
 * manager's review. Deliberately narrow — the event feed is written by an AI
 * search and carries wrong dates and look-alike titles ("Mathematical
 * Olympiad", a final played in another country), so a title is never enough
 * on its own (see pacePeakEvent and the corroboration rule in resolvePaceTier).
 */
export const PEAK_EVENT_PATTERN =
  /pusk[aá]s|champions\s+league|uefa|europa\s+league|formula\s*(1|one)\b|\bf1\b|hungarian\s+grand\s+prix|hungaroring|sziget\s+fe(stival|sztiv[aá]l)|szilveszter|new\s+year'?s?\s+eve|world\s+(cup|championships?)|olympic\s+games|olympics\b/i;
/** The city's large indoor arenas: a High date when the event itself is rated high. */
export const ARENA_VENUE_PATTERN =
  /mvm\s*dome|multifunctional\s+sports\s+hall|sportar[eé]na|papp\s+l[aá]szl[oó]|budapest\s+ar[eé]na/i;

export interface PaceEvent {
  title: string | null;
  venue?: string | null;
  expectedImpact?: string | null;
  confidence?: number | null;
  approved?: boolean | null;
  source?: string | null;
}

/** Mojibake or empty titles are not evidence of anything. */
export function paceEventUsable(ev: PaceEvent): boolean {
  const title = String(ev.title ?? "").trim();
  if (title.length < 3 || /[�]/.test(title) || /Ã.|â€|Å¡/.test(title)) return false;
  return ev.approved === true && Number(ev.confidence ?? 0) >= 0.8;
}

/** A usable event that is rated high impact AND is stadium-scale or citywide. */
export function pacePeakEvent(ev: PaceEvent): boolean {
  if (!paceEventUsable(ev)) return false;
  if (String(ev.expectedImpact ?? "").trim().toLowerCase() !== "high") return false;
  return PEAK_EVENT_PATTERN.test(String(ev.title ?? "")) || PEAK_EVENT_PATTERN.test(String(ev.venue ?? ""));
}

/** Normalised title, for spotting the same event entered more than once. */
export function paceEventKey(title: unknown): string {
  return String(title ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/**
 * A person's entry is the truth for its event. The automatic search often
 * files the same event again on other dates (three different weekends for one
 * Grand Prix); when a hand-entered row exists, same-titled automatic rows are
 * dropped.
 */
export function paceCurateEvents<T extends PaceEvent>(events: T[]): T[] {
  const manual = new Set(
    events.filter((ev) => ev.source === "manual").map((ev) => paceEventKey(ev.title)).filter((key) => key.length > 0),
  );
  if (manual.size === 0) return events;
  return events.filter((ev) => ev.source === "manual" || !manual.has(paceEventKey(ev.title)));
}

export interface TierInputs {
  manual?: { tier: PaceTier; status?: string | null; ceilingEur?: number | null } | null;
  events?: PaceEvent[];
  /** Sister hotels' list price for this date ÷ their normal for the month. */
  specialRatio?: number | null;
  occupancyPct: number | null;
  expectedPct: number | null;
  daysOut: number;
}

export interface TierResult {
  tier: PaceTier;
  source: "manual" | "event" | "sister_prices" | "pace" | "default";
  detail: string;
  /** Set when a manager should look at the date (never set for manual tiers). */
  review: { kind: "peak_event" | "peak_prices"; title: string } | null;
  ceilingEur: number | null;
}

/**
 * How valuable is this stay date? A person's tag always wins. Otherwise:
 *   • a stadium-scale or citywide event always asks for a manager's review.
 *     It is treated as PEAK only when something independent agrees — the
 *     sister hotels are priced up for the date, or this hotel's own bookings
 *     run well ahead of the curve. Without that it is treated as HIGH until a
 *     person confirms it: an AI-found event with a wrong date must not be able
 *     to freeze a price at Peak level;
 *   • an arena concert, the sister hotels' own pricing or early bookings well
 *     ahead of the curve make a date High.
 * An event LABEL alone never protects a price that is not selling.
 */
export function resolvePaceTier(input: TierInputs, s: PaceSettings): TierResult {
  const manual = input.manual;
  if (manual && manual.status !== "dismissed" && ["normal", "high", "peak"].includes(manual.tier)
    && manual.status !== "needs_review") {
    const ceiling = Number(manual.ceilingEur);
    return {
      tier: manual.tier,
      source: "manual",
      detail: `Tagged ${manual.tier} by a manager.`,
      review: null,
      ceilingEur: Number.isFinite(ceiling) && ceiling > 0 ? whole(ceiling) : null,
    };
  }
  const dismissed = manual?.status === "dismissed";
  const events = (input.events ?? []).filter(paceEventUsable);
  const ratio = Number(input.specialRatio);
  const ratioKnown = Number.isFinite(ratio) && ratio > 0;
  const occ = input.occupancyPct;
  const expected = input.expectedPct;
  const paceAhead = occ != null && expected != null && input.daysOut > s.free_cancel_days
    && occ >= s.high_pace_min_occupancy && occ - expected >= s.high_pace_points;
  const peakEvent = dismissed ? undefined : events.find(pacePeakEvent);
  if (peakEvent) {
    const title = String(peakEvent.title ?? "").trim();
    const where = peakEvent.venue ? ` (${String(peakEvent.venue).trim()})` : "";
    const sistersAgree = ratioKnown && ratio >= s.high_special_ratio;
    if (sistersAgree || paceAhead) {
      return {
        tier: "peak",
        source: "event",
        detail: `${title}${where}: stadium-scale or citywide demand, backed by ${sistersAgree
          ? `the sister hotels' prices (${round1(ratio)}× their normal)`
          : `bookings (${Math.round(occ!)}% sold against ${Math.round(expected!)}% expected)`}.`,
        review: { kind: "peak_event", title },
        ceilingEur: null,
      };
    }
    return {
      tier: "high",
      source: "event",
      detail: `${title}${where}: possible stadium-scale demand, not yet backed by prices or bookings. Treated as High until a manager confirms it as Peak.`,
      review: { kind: "peak_event", title },
      ceilingEur: null,
    };
  }
  const peakPrices = !dismissed && ratioKnown && ratio >= s.peak_special_ratio;
  if (ratioKnown && ratio >= s.high_special_ratio) {
    return {
      tier: "high",
      source: "sister_prices",
      detail: `The sister hotels are priced ${round1(ratio)}× their normal for this date.`,
      review: peakPrices ? { kind: "peak_prices", title: `Sister hotels priced ${round1(ratio)}× normal` } : null,
      ceilingEur: null,
    };
  }
  const arena = events.find((ev) => ARENA_VENUE_PATTERN.test(String(ev.venue ?? ""))
    && String(ev.expectedImpact ?? "").toLowerCase() === "high");
  if (arena) {
    return {
      tier: "high",
      source: "event",
      detail: `${String(arena.title ?? "").trim()} at ${String(arena.venue ?? "").trim()}.`,
      review: null,
      ceilingEur: null,
    };
  }
  if (paceAhead) {
    return {
      tier: "high",
      source: "pace",
      detail: `${Math.round(occ!)}% sold against ${Math.round(expected!)}% expected ${input.daysOut} days out.`,
      review: null,
      ceilingEur: null,
    };
  }
  return { tier: "normal", source: "default", detail: "No special demand signal.", review: null, ceilingEur: null };
}

// ---------------------------------------------------------------------------
// The planner
// ---------------------------------------------------------------------------

export interface PaceFacts {
  tier: PaceTier;
  tierSource: string;
  /** Seasonal base list price for the two-guest reference cell; null when unknown. */
  basePrice: number | null;
  /** Cheapest and dearest cell of the date column, as currently published. */
  lowestCellPrice: number | null;
  highestCellPrice: number | null;
  /**
   * Cheapest cell among room types that still have a room to sell. A sold-out
   * room type's price cannot be booked, so it never justifies lifting a date —
   * but it still limits how far the date may fall, because every cell of a
   * date moves together. Defaults to the cheapest cell.
   */
  lowestSellableCellPrice?: number | null;
  /** The list price at which this date last took a booking, and when. */
  convertingPrice: number | null;
  convertedAt: string | null;
  /** Unspent genuine bookings first seen inside this zone's quiet window. */
  freshPickup: number | null;
  /** Minutes since local midnight at the property. */
  localMinutes: number;
  sellableRooms: number;
  /** A manager's per-date ceiling; overrides the tier ceiling. */
  dateCeilingEur?: number | null;
  /** Live mode: never plan a cut beyond the saved window cap the database enforces. */
  respectWindowCaps: boolean;
}

export interface PaceTrace {
  tier: PaceTier;
  tierSource: string;
  zone: PaceZone;
  /** What the planner wanted, before the shared safety checks. */
  policyReason: string;
  rawIntent: number;
  basePrice: number | null;
  convertingPrice: number | null;
  expectedPct: number | null;
  paceGap: number | null;
  roomsToSell: number | null;
  expectedRemaining: number | null;
  pressure: number | null;
  gridFloor: number;
  floorRef: number | null;
  ceilingRef: number | null;
  supervised: boolean;
}

export interface PaceDecision extends Decision {
  trace: PaceTrace;
}

const hoursBetween = (iso: string | null | undefined, now: Date): number | null => {
  if (!iso) return null;
  const at = Date.parse(iso);
  return Number.isFinite(at) ? (now.getTime() - at) / 3_600_000 : null;
};

const tierNumber = (s: PaceSettings, prefix: string, tier: PaceTier): number =>
  s[`${prefix}_${tier}` as PaceNumericKey];

/** Whole-euro raise for `bookings` fresh bookings on this date. */
export function paceRaiseStep(args: {
  current: number;
  tier: PaceTier;
  zone: PaceZone;
  bookings: number;
  daysOut: number;
  paceGap: number | null;
  roomsLeft: number;
  supervisedFactor: number;
}, s: PaceSettings): number {
  const { current, tier, zone, bookings, daysOut, paceGap, roomsLeft } = args;
  let eur: number;
  if (zone === "arrival_day") {
    // Tonight's price moves gently: the room is nearly gone, not newly valuable.
    eur = current * s.arrival_raise_pct / 100;
  } else {
    eur = clamp(current * tierNumber(s, "raise_pct", tier) / 100,
      tierNumber(s, "raise_min_eur", tier), tierNumber(s, "raise_max_eur", tier));
    if (daysOut > 60) eur *= s.very_far_raise_factor;
    else if (daysOut > s.booking_window_days) eur *= s.far_raise_factor;
    if (paceGap != null) {
      if (paceGap >= s.hot_pace_points) eur *= s.hot_raise_factor;
      else if (paceGap <= -s.cold_pace_points) eur *= s.cold_raise_factor;
    }
  }
  if (bookings >= 3) eur *= s.third_booking_factor;
  else if (bookings === 2) eur *= s.second_booking_factor;
  if (roomsLeft <= 1) eur *= 1.5;
  else if (roomsLeft <= s.scarce_rooms) eur *= 1.25;
  eur *= args.supervisedFactor;
  return clamp(whole(eur), s.min_step_eur, s.max_step_eur);
}

function supervisedFactorAt(now: Date, s: PaceSettings): number {
  const until = s.supervised_until ? Date.parse(s.supervised_until) : NaN;
  return Number.isFinite(until) && until > now.getTime() ? s.supervised_factor : 1;
}

function zoneDayCapPct(zone: PaceZone, s: PaceSettings): number {
  switch (zone) {
    case "arrival_day": return s.day_cap_pct_arrival;
    case "sell_down": return s.day_cap_pct_selldown;
    case "close_in": return s.day_cap_pct_close;
    case "booking_window": return s.day_cap_pct_window;
    default: return s.day_cap_pct_far;
  }
}

function zoneMarkdownsPerDay(zone: PaceZone, s: PaceSettings): number {
  switch (zone) {
    case "arrival_day": return s.markdowns_per_day_arrival;
    case "sell_down": return s.markdowns_per_day_selldown;
    case "close_in": return s.markdowns_per_day_close;
    case "booking_window": return s.markdowns_per_day_window;
    default: return s.markdowns_per_day_far;
  }
}

function convMemoryHours(zone: PaceZone, s: PaceSettings): number {
  switch (zone) {
    case "far_out": return s.conv_memory_hours_far;
    case "booking_window": return s.conv_memory_hours_window;
    case "close_in": return s.conv_memory_hours_close;
    default: return 0;
  }
}

/** One stay date in, one decision out. */
export function decidePaceRatchet(
  input: DecisionInput,
  core: DecisionSettings,
  s: PaceSettings,
  facts: PaceFacts,
): PaceDecision {
  const now = core.now;
  const zone = paceZoneFor(input.daysOut, s);
  const baseWin = windowFor(input.daysOut, core.windowRules);
  const expected = expectedOccupancyPct(input.daysOut, core.paceBands);
  const expectedFinal = expectedOccupancyPct(0, core.paceBands);
  const occ = input.occupancyPct;
  const gap = expected != null && occ != null ? round1(occ - expected) : null;
  const gridFloor = paceGridFloor(s);
  const sup = supervisedFactorAt(now, s);
  const tier = facts.tier;
  const basePrice = facts.basePrice != null && Number.isFinite(facts.basePrice) && facts.basePrice > 0
    ? whole(facts.basePrice)
    : null;

  const trace: PaceTrace = {
    tier, tierSource: facts.tierSource, zone, policyReason: "hold", rawIntent: 0,
    basePrice, convertingPrice: facts.convertingPrice ?? null,
    expectedPct: expected, paceGap: gap,
    roomsToSell: null, expectedRemaining: null, pressure: null,
    gridFloor, floorRef: null, ceilingRef: null, supervised: sup < 1,
  };
  const hold = (reason: string, detail: string): PaceDecision => ({
    stayDate: input.stayDate, daysOut: input.daysOut, windowId: baseWin.id,
    direction: "hold", movement: 0, currentPrice: input.currentPrice, targetPrice: input.currentPrice,
    paceTargetPct: expected, paceGapPct: gap, reason, reasonDetail: detail, capApplied: null, blocked: true,
    trace: { ...trace, policyReason: reason },
  });

  if (input.holdKind === "hard" && input.manualHoldUntil && Date.parse(input.manualHoldUntil) > now.getTime()) {
    return hold("manual_lock", "A manager locked this date; no automatic changes are permitted.");
  }
  if (input.dataStale) return hold("stale_data", "The PMS feed is stale; no price may change.");
  // A sold-out date has no room type on sale and therefore no reference price:
  // say "sold out", not "no price".
  if (occ != null && input.roomsRemaining != null
    && (Math.round(input.roomsRemaining) <= 0 || occ >= core.soldOutOccupancyPct)) {
    return hold("sold_out", "The date is sold out; the closing price stays.");
  }
  if (input.currentPrice == null || !(input.currentPrice > 0)) {
    return hold("no_price", "No current price on file for this date.");
  }
  if (occ == null || input.roomsRemaining == null) {
    return hold("no_occupancy", "Fresh occupancy and remaining-room evidence are required.");
  }
  const current = whole(input.currentPrice);
  const left = Math.max(0, Math.round(input.roomsRemaining));

  // --- Bounds, expressed for the reference cell -------------------------------
  // Every cell of the date moves by the same amount, so the date can fall only
  // until its CHEAPEST cell reaches the floor and rise only until its DEAREST
  // cell reaches the ceiling.
  const cellCeiling = whole(Number(facts.dateCeilingEur) > 0
    ? Number(facts.dateCeilingEur)
    : tier === "peak" ? s.peak_ceiling_eur : s.ceiling_eur);
  const lowest = whole(Number(facts.lowestCellPrice) > 0 ? Number(facts.lowestCellPrice) : current);
  const highest = whole(Number(facts.highestCellPrice) > 0 ? Number(facts.highestCellPrice) : current);
  const lowestSellable = Math.max(lowest, whole(Number(facts.lowestSellableCellPrice) > 0
    ? Number(facts.lowestSellableCellPrice)
    : lowest));
  const maxDrop = Math.max(0, lowest - gridFloor);
  const maxRise = Math.max(0, cellCeiling - highest);
  const floorRef = current - maxDrop;
  const ceilingRef = current + maxRise;
  trace.floorRef = floorRef;
  trace.ceilingRef = ceilingRef;

  // --- Demand facts ---------------------------------------------------------------
  const quiet = paceQuietHours(zone, s);
  const hoursQuiet = input.hoursSinceLastPickup;
  const waited = hoursQuiet == null || hoursQuiet >= quiet;
  const netUnspent = Math.max(0, input.pickup24h - input.cancellations24h);
  const fresh = facts.freshPickup != null
    ? Math.max(0, facts.freshPickup)
    : (hoursQuiet != null && hoursQuiet < Math.max(quiet, 1) ? netUnspent : 0);
  const pickup = Math.min(netUnspent, fresh);

  const need = Math.max(0, left - s.unsold_ok_rooms);
  const expectedRemaining = expected != null && expectedFinal != null
    ? round1(Math.max(0, (expectedFinal - expected) / 100 * Math.max(1, facts.sellableRooms)))
    : null;
  const pressure = round1(need - (expectedRemaining ?? 0));
  trace.roomsToSell = need;
  trace.expectedRemaining = expectedRemaining;
  trace.pressure = pressure;

  const minute = clamp(Math.round(Number(facts.localMinutes) || 0), 0, 1439);
  const paceText = expected == null ? "no pace target" : `${Math.round(occ)}% sold against ${Math.round(expected)}% expected`;

  let raw = 0;
  let reason = "hold";
  let detail = "";
  let softFloor = floorRef;
  let softFloorWhy: "price_floor" | "base_floor" | "converting_price_guard" = "price_floor";

  if (lowestSellable < gridFloor) {
    // The owner's floor is a guardrail, not a demand signal: a date with a
    // bookable price under it is lifted back whatever the booking story says.
    raw = Math.min(gridFloor - lowestSellable, s.max_step_eur);
    reason = "net_floor_lift";
    detail = `The cheapest bookable price of this date (€${lowestSellable}) banks less than the €${s.floor_net_eur} floor after OTA discounts; lifting the date by €${raw} to the €${gridFloor} list floor.`;
  } else if (pickup > 0) {
    const stillSelling = (zone === "arrival_day" || zone === "sell_down") && pressure > 0 && left > s.unsold_ok_rooms;
    if (stillSelling && !(zone === "arrival_day" && pickup >= 2)) {
      // The price just converted and rooms still have to go: that IS the
      // clearing price. Hold it; do not chase it up or cut under it.
      return hold(
        "converting_price_lock",
        `A booking just converted at €${current} with ${left} rooms still to sell (${need} above the ${s.unsold_ok_rooms}-room tolerance). Holding this price while it is working.`,
      );
    }
    raw = paceRaiseStep({
      current, tier, zone, bookings: pickup, daysOut: input.daysOut, paceGap: gap,
      roomsLeft: left, supervisedFactor: sup,
    }, s);
    reason = "pickup_ratchet";
    const pct = Math.round((raw / current) * 1000) / 10;
    detail = `${pickup} new booking${pickup === 1 ? "" : "s"} at €${current}, ${left} room${left === 1 ? "" : "s"} left, ${paceText}: raising €${raw} (${pct}%) on a ${tier} date.`;
  } else {
    // --- No fresh booking: is a cut justified? -----------------------------------
    if (left <= s.unsold_ok_rooms) {
      return hold("last_rooms_hold", `${left} room${left === 1 ? "" : "s"} left, within the ${s.unsold_ok_rooms}-room tolerance: the last rooms keep their price.`);
    }
    const startHour = zone === "arrival_day" ? s.arrival_start_hour : s.selling_start_hour;
    const endHour = zone === "arrival_day" ? s.arrival_end_hour : s.selling_end_hour;
    if (minute < startHour * 60 || minute >= endHour * 60) {
      return hold("outside_selling_hours", `Automatic cuts run from ${String(startHour).padStart(2, "0")}:00 to ${String(endHour).padStart(2, "0")}:00 local time.`);
    }
    if (zone === "arrival_day" && hoursQuiet != null && hoursQuiet < s.arrival_lock_hours) {
      return hold("converting_price_lock", `A booking converted ${Math.round(hoursQuiet * 60)} minutes ago; this price is held for ${s.arrival_lock_hours} hours.`);
    }
    if (!waited) {
      return hold("awaiting_quiet_window", `A booking arrived ${Math.round((hoursQuiet ?? 0) * 10) / 10}h ago; this zone waits ${round1(quiet)}h without a booking before any cut.`);
    }
    if (tier === "peak" && input.daysOut > s.sell_down_days) {
      return hold("peak_review_hold", "Peak date: automation raises it on bookings but leaves any reduction to the manager until the final sell-down window.");
    }

    let pct = 0;
    switch (zone) {
      case "arrival_day": {
        pct = minute < 12 * 60 ? s.arrival_step_pct_morning
          : minute < 16 * 60 ? s.arrival_step_pct_afternoon
          : s.arrival_step_pct_evening;
        // One room over the tolerance, or the first step after a held price:
        // start with the gentlest step.
        if (need <= 1 || (hoursQuiet != null && hoursQuiet < s.arrival_lock_hours + 2 * quiet)) {
          pct = Math.min(pct, s.arrival_step_pct_morning);
        }
        reason = "arrival_day_discovery";
        detail = `Arrival today, ${left} rooms unsold (${need} above tolerance) and no booking for ${hoursQuiet == null ? "the day" : `${round1(hoursQuiet)}h`}: testing ${pct}% lower.`;
        break;
      }
      case "sell_down": {
        if (pressure <= 0) {
          return hold("sell_down_on_track", `${left} rooms left ${input.daysOut} day${input.daysOut === 1 ? "" : "s"} out; about ${expectedRemaining ?? 0} are expected to sell anyway, leaving ${s.unsold_ok_rooms} or fewer. No cut needed.`);
        }
        const base = s.decay_pct_selldown;
        pct = pressure <= 1 ? Math.max(1, base - 1) : pressure <= 3 ? base : pressure <= 6 ? base + 2 : base + 4;
        reason = "sell_down";
        detail = `${left} rooms left ${input.daysOut} day${input.daysOut === 1 ? "" : "s"} out; ${need} must still sell and only about ${expectedRemaining ?? 0} are expected at this price. No booking for ${hoursQuiet == null ? "days" : `${round1(hoursQuiet)}h`}: ${pct}% lower.`;
        break;
      }
      case "close_in": {
        if (gap == null) return hold("no_pace_data", "No pace target for this lead time.");
        if (gap >= -s.pace_tolerance_points) {
          return hold("on_pace", `${paceText} ${input.daysOut} days out: on pace, the price holds.`);
        }
        const base = s.decay_pct_close;
        pct = gap > -15 ? Math.max(1, base - 1) : gap > -30 ? base : base + 1;
        reason = "pace_decay";
        detail = `${paceText} ${input.daysOut} days out and no booking for ${hoursQuiet == null ? "days" : `${round1(hoursQuiet)}h`}: ${pct}% lower.`;
        break;
      }
      case "booking_window": {
        if (gap == null) return hold("no_pace_data", "No pace target for this lead time.");
        if (gap > s.pace_tolerance_points) {
          return hold("ahead_of_pace", `${paceText} ${input.daysOut} days out: ahead of pace, the price is working.`);
        }
        if (gap >= -s.pace_tolerance_points) {
          return hold("on_pace", `${paceText} ${input.daysOut} days out: on pace, the price holds.`);
        }
        pct = s.decay_pct_window + (gap <= -20 ? 1 : 0);
        reason = "pace_decay";
        detail = `${paceText} ${input.daysOut} days out and no booking for ${hoursQuiet == null ? "days" : `${round1(hoursQuiet)}h`}: ${pct}% lower.`;
        break;
      }
      default: {
        if (basePrice == null) {
          return hold("no_seasonal_base", "No seasonal base price for this date yet; far-out prices are left alone.");
        }
        if (gap != null && gap > s.pace_tolerance_points) {
          return hold("ahead_of_pace", `${paceText} ${input.daysOut} days out: ahead of pace, the price is working.`);
        }
        // A High date (arena concert, sister hotels priced up) may keep a bigger premium.
        const bandPct = tier === "high" ? Math.max(s.glide_band_pct, s.glide_band_pct_high) : s.glide_band_pct;
        const bandHigh = whole(basePrice * (1 + bandPct / 100));
        if (current <= bandHigh) {
          return hold("at_seasonal_base", `€${current} is within the seasonal band (base €${basePrice}, up to €${bandHigh}) ${input.daysOut} days out.`);
        }
        const daysToTarget = Math.max(1, input.daysOut - s.glide_target_days_out);
        const perMove = (current - bandHigh) / daysToTarget / Math.max(1, s.markdowns_per_day_far);
        const largest = Math.max(s.min_step_eur, whole(current * s.decay_pct_far / 100));
        const step = clamp(Math.ceil(perMove), s.min_step_eur, largest);
        softFloor = Math.max(softFloor, bandHigh);
        softFloorWhy = softFloor === bandHigh ? "base_floor" : softFloorWhy;
        pct = (step / current) * 100;
        reason = "far_out_glide";
        detail = `€${current} is above the seasonal band (base €${basePrice}, up to €${bandHigh}) with ${paceText} ${input.daysOut} days out and no booking for ${hoursQuiet == null ? "a week or more" : `${round1(hoursQuiet)}h`}: gliding down so the date enters the booking window at a price that can sell.`;
        break;
      }
    }

    // Soft floors that apply BEFORE the free-cancellation deadline.
    if ((zone === "booking_window" || zone === "far_out") && basePrice != null) {
      const baseFloor = whole(basePrice * s.base_floor_pct / 100);
      if (baseFloor > softFloor) { softFloor = baseFloor; softFloorWhy = "base_floor"; }
    }
    const memory = convMemoryHours(zone, s);
    const sinceConversion = hoursBetween(facts.convertedAt, now);
    if (memory > 0 && facts.convertingPrice != null && facts.convertingPrice > 0
      && sinceConversion != null && sinceConversion >= 0 && sinceConversion < memory) {
      const guard = whole(facts.convertingPrice * (1 - s.conv_guard_pct / 100));
      if (guard > softFloor) { softFloor = guard; softFloorWhy = "converting_price_guard"; }
    }

    const wanted = clamp(whole(current * pct / 100 * sup), s.min_step_eur, s.max_step_eur);
    const room = current - softFloor;
    if (room < s.min_step_eur) {
      if (softFloorWhy === "price_floor" && lowest < lowestSellable) {
        // Every cell of a date moves together, so one sold-out room type sitting
        // at the floor stops the whole date. Only a person can change the gap
        // between room types.
        return hold(
          "floor_pinned",
          `Held: a room type with nothing left to sell is priced at €${lowest} on this date, at the €${gridFloor} list floor. All prices of a date move together, so the date cannot go lower until that room type's price is raised by hand (the cheapest bookable price is €${lowestSellable}).`,
        );
      }
      const why = softFloorWhy === "converting_price_guard"
        ? `Held near the last price that converted (€${facts.convertingPrice}); cuts stay within ${s.conv_guard_pct}% of it for ${memory}h.`
        : softFloorWhy === "base_floor"
          ? `Held: €${current} is at the lowest price allowed before the cancellation deadline for this date (seasonal base €${basePrice}).`
          : `Held at the floor: the cheapest price of this date already banks about €${s.floor_net_eur} after OTA discounts.`;
      return hold(softFloorWhy, why);
    }
    raw = -Math.min(wanted, room);
  }

  trace.rawIntent = raw;
  trace.policyReason = reason;

  // --- Hand the intent to the shared safety core -------------------------------
  const capDownPolicy = Math.max(s.min_step_eur, whole(current * zoneDayCapPct(zone, s) / 100 * sup));
  const capDown = facts.respectWindowCaps
    ? Math.min(capDownPolicy, Math.max(0, Number(baseWin.max_daily_decrease) || 0))
    : capDownPolicy;
  const capUp = Math.max(
    raw > 0 ? raw : 0,
    whole(current * tierNumber(s, "raise_day_cap_pct", tier) / 100 * sup),
  );
  const markdownsZone = zoneMarkdownsPerDay(zone, s);
  const markdownLimit = facts.respectWindowCaps && (core.maxMarkdownsPerDay ?? 0) > 0
    ? Math.min(markdownsZone, core.maxMarkdownsPerDay ?? markdownsZone)
    : markdownsZone;

  const policyWindow: WindowRule = {
    ...baseWin,
    min_days_out: input.daysOut,
    max_days_out: input.daysOut,
    no_pickup_wait_hours: quiet,
    min_hours_between_decreases: quiet,
    max_daily_decrease: capDown,
    max_daily_increase: capUp,
    require_above_anchor: false,
  };
  const policyCore: DecisionSettings = {
    ...core,
    respectConfiguredWindows: true,
    windowRules: [policyWindow, ...core.windowRules],
    fill: { enabled: false, windowDays: 0, maxTotalDropPct: 0 },
    occupancyLiftEnabled: false,
    microPriceTests: false,
    allowSameDayReversal: true,
    minMovementEur: s.min_step_eur,
    maxMarkdownsPerDay: markdownLimit,
    maxMarkdownDepthPct: 0,
    bookedDateBrakeHours: quiet,
    rebookWindowHours: Math.min(core.rebookWindowHours ?? 4, input.daysOut <= s.free_cancel_days ? 2 : 4),
    directionChangeHours: zone === "arrival_day"
      ? Math.min(core.directionChangeHours, s.arrival_lock_hours)
      : core.directionChangeHours,
  };
  const effective: DecisionInput = {
    ...input,
    currentPrice: current,
    minPrice: raw < 0 ? Math.min(current, softFloor) : Math.min(current, floorRef),
    maxPrice: Math.max(current, ceilingRef),
    adrFloor: null,
    hardAdrFloor: null,
    monthFloor: null,
    monthMarkdownsFrozen: false,
    pendingEventUplift: 0,
    campaignStartPrice: null,
    recentPeakPrice: null,
    // A booking at this price is better evidence than a thin competitor scan.
    market: { median: null, sampleSize: 0, ageHours: null },
    commercialIntent: { raw, reason, detail },
  };

  const decision = coreDecision(effective, policyCore);
  const label = `[Pace ratchet · ${tier} · ${ZONE_LABEL[zone]}]`;
  if (!decision.blocked) {
    // Published moves keep the director's reason names: the database trigger
    // and the publication guard recognise exactly these.
    const moved = decision.movement;
    decision.reason = decision.direction === "increase" ? "revenue_director_yield" : "revenue_director_fill";
    const adjusted = moved !== raw
      ? ` Limited to €${Math.abs(moved)} by today's allowance or the price limits.`
      : "";
    decision.reasonDetail = `${label} ${detail}${adjusted}${sup < 1 ? " Half-size step while newly live." : ""}`;
  } else {
    decision.reasonDetail = `${label} ${decision.reasonDetail}`;
  }
  decision.paceTargetPct = expected;
  decision.paceGapPct = gap;
  return { ...decision, trace: { ...trace, policyReason: reason, rawIntent: raw } };
}

/** Budapest (or any zone) minutes since local midnight. */
export function localMinutesAt(now: Date, timeZone = "Europe/Budapest"): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const at = (name: string) => Number(parts.find((part) => part.type === name)?.value ?? 0);
  return at("hour") * 60 + at("minute");
}
