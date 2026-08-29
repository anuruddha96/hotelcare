// Single source of truth for absolute price floors and ceilings.
//
// The €25 incident: runV2 used `rule.maximum_increase` (a STEP limit) as the
// absolute ceiling when a cell had no explicit maximum, so a €613 one-person
// price could be "clamped" down to €25. Step limits, daily movement budgets and
// per-run caps are never consulted here. Only real price bounds are.

export interface FloorRow {
  room_type_name: string | null;
  occupancy: number | null;
  min_price: number | null;
  max_price: number | null;
  occupancy_supplement?: number | null;
  is_global_safety_max?: boolean | null;
}

export interface RoomTypeRow {
  name: string | null;
  min_price_eur: number | null;
  max_price_eur: number | null;
}

export interface Bounds {
  min: number;
  max: number;
  source: string;
}

export interface BoundsFailure {
  min: null;
  max: null;
  source: string;
  reason: "bounds_missing" | "bounds_invalid";
  detail: string;
}

export type BoundsResult = Bounds | BoundsFailure;

export const isBoundsFailure = (b: BoundsResult): b is BoundsFailure => b.min == null || b.max == null;

const num = (value: unknown): number | null => {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};

export interface BoundsResolverOptions {
  floors: FloorRow[];
  roomTypes: RoomTypeRow[];
  /** Absolute safety ceiling for the hotel (Ottofiori: €500). */
  globalSafetyMax: number;
  /** Absolute safety floor for the hotel (Ottofiori reference 2-pax: €110). */
  globalMin?: number | null;
}

/**
 * Resolve the floor and ceiling for one room type / occupancy cell.
 * Precedence: exact floor row → room-type floor row → occupancy floor row →
 * global floor row → room_types configuration → hotel global safety values.
 */
export function makeBoundsResolver(opts: BoundsResolverOptions) {
  const floors = opts.floors ?? [];
  const roomTypes = opts.roomTypes ?? [];

  return function bounds(roomTypeName: string | null, occupancy: number | null): BoundsResult {
    const occ = occupancy == null ? null : Number(occupancy);
    const exact = floors.find((r) => r.room_type_name === roomTypeName && occ != null && Number(r.occupancy) === occ);
    const byType = floors.find((r) => r.room_type_name === roomTypeName && r.occupancy == null);
    const byOcc = floors.find((r) => r.room_type_name == null && occ != null && Number(r.occupancy) === occ);
    const globalRow = floors.find((r) => r.room_type_name == null && r.occupancy == null);
    const rt = roomTypes.find((r) => r.name === roomTypeName);

    const minCandidates = [
      exact?.min_price, byType?.min_price, byOcc?.min_price, globalRow?.min_price,
      rt?.min_price_eur, opts.globalMin,
    ];
    const maxCandidates = [
      exact?.max_price, byType?.max_price, byOcc?.max_price, globalRow?.max_price,
      rt?.max_price_eur, opts.globalSafetyMax,
    ];
    const min = minCandidates.map(num).find((v) => v != null) ?? null;
    const max = maxCandidates.map(num).find((v) => v != null) ?? null;

    const source = exact ? "floor_exact" : byType ? "floor_room_type" : byOcc ? "floor_occupancy"
      : globalRow ? "floor_global" : rt ? "room_type_config" : "hotel_safety";

    if (min == null || max == null) {
      return {
        min: null, max: null, source, reason: "bounds_missing",
        detail: `No resolvable ${min == null ? "minimum" : "maximum"} price for ${roomTypeName ?? "unknown room type"} / ${occ ?? "?"} pax.`,
      };
    }
    const roundedMin = Math.round(min);
    const roundedMax = Math.round(max);
    if (roundedMax < roundedMin) {
      return {
        min: null, max: null, source, reason: "bounds_invalid",
        detail: `Maximum €${roundedMax} is below minimum €${roundedMin} for ${roomTypeName ?? "unknown room type"} / ${occ ?? "?"} pax.`,
      };
    }
    return { min: roundedMin, max: roundedMax, source };
  };
}

export interface CellPrice {
  stay_date: string;
  obk_id: string | null;
  room_type_name: string | null;
  occupancy: number;
  old_price: number;
  new_price: number;
  currency: string;
  min_price: number;
  max_price: number;
}

export interface PriceViolation {
  stay_date: string;
  room_type_name: string | null;
  occupancy: number;
  price: number;
  problem: "fractional" | "below_floor" | "above_ceiling" | "non_positive";
}

/** Validate every child-cell price independently. Nothing is auto-corrected. */
export function validateCells(cells: CellPrice[]): PriceViolation[] {
  const out: PriceViolation[] = [];
  for (const cell of cells) {
    const base = { stay_date: cell.stay_date, room_type_name: cell.room_type_name, occupancy: cell.occupancy, price: cell.new_price };
    if (!Number.isFinite(cell.new_price) || cell.new_price <= 0) out.push({ ...base, problem: "non_positive" });
    else if (!Number.isInteger(cell.new_price)) out.push({ ...base, problem: "fractional" });
    else if (cell.new_price < cell.min_price) out.push({ ...base, problem: "below_floor" });
    else if (cell.new_price > cell.max_price) out.push({ ...base, problem: "above_ceiling" });
  }
  return out;
}

/** Final guard immediately before a Previo payload is built. */
export function assertWholeEuro(prices: number[]): void {
  const bad = prices.filter((p) => !Number.isInteger(p));
  if (bad.length > 0) {
    throw new Error(`Refusing to send ${bad.length} fractional price(s): ${bad.slice(0, 5).join(", ")}`);
  }
}
