/**
 * Pure planning for outbound ARI. Turns HotelCare change signals into compressed
 * Channex messages using ariDelta.ts. No I/O.
 */
import {
  compressAvailabilityDeltas, compressRestrictionDeltas, majorToMinorExact,
  type AvailabilityRange, type RestrictionCell, type RestrictionPatch, type RestrictionRange,
} from "./ariDelta.ts";

/** ISO 4217 minor-unit exponents for currencies HotelCare hotels sell in. */
export const CURRENCY_EXPONENT: Record<string, number> = { EUR: 2, HUF: 2, USD: 2, GBP: 2, CHF: 2, CZK: 2, PLN: 2, RON: 2 };

/** Channex certification: full sync covers 500 days; never send past dates. */
export const FULL_SYNC_DAYS = 500;

export type AvailabilityRow = { channex_room_type_id: string; stay_date: string; availability: number };

export function planAvailability(propertyId: string, rows: AvailabilityRow[], today: string): AvailabilityRange[] {
  const cells = rows
    .filter((r) => r.stay_date >= today)
    .map((r) => ({ propertyId, roomTypeId: String(r.channex_room_type_id), date: r.stay_date, availability: Math.max(0, Math.floor(Number(r.availability) || 0)) }));
  return compressAvailabilityDeltas(propertyId, cells, today);
}

export type RateChangeRow = {
  id: number;
  room_type_id: string;
  stay_date: string;
  currency: string;
  patch: Record<string, unknown>;
};

export type RatePlanContext = {
  propertyId: string;
  currency: string;
  today: string;
  /** HotelCare room type id -> Channex rate plan UUID */
  ratePlanByRoomType: Map<string, string>;
};

const FLAG_KEYS = ["stop_sell", "closed_to_arrival", "closed_to_departure"] as const;
const STAY_KEYS = ["min_stay_arrival", "min_stay_through", "max_stay"] as const;

/**
 * Later changes win per (rate plan, date), field by field, so a price edit followed by a
 * min-stay edit sends both, and two price edits send only the last. Omitted fields stay omitted.
 */
export function planRestrictions(rows: RateChangeRow[], ctx: RatePlanContext): {
  values: RestrictionRange[];
  usedIds: number[];
  skipped: { id: number; reason: string }[];
} {
  const exponent = CURRENCY_EXPONENT[ctx.currency.toUpperCase()];
  const skipped: { id: number; reason: string }[] = [];
  const usedIds: number[] = [];
  const merged = new Map<string, RestrictionCell>();

  for (const row of [...rows].sort((a, b) => a.id - b.id)) {
    const plan = ctx.ratePlanByRoomType.get(row.room_type_id);
    if (!plan) { skipped.push({ id: row.id, reason: "room type not mapped to a Channex rate plan" }); continue; }
    if (row.stay_date < ctx.today) { skipped.push({ id: row.id, reason: "past date" }); continue; }
    if (exponent === undefined) { skipped.push({ id: row.id, reason: `unsupported currency ${ctx.currency}` }); continue; }
    if (String(row.currency).toUpperCase() !== ctx.currency.toUpperCase()) {
      skipped.push({ id: row.id, reason: `currency ${row.currency} differs from Channex property currency ${ctx.currency}` });
      continue;
    }
    const patch: RestrictionPatch = {};
    try {
      if (row.patch.rate !== undefined) patch.rate = majorToMinorExact(String(row.patch.rate), exponent);
      for (const k of STAY_KEYS) if (row.patch[k] !== undefined) patch[k] = Number(row.patch[k]);
      for (const k of FLAG_KEYS) if (row.patch[k] !== undefined) patch[k] = row.patch[k] === true;
    } catch (err) {
      skipped.push({ id: row.id, reason: err instanceof Error ? err.message : "invalid value" });
      continue;
    }
    if (!Object.keys(patch).length) { skipped.push({ id: row.id, reason: "empty change" }); continue; }
    const key = plan + "|" + row.stay_date;
    const prev = merged.get(key);
    merged.set(key, { propertyId: ctx.propertyId, ratePlanId: plan, date: row.stay_date, patch: { ...(prev?.patch ?? {}), ...patch } });
    usedIds.push(row.id);
  }

  const values = compressRestrictionDeltas(ctx.propertyId, [...merged.values()], ctx.today);
  return { values, usedIds, skipped };
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Channex: 10 availability + 10 restriction calls per property per minute. Leave headroom. */
export function callsAllowedNow(sentInLastMinute: number, perRunCap = 5, providerLimit = 10): number {
  return Math.max(0, Math.min(perRunCap, providerLimit - 1 - sentInLastMinute));
}
