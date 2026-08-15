// Pure decision rules for the hourly price automation.
//
// Deliberately dependency-free so the Deno edge function and the browser test
// suite run the *same* code. Nothing here touches the network or the database:
// every function takes plain values and returns plain values.

/** Money is rounded to cents, never to whole currency units. €0.50 stays €0.50. */
export function roundMoney(value: number): number {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

/** Queue priority. Lower number = published first. */
export const PUSH_PRIORITY = {
  manual: 10,
  pickup: 20,
  reconcile: 30,
  markdown: 40,
} as const;

export type PushPriority = keyof typeof PUSH_PRIORITY;

export function priorityOf(source: string | null | undefined): number {
  const key = String(source ?? "") as PushPriority;
  return PUSH_PRIORITY[key] ?? 50;
}

/** Work order for the publisher: priority first, then oldest request. */
export function sortPushQueue<T extends { priority?: number | null; created_at?: string | null }>(runs: T[]): T[] {
  return [...runs].sort((a, b) => {
    const pa = Number(a.priority ?? 50);
    const pb = Number(b.priority ?? 50);
    if (pa !== pb) return pa - pb;
    return String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""));
  });
}

// --------------------------------------------------------------------------
// Scheduling
// --------------------------------------------------------------------------

export interface SchedulableRule {
  hotel_id: string;
  is_enabled: boolean;
  next_run_at: string | null;
  last_evaluated_at?: string | null;
  evaluation_interval_minutes: number;
}

/**
 * Exactly ONE hotel is evaluated per cycle. Mirrors `claim_due_automation_rule`
 * so the behaviour can be asserted without a database.
 */
export function pickDueRule<T extends SchedulableRule>(rules: T[], now: Date): T | null {
  const due = rules.filter((r) => r.is_enabled && (!r.next_run_at || Date.parse(r.next_run_at) <= now.getTime()));
  if (due.length === 0) return null;
  due.sort((a, b) => {
    const ta = a.next_run_at ? Date.parse(a.next_run_at) : -Infinity;
    const tb = b.next_run_at ? Date.parse(b.next_run_at) : -Infinity;
    if (ta !== tb) return ta - tb;
    const la = a.last_evaluated_at ? Date.parse(a.last_evaluated_at) : -Infinity;
    const lb = b.last_evaluated_at ? Date.parse(b.last_evaluated_at) : -Infinity;
    return la - lb;
  });
  return due[0];
}

/**
 * The next due time is always measured from NOW, never from the missed slot.
 * That is what stops five hours of downtime replaying five markdowns.
 */
export function nextRunAt(now: Date, intervalMinutes: number): string {
  const minutes = Math.min(1440, Math.max(60, Math.round(Number(intervalMinutes) || 60)));
  return new Date(now.getTime() + minutes * 60_000).toISOString();
}

/**
 * Observation window for one evaluation: since the previous *successful*
 * evaluation, so a late scheduler still sees the bookings it missed. Bounded so
 * a long outage cannot turn into an enormous read.
 */
export function observationWindow(
  now: Date,
  lastSuccessAt: string | null | undefined,
  intervalMinutes: number,
  maxHours = 6,
): { from: string; to: string } {
  const interval = Math.max(60, Number(intervalMinutes) || 60);
  const floorMs = now.getTime() - maxHours * 3_600_000;
  const defaultMs = now.getTime() - interval * 60_000;
  const lastMs = lastSuccessAt ? Date.parse(lastSuccessAt) : NaN;
  const startMs = Number.isFinite(lastMs) ? Math.max(floorMs, Math.min(lastMs, defaultMs)) : defaultMs;
  return { from: new Date(startMs).toISOString(), to: now.toISOString() };
}

// --------------------------------------------------------------------------
// No-pickup markdown
// --------------------------------------------------------------------------

export interface MarkdownGuards {
  /** Positive pickup happened for this stay date in the same evaluation. */
  hadPickup: boolean;
  /** Rooms left for sale; 0 means sold out. */
  roomsAvailable?: number | null;
  occupancyPct?: number | null;
  protectHighOccupancy: boolean;
  markdownMaxOccupancyPct: number;
  /** When a human last changed a price for this stay date. */
  lastManualEditAt?: string | null;
  manualHoldHours: number;
  now: Date;
}

export type MarkdownBlock =
  | "pickup"
  | "sold_out"
  | "high_occupancy"
  | "manual_hold"
  | null;

/** Why (if at all) this stay date must not be marked down right now. */
export function markdownBlockReason(guards: MarkdownGuards): MarkdownBlock {
  if (guards.hadPickup) return "pickup";
  if (guards.roomsAvailable !== null && guards.roomsAvailable !== undefined && Number(guards.roomsAvailable) <= 0) {
    return "sold_out";
  }
  if (
    guards.protectHighOccupancy &&
    guards.occupancyPct !== null && guards.occupancyPct !== undefined &&
    Number(guards.occupancyPct) >= Number(guards.markdownMaxOccupancyPct)
  ) {
    return "high_occupancy";
  }
  if (guards.lastManualEditAt) {
    const holdMs = Math.max(0, Number(guards.manualHoldHours) || 0) * 3_600_000;
    const editedMs = Date.parse(guards.lastManualEditAt);
    if (Number.isFinite(editedMs) && guards.now.getTime() - editedMs < holdMs) return "manual_hold";
  }
  return null;
}

export interface MarkdownInput {
  /** Latest INTENDED price for the cell (a pending target beats the PMS mirror). */
  effectivePrice: number;
  decreasePerEvaluation: number;
  floorPrice: number | null;
  /** How far this STAY DATE already moved down today, in currency. */
  stayDateMovedToday: number;
  maxDailyDecreasePerDate: number;
}

export interface MarkdownResult {
  newPrice: number;
  applied: number;
}

/**
 * How much this STAY DATE may move down in the current evaluation. Computed
 * once per date from the movement recorded BEFORE this evaluation, then applied
 * to every eligible cell of that date. One evaluation therefore consumes one
 * step of the daily cap no matter how many room-type × occupancy cells move.
 */
export function dateAllowedStep(input: {
  decreasePerEvaluation: number;
  stayDateMovedToday: number;
  maxDailyDecreasePerDate: number;
}): number {
  const step = roundMoney(Math.max(0, Number(input.decreasePerEvaluation) || 0));
  if (step <= 0) return 0;
  const cap = Number(input.maxDailyDecreasePerDate);
  if (!Number.isFinite(cap) || cap <= 0) return step;
  const remaining = roundMoney(cap - Math.max(0, Number(input.stayDateMovedToday) || 0));
  if (remaining <= 0) return 0;
  return Math.min(step, remaining);
}

/**
 * One markdown step for one price cell. `stayDateMovedToday` must reflect the
 * state at the START of the evaluation — the caller must NOT add this cell's
 * movement back into it, otherwise a date with 20 cells would burn its whole
 * daily cap in a single evaluation.
 */
export function computeMarkdown(input: MarkdownInput): MarkdownResult | null {
  const current = Number(input.effectivePrice);
  if (!Number.isFinite(current) || current <= 0) return null;

  const wanted = dateAllowedStep({
    decreasePerEvaluation: input.decreasePerEvaluation,
    stayDateMovedToday: input.stayDateMovedToday,
    maxDailyDecreasePerDate: input.maxDailyDecreasePerDate,
  });
  if (wanted <= 0) return null;

  const floor = input.floorPrice === null || input.floorPrice === undefined ? null : Number(input.floorPrice);
  let target = roundMoney(current - wanted);
  if (floor !== null && Number.isFinite(floor)) {
    if (current <= floor) return null;          // already at or under the floor
    if (target < floor) target = roundMoney(floor);
  }
  if (target >= current) return null;
  return { newPrice: target, applied: roundMoney(current - target) };
}

/**
 * Net pickup per stay date for one observation window: brand-new booking nights
 * minus cancellations. A cancellation can only push a date to zero or below —
 * it can never create an increase.
 */
export function netPickupByDate(
  bookings: Array<{ stay_date: string }>,
  cancellations: Array<{ stay_date: string }>,
): Map<string, number> {
  const net = new Map<string, number>();
  for (const row of bookings) net.set(row.stay_date, (net.get(row.stay_date) ?? 0) + 1);
  for (const row of cancellations) net.set(row.stay_date, (net.get(row.stay_date) ?? 0) - 1);
  return net;
}


// --------------------------------------------------------------------------
// Durable intent / coalescing
// --------------------------------------------------------------------------

export interface CellIntent {
  id?: string;
  cellKey: string;
  new_price: number;
  old_price: number | null;
  /** Sent/claimed intents belong to the publisher and must not be mutated. */
  claimed: boolean;
  created_at: string;
  source?: string | null;
}

export interface CoalesceOutcome<T extends CellIntent> {
  /** Intents that should actually be written/delivered. */
  deliver: T[];
  /** Existing unsent intents that the new target replaces (mark superseded). */
  supersede: T[];
}

/**
 * For one cell, only the newest UNSENT target is worth a Previo call. Older
 * unsent intents are superseded (kept for history, never deleted). Anything the
 * publisher already claimed is left alone; the new target simply queues behind it.
 */
export function coalesceIntents<T extends CellIntent>(existing: T[], incoming: T[]): CoalesceOutcome<T> {
  const supersede: T[] = [];
  const byCell = new Map<string, T>();

  for (const intent of [...existing, ...incoming].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    if (intent.claimed) continue; // owned by the publisher
    const previous = byCell.get(intent.cellKey);
    if (previous) supersede.push(previous);
    byCell.set(intent.cellKey, intent);
  }

  // Only newly created targets need delivering; a surviving older row that was
  // already queued keeps its place.
  const deliver = Array.from(byCell.values());
  return { deliver, supersede };
}

/**
 * Latest intended price for a cell: a pending (unsent or in-flight) target wins
 * over the PMS mirror, so an hourly decision never recomputes from a stale price.
 */
export function effectivePrice(
  mirrorPrice: number | null | undefined,
  pendingTargets: Array<{ new_price: number; created_at: string }>,
): number | null {
  if (pendingTargets.length > 0) {
    const newest = [...pendingTargets].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    const value = Number(newest.new_price);
    if (Number.isFinite(value) && value > 0) return value;
  }
  const mirror = Number(mirrorPrice);
  return Number.isFinite(mirror) && mirror > 0 ? mirror : null;
}

/** Human-readable maximum daily markdown implied by cadence × step. */
export function maxDailyMarkdown(intervalMinutes: number, decreasePerEvaluation: number): number {
  const evaluationsPerDay = Math.max(1, Math.floor(1440 / Math.max(60, Number(intervalMinutes) || 60)));
  return roundMoney(evaluationsPerDay * Math.max(0, Number(decreasePerEvaluation) || 0));
}

// --------------------------------------------------------------------------
// Smart pricing (occupancy + lead time)
// --------------------------------------------------------------------------

export interface SmartWindow {
  occupancyPct: number | null | undefined;
  daysOut: number;
  nearTermDays: number;
  lowOccupancyPct: number;
}

/**
 * Smart mode only marks down genuinely weak demand: a date whose occupancy is
 * still below the "weak" threshold. Near-term weak dates are the classic case;
 * a date with no occupancy reading at all is treated as unknown and may still
 * move, exactly as before smart mode existed.
 */
export function smartMarkdownAllowed(input: SmartWindow): boolean {
  const occ = input.occupancyPct;
  if (occ === null || occ === undefined) return true;
  if (Number(occ) < Number(input.lowOccupancyPct)) return true;
  return false;
}

export interface StrongDemandInput {
  occupancyPct: number | null | undefined;
  daysOut: number;
  longLeadDays: number;
  highOccupancyPct: number;
  increase: number;
  maximumIncrease?: number | null;
  raisedToday: number;
  maxDailyIncreasePerDate: number;
  markedDownToday: boolean;
}

/**
 * A far-out date that is already filling up may rise even in an hour with no
 * new booking. Returns the currency amount allowed right now — 0 means "leave
 * it alone".
 */
export function strongDemandStep(input: StrongDemandInput): number {
  if (input.markedDownToday) return 0;
  const occ = input.occupancyPct;
  if (occ === null || occ === undefined) return 0;
  if (Number(occ) < Number(input.highOccupancyPct)) return 0;
  if (Number(input.daysOut) <= Number(input.longLeadDays)) return 0;
  let step = roundMoney(Math.max(0, Number(input.increase) || 0));
  if (step <= 0) return 0;
  if (input.maximumIncrease) step = Math.min(step, Number(input.maximumIncrease));
  const room = roundMoney(Number(input.maxDailyIncreasePerDate || 0) - Math.max(0, Number(input.raisedToday) || 0));
  return Math.max(0, Math.min(step, room));
}

/** An advisor may only confirm or soften a move: factor is clamped to 0..1. */
export function clampAiFactor(value: unknown): number {
  const factor = Number(value);
  if (!Number.isFinite(factor)) return 1;
  return Math.max(0, Math.min(1, factor));
}

// --------------------------------------------------------------------------
// Whole-number prices
// --------------------------------------------------------------------------

/**
 * Previo (and every OTA behind it) is far easier to read with whole prices, so
 * automation never sends cents. Direction matters: a markdown rounds DOWN so it
 * can never round itself back up, an increase rounds UP so it never lands under
 * the intended step, and the ADR floor is still respected afterwards.
 */
export function roundWholePrice(
  value: number,
  direction: "increase" | "decrease",
  floorPrice?: number | null,
): number {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return raw;
  let out = direction === "increase" ? Math.ceil(raw - 1e-9) : Math.floor(raw + 1e-9);
  const floor = floorPrice === null || floorPrice === undefined ? null : Number(floorPrice);
  if (floor !== null && Number.isFinite(floor) && out < floor) out = Math.ceil(floor - 1e-9);
  return out;
}

/** Whole units when the property asked for it, cents otherwise. */
export function applyRounding(
  value: number,
  direction: "increase" | "decrease",
  wholeNumbers: boolean,
  floorPrice?: number | null,
): number {
  return wholeNumbers ? roundWholePrice(value, direction, floorPrice) : roundMoney(value);
}

// --------------------------------------------------------------------------
// Short booking window guard
// --------------------------------------------------------------------------

export interface ShortWindowInput {
  daysOut: number;
  occupancyPct: number | null | undefined;
  /** Guard switched on for this property. */
  enabled: boolean;
  /** How many days before arrival count as "short window". */
  shortWindowDays: number;
  /** Occupancy needed before a near-arrival price may rise at all. */
  minOccupancyPct: number;
}

/**
 * Close to arrival, an empty hotel must not price itself out of the market just
 * because one booking arrived. Inside the protected window a rise is only
 * allowed when the date is already selling well; below that the pickup is still
 * recorded but the price is held (and the markdown side may still lower it).
 *
 * Dates outside the window, and dates with no occupancy reading at all, behave
 * exactly as before the guard existed.
 */
export function shortWindowIncreaseAllowed(input: ShortWindowInput): boolean {
  if (!input.enabled) return true;
  const days = Number(input.daysOut);
  if (!Number.isFinite(days) || days > Math.max(0, Number(input.shortWindowDays) || 0)) return true;
  const occ = input.occupancyPct;
  if (occ === null || occ === undefined) return false; // unknown demand close in: stay safe
  return Number(occ) >= Number(input.minOccupancyPct);
}
