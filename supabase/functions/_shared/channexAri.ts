/**
 * Channex ARI batching — PURE functions (no I/O). Shared by the
 * channex-ari-worker edge function and the vitest suite.
 *
 * Rules implemented here (Channex PMS certification + best practices):
 *  - one POST /availability and one POST /restrictions per property per batch;
 *  - consecutive dates with identical values are compressed into one range;
 *  - restrictions carry only the fields that changed (omitted fields are kept
 *    as they are in Channex);
 *  - a later change to the same cell overrides an earlier one, field by field;
 *  - rates are sent as decimal strings in major units ("456.23").
 *
 * Docs: https://docs.channex.io/api-v.1-documentation/ari
 */

export type AriKind = "availability" | "restrictions";

export type OutboxRow = {
  id: number;
  kind: AriKind;
  target_id: string; // HotelCare room_types.id or rate_plans.id
  date: string; // YYYY-MM-DD
  fields: Record<string, unknown>;
};

export type AvailabilityValue = {
  property_id: string;
  room_type_id: string;
  date_from: string;
  date_to: string;
  availability: number;
};

export type RestrictionFields = {
  rate?: string;
  min_stay_arrival?: number;
  min_stay_through?: number;
  max_stay?: number;
  closed_to_arrival?: boolean;
  closed_to_departure?: boolean;
  stop_sell?: boolean;
};

export type RestrictionValue = RestrictionFields & {
  property_id: string;
  rate_plan_id: string;
  date_from: string;
  date_to: string;
};

export type Cell = { target_id: string; date: string; fields: Record<string, unknown> };

const RESTRICTION_KEYS = [
  "rate",
  "min_stay_arrival",
  "min_stay_through",
  "max_stay",
  "closed_to_arrival",
  "closed_to_departure",
  "stop_sell",
] as const;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function addDays(date: string, days: number): string {
  if (!DATE_RE.test(date)) throw new Error(`Invalid date ${date}`);
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Formats a price as a Channex decimal string with exactly two decimals. */
export function formatRate(value: unknown): string {
  const s = typeof value === "number" ? value.toFixed(2) : String(value ?? "").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new Error(`Invalid rate ${String(value)}`);
  const [whole, frac = ""] = s.split(".");
  return `${whole}.${frac.padEnd(2, "0")}`;
}

function normaliseFields(kind: AriKind, fields: Record<string, unknown>): Record<string, unknown> {
  if (kind === "availability") {
    const n = Number(fields.availability);
    if (!Number.isInteger(n) || n < 0) throw new Error(`Invalid availability ${String(fields.availability)}`);
    return { availability: n };
  }
  const out: Record<string, unknown> = {};
  for (const key of RESTRICTION_KEYS) {
    if (!(key in fields) || fields[key] === null || fields[key] === undefined) continue;
    const v = fields[key];
    if (key === "rate") out.rate = formatRate(v);
    else if (key === "min_stay_arrival" || key === "min_stay_through" || key === "max_stay") {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0) throw new Error(`Invalid ${key} ${String(v)}`);
      out[key] = n;
    } else out[key] = Boolean(v);
  }
  return out;
}

/**
 * Collapses outbox rows into one cell per (target, date). Rows are applied in
 * id order so later edits win field by field.
 */
export function coalesceOutbox(rows: OutboxRow[]): Map<AriKind, Cell[]> {
  const byKind = new Map<AriKind, Map<string, Cell>>();
  for (const row of [...rows].sort((a, b) => a.id - b.id)) {
    const kindMap = byKind.get(row.kind) ?? new Map<string, Cell>();
    byKind.set(row.kind, kindMap);
    const key = `${row.target_id}|${row.date}`;
    const prev = kindMap.get(key);
    const merged = { ...(prev?.fields ?? {}), ...normaliseFields(row.kind, row.fields) };
    kindMap.set(key, { target_id: row.target_id, date: row.date, fields: merged });
  }
  const out = new Map<AriKind, Cell[]>();
  for (const [kind, m] of byKind) out.set(kind, [...m.values()]);
  return out;
}

function stableKey(fields: Record<string, unknown>): string {
  return JSON.stringify(Object.keys(fields).sort().map((k) => [k, fields[k]]));
}

/**
 * Compresses cells into Channex values: per target, consecutive dates with an
 * identical field set become one date_from/date_to range.
 */
export function compressCells(
  kind: AriKind,
  cells: Cell[],
  propertyId: string,
  channexIdFor: (localId: string) => string | undefined,
): { values: Array<AvailabilityValue | RestrictionValue>; unmapped: string[] } {
  const unmapped = new Set<string>();
  const byTarget = new Map<string, Cell[]>();
  for (const c of cells) {
    if (Object.keys(c.fields).length === 0) continue;
    const list = byTarget.get(c.target_id) ?? [];
    list.push(c);
    byTarget.set(c.target_id, list);
  }
  const values: Array<AvailabilityValue | RestrictionValue> = [];
  for (const [target, list] of byTarget) {
    const channexId = channexIdFor(target);
    if (!channexId) {
      unmapped.add(target);
      continue;
    }
    list.sort((a, b) => a.date.localeCompare(b.date));
    let start = list[0];
    let end = list[0];
    const flush = () => {
      const base = { property_id: propertyId, date_from: start.date, date_to: end.date };
      values.push(
        kind === "availability"
          ? ({ ...base, room_type_id: channexId, availability: start.fields.availability as number })
          : ({ ...base, rate_plan_id: channexId, ...(start.fields as RestrictionFields) }),
      );
    };
    for (let i = 1; i < list.length; i++) {
      const c = list[i];
      if (c.date === addDays(end.date, 1) && stableKey(c.fields) === stableKey(start.fields)) {
        end = c;
      } else {
        flush();
        start = c;
        end = c;
      }
    }
    flush();
  }
  values.sort((a, b) => {
    const ta = "room_type_id" in a ? a.room_type_id : (a as RestrictionValue).rate_plan_id;
    const tb = "room_type_id" in b ? b.room_type_id : (b as RestrictionValue).rate_plan_id;
    return ta.localeCompare(tb) || a.date_from.localeCompare(b.date_from);
  });
  return { values, unmapped: [...unmapped] };
}

/** Builds full-sync cells for `days` days from `from`, filling gaps with defaults. */
export function fullSyncCells(
  kind: AriKind,
  targets: string[],
  from: string,
  days: number,
  stored: Map<string, Record<string, unknown>>, // key `${target}|${date}`
  defaults: (target: string) => Record<string, unknown>,
): Cell[] {
  const cells: Cell[] = [];
  for (const target of targets) {
    const def = defaults(target);
    for (let i = 0; i < days; i++) {
      const date = addDays(from, i);
      const s = stored.get(`${target}|${date}`) ?? {};
      const merged: Record<string, unknown> = { ...def };
      for (const [k, v] of Object.entries(s)) if (v !== null && v !== undefined) merged[k] = v;
      cells.push({ target_id: target, date, fields: normaliseFields(kind, merged) });
    }
  }
  return cells;
}

export type ResponseClass = "ok" | "retry" | "fail";

/** 429, 5xx and network errors are retried; other 4xx are permanent. */
export function classifyStatus(status: number | null): ResponseClass {
  if (status === null) return "retry";
  if (status >= 200 && status < 300) return "ok";
  if (status === 429 || status === 408 || status >= 500) return "retry";
  return "fail";
}

/** Exponential backoff: 15 s, 30 s, 60 s … capped at 15 minutes. */
export function backoffSeconds(attempts: number, retryAfterHeader?: string | null): number {
  const ra = Number(retryAfterHeader);
  if (Number.isFinite(ra) && ra > 0) return Math.min(900, Math.ceil(ra));
  return Math.min(900, 15 * 2 ** Math.max(0, attempts - 1));
}

export function extractTaskIds(body: unknown): string[] {
  const data = (body as { data?: unknown })?.data;
  const list = Array.isArray(data) ? data : data ? [data] : [];
  return list
    .filter((x) => x && typeof x === "object" && (x as { type?: string }).type === "task")
    .map((x) => String((x as { id: string }).id))
    .filter(Boolean);
}

export function extractWarnings(body: unknown): unknown[] {
  const meta = (body as { meta?: { warnings?: unknown } })?.meta;
  const w = meta?.warnings;
  return Array.isArray(w) ? w : w ? [w] : [];
}

/** Channex limit: 10 availability + 10 restriction requests per property per minute. We keep 2 in reserve. */
export const REQUESTS_PER_MINUTE_BUDGET = 8;

export function dateSpan(values: Array<{ date_from: string; date_to: string }>): { from: string | null; to: string | null } {
  if (!values.length) return { from: null, to: null };
  let from = values[0].date_from;
  let to = values[0].date_to;
  for (const v of values) {
    if (v.date_from < from) from = v.date_from;
    if (v.date_to > to) to = v.date_to;
  }
  return { from, to };
}
