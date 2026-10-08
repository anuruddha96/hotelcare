/**
 * Channex ARI delta helpers. PURE calculations only: no I/O, credentials or
 * provider calls. Designed for a later server-side adapter after staging QA.
 *
 * Channex writes accept minor-unit integer rates; the provider also accepts
 * decimal strings in major units. Convert explicitly at the API boundary.
 * https://docs.channex.io/api-v.1-documentation/ari
 */
export type ChannexDate = string;

export type AvailabilityCell = {
  propertyId: string;
  roomTypeId: string;
  date: ChannexDate;
  availability: number;
};

export type RateOption = { occupancy: number; rate: number };

export type RestrictionPatch = {
  rate?: number;
  rates?: RateOption[];
  min_stay_arrival?: number;
  min_stay_through?: number;
  max_stay?: number;
  stop_sell?: boolean;
  closed_to_arrival?: boolean;
  closed_to_departure?: boolean;
};

export type RestrictionCell = {
  propertyId: string;
  ratePlanId: string;
  date: ChannexDate;
  patch: RestrictionPatch;
};

export type AvailabilityRange = {
  property_id: string;
  room_type_id: string;
  date_from: string;
  date_to: string;
  availability: number;
};

export type RestrictionRange = {
  property_id: string;
  rate_plan_id: string;
  date_from: string;
  date_to: string;
} & RestrictionPatch;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const normalizedDate = (date: string): number => {
  if (!DATE.test(date)) throw new Error("Invalid Channex ISO date");
  const time = Date.parse(date + "T00:00:00Z");
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== date)
    throw new Error("Invalid Channex ISO date");
  return time;
};

const validateDate = (date: string, today: string): void => {
  if (normalizedDate(date) < normalizedDate(today))
    throw new Error("Past dates cannot be published to Channex");
};

const requiredId = (s: string): void => {
  if (!s || typeof s !== "string") throw new Error("Missing Channex mapping ID");
};
const validNonNegativeInt = (n: number): boolean =>
  Number.isSafeInteger(n) && n >= 0;
const validPositiveInt = (n: number): boolean =>
  Number.isSafeInteger(n) && n > 0;

const restrictionKeys = [
  "rate", "rates", "min_stay_arrival", "min_stay_through",
  "max_stay", "stop_sell", "closed_to_arrival", "closed_to_departure",
] as const;

const normalizedPatch = (patch: RestrictionPatch): RestrictionPatch => {
  if (!patch || typeof patch !== "object") throw new Error("Missing restriction patch");
  if (Object.keys(patch).some(k => !restrictionKeys.includes(k as typeof restrictionKeys[number])))
    throw new Error("Unsupported restriction field");
  const value: RestrictionPatch = {};
  if (patch.rate !== undefined) {
    if (!validPositiveInt(patch.rate)) throw new Error("Rate must be positive minor-unit integer");
    value.rate = patch.rate;
  }
  if (patch.rates !== undefined) {
    if (!Array.isArray(patch.rates) || patch.rates.length === 0)
      throw new Error("Occupancy rates must be a non-empty array");
    const rates = [...patch.rates].sort((a,b) => a.occupancy - b.occupancy);
    const seen = new Set<number>();
    for (const entry of rates) {
      if (!validPositiveInt(entry.occupancy) || !validPositiveInt(entry.rate))
        throw new Error("Invalid occupancy rate");
      if (seen.has(entry.occupancy)) throw new Error("Duplicate occupancy rate");
      seen.add(entry.occupancy);
    }
    value.rates = rates;
  }
  if (value.rate !== undefined && value.rates !== undefined)
    throw new Error("Choose scalar rate OR occupancy rate array");
  for (const k of ["min_stay_arrival", "min_stay_through", "max_stay"] as const) {
    if (patch[k] !== undefined) {
      if (!validPositiveInt(patch[k])) throw new Error("Invalid positive stay limit");
      value[k] = patch[k];
    }
  }
  for (const k of ["stop_sell", "closed_to_arrival", "closed_to_departure"] as const) {
    if (patch[k] !== undefined) {
      if (typeof patch[k] !== "boolean") throw new Error("Invalid restriction flag");
      value[k] = patch[k];
    }
  }
  if (!Object.keys(value).length) throw new Error("Empty restriction patch");
  return value;
};

function compact<T extends { propertyId: string; date: string }>(
  cells: T[],
  expectedPropertyId: string,
  today: string,
  group: (c: T) => string,
  value: (c: T) => string,
  build: (c: T, start: string, end: string) => unknown,
): unknown[] {
  requiredId(expectedPropertyId);
  normalizedDate(today);
  const unique = new Map<string, T>();
  for (const cell of cells) {
    if (cell.propertyId !== expectedPropertyId) throw new Error("Cross-property Channex delta blocked");
    validateDate(cell.date, today);
    const key = group(cell) + "|" + cell.date;
    const old = unique.get(key);
    if (old && value(old) !== value(cell))
      throw new Error("Conflicting changes for the same room/rate and date");
    unique.set(key, cell);
  }
  const sorted = [...unique.values()].sort((a,b) =>
    group(a).localeCompare(group(b)) || a.date.localeCompare(b.date));
  const output: unknown[] = [];
  let current: T | undefined, from = "", to = "";
  const flush = () => {
    if (current) output.push(build(current, from, to));
  };
  for (const cell of sorted) {
    const adjacent = current &&
      group(current) === group(cell) &&
      value(current) === value(cell) &&
      normalizedDate(cell.date) - normalizedDate(to) === 86400000;
    if (adjacent) to = cell.date;
    else {
      flush();
      current = cell;
      from = to = cell.date;
    }
  }
  flush();
  return output;
}

/** Preserve zero availability, reject conflicting duplicates and other hotels. */
export function compressAvailabilityDeltas(
  propertyId: string, cells: AvailabilityCell[], today: string,
): AvailabilityRange[] {
  for (const c of cells) {
    requiredId(c.roomTypeId);
    if (!validNonNegativeInt(c.availability)) throw new Error("Invalid sellable inventory");
  }
  return compact(cells, propertyId, today,
    c => c.roomTypeId, c => String(c.availability),
    (c, start, end) => ({
      property_id: c.propertyId, room_type_id: c.roomTypeId,
      date_from: start, date_to: end, availability: c.availability,
    })) as AvailabilityRange[];
}

/** Omitted restriction fields remain omitted: a rate-only delta won't reset min stay. */
export function compressRestrictionDeltas(
  propertyId: string, cells: RestrictionCell[], today: string,
): RestrictionRange[] {
  const normalized = cells.map(c => {
    requiredId(c.ratePlanId);
    return { ...c, patch: normalizedPatch(c.patch) };
  });
  return compact(normalized, propertyId, today,
    c => c.ratePlanId, c => JSON.stringify(c.patch),
    (c, start, end) => ({
      property_id: c.propertyId, rate_plan_id: c.ratePlanId,
      date_from: start, date_to: end, ...c.patch,
    })) as RestrictionRange[];
}

/** No floating point rounding: currency exponent must be agreed with provider. */
export function majorToMinorExact(amount: string, exponent: number): number {
  if (!Number.isInteger(exponent) || exponent < 0 || exponent > 3)
    throw new Error("Explicit supported currency exponent is required");
  if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(amount))
    throw new Error("Expected nonnegative decimal string");
  const [whole, fraction = ""] = amount.split(".");
  if (fraction.length > exponent) throw new Error("Amount has excess fractional precision");
  const result = BigInt(whole) * 10n ** BigInt(exponent) +
    BigInt((fraction.padEnd(exponent, "0") || "0"));
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Money value exceeds safe integer");
  return Number(result);
}

/**
 * A revision can be ACKed only after durable local application or a durable
 * human-review case (including full revision data) has been saved. Never ACK
 * an unknown tenant/property just to make an account-wide feed look clean.
 */
export function mayAckRevision(state: {
  expectedProperty: boolean;
  permittedTenant: boolean;
  durableBookingSaved: boolean;
  durableReviewSaved: boolean;
}): boolean {
  return state.expectedProperty && state.permittedTenant &&
    (state.durableBookingSaved || state.durableReviewSaved);
}
