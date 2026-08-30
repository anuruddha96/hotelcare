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

/**
 * Validate every child-cell price independently. Nothing is auto-corrected.
 *
 * A price that was ALREADY outside its bounds before the run (e.g. a legacy
 * 1-pax price sitting under a newly raised floor) is not the engine's doing.
 * Blocking the whole run for it froze Ottofiori in shadow mode while the very
 * cells complained about were being moved back towards their floor. So an
 * out-of-bounds price only counts as a violation when the run made it worse:
 * moving a below-floor price UP (or an above-ceiling price DOWN) is a repair.
 */
export function validateCells(cells: CellPrice[]): PriceViolation[] {
  const out: PriceViolation[] = [];
  for (const cell of cells) {
    const base = { stay_date: cell.stay_date, room_type_name: cell.room_type_name, occupancy: cell.occupancy, price: cell.new_price };
    const wasBelow = Number.isFinite(cell.old_price) && cell.old_price < cell.min_price;
    const wasAbove = Number.isFinite(cell.old_price) && cell.old_price > cell.max_price;
    if (!Number.isFinite(cell.new_price) || cell.new_price <= 0) out.push({ ...base, problem: "non_positive" });
    else if (!Number.isInteger(cell.new_price)) out.push({ ...base, problem: "fractional" });
    else if (cell.new_price < cell.min_price) {
      if (!(wasBelow && cell.new_price > cell.old_price)) out.push({ ...base, problem: "below_floor" });
    } else if (cell.new_price > cell.max_price) {
      if (!(wasAbove && cell.new_price < cell.old_price)) out.push({ ...base, problem: "above_ceiling" });
    }
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

/**
 * How far one cell can still move in a direction before it hits its own
 * absolute floor or ceiling. Used to throttle a whole stay date to a single
 * uniform step, so every room type of the day moves by the same amount.
 */
export function headroom(bounds: Bounds, oldPrice: number, direction: number): number {
  if (direction === 0) return 0;
  const old = Math.round(oldPrice);
  // A price that starts outside its bounds keeps full headroom in the
  // direction that brings it back, and none in the direction that makes it
  // worse — otherwise a single stale cell holds the whole date forever.
  if (direction > 0) return Math.max(0, Math.round(bounds.max) - old);
  return Math.max(0, old - Math.round(bounds.min));
}

export interface DateStepCell {
  room_type_name: string | null;
  /** How far this cell can still move in the wanted direction. */
  allowed: number;
}

export interface DateStepResult {
  /** Absolute whole-euro step that EVERY cell of the date can take. */
  step: number;
  /** The room type that limited the step, when it was reduced. */
  limitedBy: string | null;
  /** True when the date must be held instead of moved. */
  held: boolean;
}

/**
 * A stay date moves as one block: the step is throttled to the smallest
 * headroom on the date so every room type moves by the same amount. When that
 * leaves less than the minimum publishable movement, the whole date is held.
 */
export function uniformDateStep(cells: DateStepCell[], wanted: number, minMovement: number): DateStepResult {
  const want = Math.abs(Math.round(wanted));
  if (cells.length === 0) return { step: 0, limitedBy: null, held: true };
  let step = want;
  let limitedBy: string | null = null;
  for (const cell of cells) {
    if (cell.allowed < step) {
      step = Math.max(0, Math.round(cell.allowed));
      limitedBy = cell.room_type_name;
    }
  }
  if (step < minMovement) return { step: 0, limitedBy, held: true };
  return { step, limitedBy: step < want ? limitedBy : null, held: false };
}
