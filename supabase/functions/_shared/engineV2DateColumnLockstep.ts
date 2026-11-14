export interface EffectiveDateColumnBoundsInput {
  lockstep: boolean;
  cellMin: number;
  cellMax: number;
  globalMin: number;
  globalMax: number;
}

export interface EffectiveDateColumnBounds {
  min: number;
  max: number;
  source: "cell_bound" | "hotel_safety_lockstep";
}

const wholePositive = (value: number, fallback: number): number => {
  const rounded = Math.round(Number(value));
  return Number.isFinite(rounded) && rounded > 0 ? rounded : fallback;
};

/**
 * Select the absolute bounds that may limit one child price during a stay-date
 * move. Legacy mode keeps the room/occupancy-specific boundary. Date-column
 * lockstep deliberately ignores those child boundaries and only respects the
 * hotel's absolute safety floor and ceiling.
 */
export function effectiveDateColumnBounds(input: EffectiveDateColumnBoundsInput): EffectiveDateColumnBounds {
  const cellMin = wholePositive(input.cellMin, 1);
  const cellMax = Math.max(cellMin, wholePositive(input.cellMax, cellMin));
  if (!input.lockstep) {
    return { min: cellMin, max: cellMax, source: "cell_bound" };
  }

  const globalMin = wholePositive(input.globalMin, 1);
  const globalMax = Math.max(globalMin, wholePositive(input.globalMax, globalMin));
  return { min: globalMin, max: globalMax, source: "hotel_safety_lockstep" };
}


export interface HotelDateSafetyBoundsInput {
  hotelId: string;
  daysOut: number;
  hotelMin: number;
  hotelMax: number;
  ruleMinimumAdr?: number | null;
}

/**
 * Resolve the shared absolute boundary for a stay-date column. Ottofiori's
 * exceptional EUR75 arrival-day floor must never leak into future dates:
 * D+1 and beyond retain the saved hotel minimum (EUR80 at activation).
 */
export function hotelDateSafetyBounds(input: HotelDateSafetyBoundsInput): EffectiveDateColumnBounds {
  const hotelMin = wholePositive(input.hotelMin, 1);
  const configuredFutureMin = wholePositive(Number(input.ruleMinimumAdr ?? 80), 80);
  const min = input.hotelId === "ottofiori" && input.daysOut > 0
    ? Math.max(hotelMin, configuredFutureMin)
    : hotelMin;
  const max = Math.max(min, wholePositive(input.hotelMax, min));
  return { min, max, source: "hotel_safety_lockstep" };
}
