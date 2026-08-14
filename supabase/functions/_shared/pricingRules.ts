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
 * One markdown step for one price cell. The daily cap is consumed by the STAY
 * DATE, not by each room type × occupancy row, so a property with 40 rate cells
 * does not exhaust its cap on the first cell of the first evaluation.
 */
export function computeMarkdown(input: MarkdownInput): MarkdownResult | null {
  const current = Number(input.effectivePrice);
  if (!Number.isFinite(current) || current <= 0) return null;

  const step = roundMoney(Math.max(0, Number(input.decreasePerEvaluation) || 0));
  if (step <= 0) return null;

  const cap = Number(input.maxDailyDecreasePerDate);
  const remaining = Number.isFinite(cap) && cap > 0
    ? roundMoney(cap - Math.max(0, Number(input.stayDateMovedToday) || 0))
    : step;
  if (remaining <= 0) return null;

  const wanted = Math.min(step, remaining);
  const floor = input.floorPrice === null || input.floorPrice === undefined ? null : Number(input.floorPrice);
  let target = roundMoney(current - wanted);
  if (floor !== null && Number.isFinite(floor)) {
    if (current <= floor) return null;          // already at or under the floor
    if (target < floor) target = roundMoney(floor);
  }
  if (target >= current) return null;
  return { newPrice: target, applied: roundMoney(current - target) };
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
