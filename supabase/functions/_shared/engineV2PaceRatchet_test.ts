// Deno-side checks for the pace ratchet: the module type-checks under the
// edge runtime's compiler, and a decision it produces always fits the
// date-column publisher (every cell moves by the same whole-euro step, inside
// the floor and the ceiling) without being throttled or rejected.
//
// No remote imports on purpose: this file must run offline.
import {
  decidePaceRatchet,
  paceGridFloor,
  resolvePaceSettings,
  type PaceFacts,
  type PaceSettings,
} from "./engineV2PaceRatchet.ts";
import { DEFAULT_DECISION_SETTINGS, type DecisionInput, type DecisionSettings } from "./engineV2Core.ts";
import { headroom, uniformDateStep, validateCells, type CellPrice } from "./priceBounds.ts";
import { effectiveDateColumnBounds } from "./engineV2DateColumnLockstep.ts";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const paceBands = [
  { min_days_out: 0, max_days_out: 1, target_occupancy_pct: 95 },
  { min_days_out: 2, max_days_out: 3, target_occupancy_pct: 90 },
  { min_days_out: 4, max_days_out: 7, target_occupancy_pct: 82 },
  { min_days_out: 8, max_days_out: 14, target_occupancy_pct: 70 },
  { min_days_out: 15, max_days_out: 30, target_occupancy_pct: 55 },
  { min_days_out: 31, max_days_out: 60, target_occupancy_pct: 40 },
  { min_days_out: 61, max_days_out: 120, target_occupancy_pct: 10 },
];
const windowRules = [
  { id: "w0_2", min_days_out: 0, max_days_out: 0, max_daily_decrease: 140, max_daily_increase: 30, no_pickup_wait_hours: 1, min_hours_between_decreases: 1, require_above_anchor: false },
  { id: "w0_2", min_days_out: 1, max_days_out: 3, max_daily_decrease: 80, max_daily_increase: 40, no_pickup_wait_hours: 3, min_hours_between_decreases: 3, require_above_anchor: false },
  { id: "w3_7", min_days_out: 4, max_days_out: 7, max_daily_decrease: 60, max_daily_increase: 45, no_pickup_wait_hours: 4, min_hours_between_decreases: 4, require_above_anchor: false },
  { id: "w8_30", min_days_out: 8, max_days_out: 30, max_daily_decrease: 30, max_daily_increase: 50, no_pickup_wait_hours: 6, min_hours_between_decreases: 6, require_above_anchor: false },
  { id: "w31_90", min_days_out: 31, max_days_out: 120, max_daily_decrease: 30, max_daily_increase: 60, no_pickup_wait_hours: 12, min_hours_between_decreases: 8, require_above_anchor: false },
] as unknown as DecisionSettings["windowRules"];

const NOW = new Date("2026-11-19T11:00:00Z");
const core: DecisionSettings = {
  ...DEFAULT_DECISION_SETTINGS,
  now: NOW,
  paceBands,
  windowRules,
  minMovementEur: 3,
  directionChangeHours: 4,
  maxMarkdownsPerDay: 8,
  maxMarkdownDepthPct: 15,
  rebookWindowHours: 4,
  bookedDateBrakeHours: 4,
  soldOutOccupancyPct: 100,
  cancellationWaitMinutes: 60,
};

// Hotel Ottofiori's thirteen price cells, as offsets from the two-guest
// reference price of the cheapest room type.
const CELL_OFFSETS: Array<[string, number, number]> = [
  ["Economy double", 1, -13], ["Economy double", 2, 0],
  ["Twin", 1, -10], ["Twin", 2, 4],
  ["Queen", 1, -6], ["Queen", 2, 9],
  ["Triple", 1, 0], ["Triple", 2, 14], ["Triple", 3, 34],
  ["Quad", 1, 6], ["Quad", 2, 24], ["Quad", 3, 54], ["Quad", 4, 90],
];

/** The publisher's cell loop from runV2.ts, for a hotel in date-column lockstep. */
function publish(stayDate: string, reference: number, movement: number, s: PaceSettings, ceiling: number) {
  const floor = paceGridFloor(s);
  const dir = Math.sign(movement);
  const wanted = Math.abs(movement);
  const prepared = CELL_OFFSETS.map(([name, occupancy, offset]) => {
    const old = reference + offset;
    const bounds = effectiveDateColumnBounds({
      lockstep: true, cellMin: floor, cellMax: ceiling, globalMin: floor, globalMax: Math.max(floor, ceiling),
    });
    return { name, occupancy, old, bounds, allowed: headroom({ ...bounds, source: "test" }, old, dir) };
  });
  const uniform = uniformDateStep(prepared.map((p) => ({ room_type_name: p.name, allowed: p.allowed })), wanted, s.min_step_eur);
  const cells: CellPrice[] = uniform.held ? [] : prepared.map((p) => ({
    stay_date: stayDate, obk_id: p.name, room_type_name: p.name, occupancy: p.occupancy,
    old_price: p.old, new_price: p.old + dir * uniform.step, currency: "EUR",
    min_price: p.bounds.min, max_price: p.bounds.max,
  }));
  return { uniform, cells, violations: validateCells(cells) };
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

Deno.test("an unset policy is off and carries the owner's defaults", () => {
  const s = resolvePaceSettings(undefined);
  check(s.mode === "off", "an unset policy must be off");
  check(paceGridFloor(s) === 87, "the €65 banked floor must be €87 on the list");
  check(resolvePaceSettings({ mode: "LIVE" }).mode === "off", "only the exact words shadow and live switch the policy on");
});

Deno.test("every decision fits the 13-cell date column: one uniform step, never throttled, never out of bounds", () => {
  const rand = mulberry32(20261118);
  const pick = <T>(list: T[]): T => list[Math.floor(rand() * list.length)];
  let moves = 0;
  for (let i = 0; i < 4000; i++) {
    const s = resolvePaceSettings({ mode: "live", supervised_until: rand() < 0.3 ? "2026-11-21T00:00:00Z" : null });
    const tier = pick(["normal", "normal", "high", "peak"] as const);
    const ceiling = tier === "peak" ? s.peak_ceiling_eur : s.ceiling_eur;
    const daysOut = pick([0, 0, 1, 2, 3, 5, 7, 9, 15, 25, 31, 45, 70, 110]);
    const reference = Math.round(60 + rand() * (ceiling - 40));
    const left = Math.floor(rand() * 22);
    const booked = rand() < 0.35 ? 1 + Math.floor(rand() * 3) : 0;
    const prices = CELL_OFFSETS.map(([, , offset]) => reference + offset);
    const input: DecisionInput = {
      stayDate: "2026-12-04", daysOut, currentPrice: reference,
      occupancyPct: Math.round((21 - left) / 21 * 1000) / 10, roomsSold: 21 - left, roomsRemaining: left,
      pickup1h: booked, pickup6h: booked, pickup24h: booked, pickup48h: booked, pickup7d: booked,
      observedPickup6h: booked, cancellations24h: 0,
      hoursSinceLastPickup: booked > 0 ? 0.2 : pick([2, 5, 9, 30, null]),
      lastCancellationAt: null, lastDirection: null, lastDecisionAt: null, lastDecreaseAt: null,
      movedUpTodayEur: 0, movedDownTodayEur: pick([0, 0, 5, 20]), manualHoldUntil: null, holdKind: null,
      minPrice: 80, maxPrice: 500, adrFloor: null, anchorPrice: 137, crossed60Occupancy: false,
      pendingEventUplift: 0, market: { median: null, sampleSize: 0, ageHours: null },
      campaignStartPrice: null, recentPeakPrice: null, markdownsToday: pick([0, 0, 1, 3]),
    } as DecisionInput;
    const facts: PaceFacts = {
      tier, tierSource: "test", basePrice: pick([null, 100, 150, 300]),
      lowestCellPrice: Math.min(...prices), highestCellPrice: Math.max(...prices),
      // Sometimes the cheapest room types are sold out: only the reference and dearer cells are bookable.
      lowestSellableCellPrice: rand() < 0.3 ? reference : Math.min(...prices),
      convertingPrice: pick([null, reference, reference + 20]), convertedAt: pick([null, "2026-11-19T06:00:00Z"]),
      freshPickup: booked, localMinutes: pick([6 * 60, 9 * 60, 13 * 60, 17 * 60, 21 * 60, 23 * 60]),
      sellableRooms: 21, dateCeilingEur: null, respectWindowCaps: true,
    };
    const decision = decidePaceRatchet(input, core, s, facts);
    check(Number.isInteger(decision.movement), `movement must be whole euros (${decision.movement})`);
    if (decision.blocked) {
      check(decision.movement === 0 && decision.direction === "hold", "a blocked decision must not move");
      continue;
    }
    moves += 1;
    check(
      decision.reason === (decision.movement > 0 ? "revenue_director_yield" : "revenue_director_fill"),
      `a published move must carry a reason the database recognises (${decision.reason})`,
    );
    const out = publish(input.stayDate, reference, decision.movement, s, ceiling);
    check(!out.uniform.held, `the publisher held a move the policy planned (${decision.movement} at €${reference}, ${daysOut} days out)`);
    check(out.uniform.step === Math.abs(decision.movement), `the publisher throttled €${Math.abs(decision.movement)} to €${out.uniform.step} at €${reference}`);
    check(out.cells.length === 13, "all thirteen cells must be priced");
    check(out.violations.length === 0, `price violations: ${JSON.stringify(out.violations.slice(0, 2))}`);
    const cheapest = Math.min(...out.cells.map((c) => c.new_price));
    const dearest = Math.max(...out.cells.map((c) => c.new_price));
    if (decision.movement < 0) check(cheapest >= paceGridFloor(s), `a cut took the cheapest cell to €${cheapest}, under the floor`);
    if (decision.movement > 0) check(dearest <= ceiling, `a raise took the dearest cell to €${dearest}, over €${ceiling}`);
  }
  check(moves > 300, `too few moves exercised (${moves})`);
});
