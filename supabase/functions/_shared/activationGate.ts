// Automatic shadow → live activation, and the live watchdog.
//
// No human presses a button and no individual price is approved. After a clean
// 24-hour shadow period every gate below must pass; the first 48 live hours run
// under tighter supervision and any critical condition drops the hotel straight
// back to shadow with the reason recorded.

export interface GateInputs {
  /** Hours of uninterrupted shadow running. */
  shadowHours: number;
  /** Runs completed in the shadow period, and how many failed/timed out. */
  runsTotal: number;
  runsFailed: number;
  /** Dates evaluated and moved during the shadow period. */
  datesEvaluated: number;
  datesIncreased: number;
  datesDecreased: number;
  /** Every simulated price was a whole euro. */
  allWholeEuro: boolean;
  /** No simulated price broke its own floor or ceiling. */
  allWithinBounds: boolean;
  /** No date received both an increase and a decrease in the same period. */
  noDualDirection: boolean;
  /** No date exceeded its daily movement allowance. */
  noBudgetBreach: boolean;
  /** Inventory sanity: sellable rooms match the real property. */
  sellableRooms: number;
  expectedRooms: number;
  /** Every simulated run produced at least one child cell per moved date. */
  childCellsConsistent: boolean;
  /** No decision was taken on stale PMS data. */
  noStaleDecisions: boolean;
}

export interface GateResult {
  passed: boolean;
  checks: Record<string, boolean>;
  failing: string[];
}

export function evaluateGates(i: GateInputs): GateResult {
  const checks: Record<string, boolean> = {
    shadow_24h_complete: i.shadowHours >= 24,
    runs_healthy: i.runsTotal >= 12 && i.runsFailed === 0,
    dates_evaluated: i.datesEvaluated > 0,
    markdown_share_sane: i.datesDecreased === 0
      || i.datesDecreased <= Math.max(5, Math.round((i.datesIncreased + i.datesDecreased) * 0.6)),
    whole_euro_only: i.allWholeEuro,
    within_floor_and_ceiling: i.allWithinBounds,
    no_dual_direction_dates: i.noDualDirection,
    daily_budget_respected: i.noBudgetBreach,
    inventory_correct: i.sellableRooms === i.expectedRooms,
    child_cells_consistent: i.childCellsConsistent,
    no_stale_data_decisions: i.noStaleDecisions,
  };
  const failing = Object.entries(checks).filter(([, ok]) => !ok).map(([key]) => key);
  return { passed: failing.length === 0, checks, failing };
}

export interface WatchdogInputs {
  /** Hours since live publishing began. */
  liveHours: number;
  fractionalPrices: number;
  boundsBreaches: number;
  staleDataDecisions: number;
  overlappingRuns: number;
  consecutiveTimeouts: number;
  repeatedEventUplifts: number;
  dualDirectionDates: number;
  previoRejections: number;
  mappingErrors: number;
}

export interface WatchdogResult {
  pause: boolean;
  reason: string | null;
  /** Tighter caps apply while this is true. */
  supervised: boolean;
}

export function evaluateWatchdog(i: WatchdogInputs): WatchdogResult {
  const conditions: Array<[string, boolean]> = [
    ["a price was not a whole euro", i.fractionalPrices > 0],
    ["a price broke its floor or ceiling", i.boundsBreaches > 0],
    ["a decision was taken on stale data", i.staleDataDecisions > 0],
    ["two runs overlapped", i.overlappingRuns > 0],
    ["the run timed out repeatedly", i.consecutiveTimeouts >= 3],
    ["an event lifted the same date twice", i.repeatedEventUplifts > 0],
    ["a date moved in both directions", i.dualDirectionDates > 0],
    ["Previo rejected prices repeatedly", i.previoRejections >= 5],
    ["a room mapping or safety check failed", i.mappingErrors > 0],
  ];
  const hit = conditions.find(([, triggered]) => triggered);
  return {
    pause: Boolean(hit),
    reason: hit ? `Paused back to shadow: ${hit[0]}.` : null,
    supervised: i.liveHours < 48,
  };
}

/** Movement allowances are halved during the supervised first 48 live hours. */
export function supervisedCaps(maxIncrease: number, maxDecrease: number, supervised: boolean) {
  if (!supervised) return { maxIncrease, maxDecrease };
  return {
    maxIncrease: Math.max(3, Math.floor(maxIncrease / 2)),
    maxDecrease: Math.max(3, Math.floor(maxDecrease / 2)),
  };
}
