// Net rate factor.
//
// The engine sets the price on the grid, but the hotel does not bank the grid
// price: derived OTA plans (mobile, genius, non-refundable), single-occupancy
// rates and channel discounts sell the same room lower. At Hotel Ottofiori the
// realised nightly rate has been running ~24% under the loaded price, so a grid
// price of 130 never produced an ADR of 130.
//
// This module measures that leakage from the hotel's own bookings and turns it
// into one number: realised ÷ grid. Every ADR-related floor is then divided by
// the factor before it is applied to the grid, so the floors mean what the
// manager thinks they mean.
//
// Pure functions only.

export interface RealisedNight {
  stayDate: string;
  roomTypeName: string | null;
  guests: number | null;
  nightlyPriceEur: number | null;
}

export interface GridPriceLookup {
  /** Grid price for a date / room type / occupancy, or null when unknown. */
  (stayDate: string, roomTypeName: string | null, occupancy: number): number | null;
}

export interface NetRateFactorResult {
  /** Realised ÷ grid, clamped. 1 means no leakage measured. */
  factor: number;
  /** How many room-nights the factor rests on. */
  samples: number;
  /** Average realised nightly rate across the samples. */
  avgRealised: number | null;
  /** Average grid price across the same samples. */
  avgGrid: number | null;
  reason: "measured" | "too_few_samples" | "no_data" | "override" | "disabled";
}

export const NET_FACTOR_MIN = 0.6;
export const NET_FACTOR_MAX = 1;
/** Below this many room-nights the measurement is not trusted. */
export const NET_FACTOR_MIN_SAMPLES = 20;

const clampFactor = (value: number): number =>
  Math.min(NET_FACTOR_MAX, Math.max(NET_FACTOR_MIN, Math.round(value * 1000) / 1000));

export function computeNetRateFactor(
  nights: RealisedNight[],
  grid: GridPriceLookup,
  options?: { minSamples?: number },
): NetRateFactorResult {
  const minSamples = Math.max(1, options?.minSamples ?? NET_FACTOR_MIN_SAMPLES);
  let realisedSum = 0;
  let gridSum = 0;
  let samples = 0;

  for (const night of nights) {
    const realised = Number(night.nightlyPriceEur);
    if (!Number.isFinite(realised) || realised <= 0) continue;
    const occupancy = Math.min(4, Math.max(1, Math.round(Number(night.guests ?? 2) || 2)));
    const gridPrice = grid(night.stayDate, night.roomTypeName, occupancy);
    if (gridPrice == null || !Number.isFinite(gridPrice) || gridPrice <= 0) continue;
    realisedSum += realised;
    gridSum += gridPrice;
    samples += 1;
  }

  if (samples === 0 || gridSum <= 0) {
    return { factor: 1, samples, avgRealised: null, avgGrid: null, reason: "no_data" };
  }
  const avgRealised = Math.round(realisedSum / samples);
  const avgGrid = Math.round(gridSum / samples);
  if (samples < minSamples) {
    return { factor: 1, samples, avgRealised, avgGrid, reason: "too_few_samples" };
  }
  return {
    factor: clampFactor(realisedSum / gridSum),
    samples,
    avgRealised,
    avgGrid,
    reason: "measured",
  };
}

/** Resolve the factor a run should use: manual override wins, then measurement. */
export function resolveNetRateFactor(
  enabled: boolean,
  override: number | null | undefined,
  measured: NetRateFactorResult,
): NetRateFactorResult {
  if (!enabled) return { factor: 1, samples: 0, avgRealised: null, avgGrid: null, reason: "disabled" };
  const manual = Number(override);
  if (Number.isFinite(manual) && manual > 0) {
    return { ...measured, factor: clampFactor(manual), reason: "override" };
  }
  return measured;
}

/**
 * The grid price a floor expressed in realised money needs to be, so the hotel
 * actually banks it. €110 realised at a factor of 0.76 needs a €145 grid price.
 */
export function grossUpFloor(realisedFloor: number | null | undefined, factor: number): number | null {
  const value = Number(realisedFloor);
  if (!Number.isFinite(value) || value <= 0) return null;
  const f = Number.isFinite(factor) && factor > 0 ? Math.min(1, factor) : 1;
  return Math.round(value / f);
}
