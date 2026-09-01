import { describe, it, expect } from "vitest";
import {
  decideDate,
  windowFor,
  paceTargetFor,
  buildMarketSignal,
  marketCeiling,
  explainDecision,
  DEFAULT_DECISION_SETTINGS,
  DEFAULT_MARKET_VALIDATION,
  OTTOFIORI_WINDOW_RULES,
  type DecisionInput,
  type DecisionSettings,
  type PaceBand,
} from "../../../supabase/functions/_shared/engineV2";
import {
  makeBoundsResolver,
  validateCells,
  assertWholeEuro,
  isBoundsFailure,
  headroom,
  uniformDateStep,
} from "../../../supabase/functions/_shared/priceBounds";
import { evaluateGates, evaluateWatchdog, supervisedCaps } from "../../../supabase/functions/_shared/activationGate";
import { eventKeyOf, eventTitleUsable } from "../../../supabase/functions/revenue-pickup-automation/runV2";

const NOW = new Date("2026-08-29T10:00:00Z");

const PACE: PaceBand[] = [
  { min_days_out: 0, max_days_out: 2, target_occupancy_pct: 92 },
  { min_days_out: 3, max_days_out: 7, target_occupancy_pct: 85 },
  { min_days_out: 8, max_days_out: 30, target_occupancy_pct: 70 },
  { min_days_out: 31, max_days_out: 90, target_occupancy_pct: 50 },
  { min_days_out: 91, max_days_out: 180, target_occupancy_pct: 30 },
  { min_days_out: 181, max_days_out: 400, target_occupancy_pct: 15 },
];

const settings = (patch: Partial<DecisionSettings> = {}): DecisionSettings => ({
  ...DEFAULT_DECISION_SETTINGS,
  now: NOW,
  paceBands: PACE,
  ...patch,
});

const input = (patch: Partial<DecisionInput> = {}): DecisionInput => ({
  stayDate: "2026-09-15",
  daysOut: 17,
  currentPrice: 180,
  occupancyPct: 50,
  roomsSold: 10,
  roomsRemaining: 11,
  pickup1h: 0,
  pickup6h: 0,
  pickup24h: 0,
  pickup48h: 0,
  pickup7d: 0,
  cancellations24h: 0,
  hoursSinceLastPickup: 100,
  lastCancellationAt: null,
  lastDirection: null,
  lastDecisionAt: null,
  lastDecreaseAt: null,
  movedUpTodayEur: 0,
  movedDownTodayEur: 0,
  manualHoldUntil: null,
  minPrice: 110,
  maxPrice: 500,
  anchorPrice: 150,
  crossed60Occupancy: false,
  pendingEventUplift: 0,
  market: { median: null, sampleSize: 0, ageHours: null },
  ...patch,
});

describe("the €25 bug can never come back", () => {
  it("uses the €500 safety ceiling, never a step limit, to cap a rise", () => {
    const d = decideDate(input({ pickup24h: 3, currentPrice: 492, minPrice: 110, maxPrice: 500 }), settings());
    expect(d.targetPrice).toBe(500);
  });

  it("leaves a price that already sits above the ceiling alone instead of snapping it to €500", () => {
    const rise = decideDate(input({ pickup24h: 3, currentPrice: 775, minPrice: 110, maxPrice: 500 }), settings());
    expect(rise.blocked).toBe(true);
    const cut = decideDate(input({
      daysOut: 124, occupancyPct: 0, hoursSinceLastPickup: 300, currentPrice: 775, anchorPrice: 150,
      minPrice: 110, maxPrice: 500,
    }), settings());
    expect(cut.movement).toBe(-3);
    expect(cut.targetPrice).toBe(772);
  });

  it("refuses to decide when bounds are missing rather than inventing them", () => {
    const d = decideDate(input({ pickup24h: 3, minPrice: null }), settings());
    expect(d.blocked).toBe(true);
    expect(d.reason).toBe("bounds_missing");
  });

  it("refuses when the maximum sits below the minimum", () => {
    const d = decideDate(input({ pickup24h: 3, minPrice: 200, maxPrice: 120 }), settings());
    expect(d.reason).toBe("bounds_invalid");
  });

  it("resolves real bounds and never a step limit", () => {
    const bounds = makeBoundsResolver({
      floors: [{ room_type_name: null, occupancy: 2, min_price: 110, max_price: 500, is_global_safety_max: true }],
      roomTypes: [{ name: "Deluxe Twin Room", min_price_eur: 70, max_price_eur: 350 }],
      globalSafetyMax: 500,
      globalMin: 110,
    });
    const twin = bounds("Deluxe Twin Room", 1);
    expect(isBoundsFailure(twin)).toBe(false);
    if (!isBoundsFailure(twin)) {
      expect(twin.min).toBe(70);
      expect(twin.max).toBe(350);
    }
    const unknown = bounds("Nowhere Suite", 2);
    if (!isBoundsFailure(unknown)) expect(unknown.max).toBe(500);
  });
});

describe("lead-time windows follow the agreed Ottofiori strategy", () => {
  it("maps every lead time to exactly one window", () => {
    expect(windowFor(0).id).toBe("w0_2");
    expect(windowFor(2).id).toBe("w0_2");
    expect(windowFor(3).id).toBe("w3_7");
    expect(windowFor(7).id).toBe("w3_7");
    expect(windowFor(8).id).toBe("w8_30");
    expect(windowFor(30).id).toBe("w8_30");
    expect(windowFor(31).id).toBe("w31_90");
    expect(windowFor(90).id).toBe("w31_90");
    expect(windowFor(91).id).toBe("w91_180");
    expect(windowFor(180).id).toBe("w91_180");
    expect(windowFor(181).id).toBe("w181_365");
    expect(windowFor(364).id).toBe("w181_365");
  });

  it("0–2 days: every booking raises, and a strong date raises more", () => {
    expect(decideDate(input({ daysOut: 1, occupancyPct: 70, pickup24h: 1 }), settings()).direction).toBe("increase");
    const two = decideDate(input({ daysOut: 1, occupancyPct: 70, pickup24h: 2 }), settings()).movement;
    const one = decideDate(input({ daysOut: 1, occupancyPct: 70, pickup24h: 1 }), settings()).movement;
    expect(two).toBeGreaterThan(one);
    expect(decideDate(input({ daysOut: 1, occupancyPct: 92, roomsRemaining: 2, pickup24h: 1 }), settings()).movement)
      .toBeGreaterThanOrEqual(one);
  });

  it("0–2 days: no booking for six hours marks down by occupancy band", () => {
    const base = { daysOut: 1, hoursSinceLastPickup: 8 } as Partial<DecisionInput>;
    expect(decideDate(input({ ...base, occupancyPct: 40 }), settings()).movement).toBe(-5);
    expect(decideDate(input({ ...base, occupancyPct: 65 }), settings()).movement).toBe(-3);
    expect(decideDate(input({ ...base, occupancyPct: 85, roomsRemaining: 3 }), settings()).blocked).toBe(true);
  });

  it("0–2 days: the wait must actually elapse", () => {
    const d = decideDate(input({ daysOut: 1, occupancyPct: 40, hoursSinceLastPickup: 2 }), settings());
    expect(d.reason).toBe("awaiting_no_pickup_window");
  });

  it("3–7 days: 12-hour wait, and 85% occupancy with pickup raises €8", () => {
    expect(decideDate(input({ daysOut: 5, occupancyPct: 40, hoursSinceLastPickup: 6 }), settings()).reason)
      .toBe("awaiting_no_pickup_window");
    expect(decideDate(input({ daysOut: 5, occupancyPct: 40, hoursSinceLastPickup: 13 }), settings()).movement).toBe(-5);
    expect(decideDate(input({ daysOut: 5, occupancyPct: 88, roomsRemaining: 3, pickup24h: 1 }), settings()).direction).toBe("increase");
  });

  it("8–30 days: the pickup ladder grows with the number of bookings", () => {
    const one = decideDate(input({ daysOut: 20, pickup24h: 1 }), settings()).movement;
    const two = decideDate(input({ daysOut: 20, pickup24h: 2 }), settings()).movement;
    const four = decideDate(input({ daysOut: 20, pickup24h: 4 }), settings()).movement;
    expect(one).toBeGreaterThan(0);
    expect(two).toBeGreaterThanOrEqual(one);
    expect(four).toBeGreaterThanOrEqual(two);
  });

  it("8–30 days: markdown needs a real pace gap, and stops on low inventory", () => {
    expect(decideDate(input({ daysOut: 20, occupancyPct: 68, hoursSinceLastPickup: 100 }), settings()).reason).toBe("on_pace");
    expect(decideDate(input({ daysOut: 20, occupancyPct: 55, hoursSinceLastPickup: 100 }), settings()).movement).toBe(-3);
    expect(decideDate(input({ daysOut: 20, occupancyPct: 45, hoursSinceLastPickup: 100 }), settings()).movement).toBe(-5);
    expect(decideDate(input({ daysOut: 20, occupancyPct: 45, roomsRemaining: 4, hoursSinceLastPickup: 100 }), settings()).reason)
      .toBe("low_inventory");
  });

  it("31–90 days: needs 72h of silence, a 15-point gap and a price above anchor", () => {
    const base = { daysOut: 60, occupancyPct: 30, currentPrice: 180, anchorPrice: 150 } as Partial<DecisionInput>;
    expect(decideDate(input({ ...base, hoursSinceLastPickup: 40 }), settings()).reason).toBe("awaiting_no_pickup_window");
    expect(decideDate(input({ ...base, hoursSinceLastPickup: 80 }), settings()).movement).toBe(-3);
    expect(decideDate(input({ ...base, hoursSinceLastPickup: 80, occupancyPct: 20 }), settings()).movement).toBe(-5);
    expect(decideDate(input({ ...base, hoursSinceLastPickup: 80, currentPrice: 140 }), settings()).reason).toBe("at_anchor");
  });

  it("31–90 days: only one decrease every 48 hours", () => {
    const d = decideDate(input({
      daysOut: 60, occupancyPct: 20, hoursSinceLastPickup: 80,
      lastDecreaseAt: "2026-08-28T20:00:00Z", lastDirection: "decrease", lastDecisionAt: "2026-08-28T20:00:00Z",
    }), settings());
    expect(d.reason).toBe("decrease_frequency");
  });

  it("31–90 days: crossing 60% occupancy gives one €5 lift", () => {
    const d = decideDate(input({ daysOut: 60, occupancyPct: 62, crossed60Occupancy: true, hoursSinceLastPickup: 200 }), settings());
    expect(d.movement).toBe(5);
    expect(d.reason).toBe("occupancy_crossing");
  });

  it("91–180 days: long-lead bookings pay a real surcharge, and no hourly markdown", () => {
    expect(decideDate(input({ daysOut: 120, pickup24h: 1 }), settings()).movement).toBeGreaterThanOrEqual(12);
    expect(decideDate(input({ daysOut: 120, pickup24h: 2 }), settings()).movement).toBeGreaterThanOrEqual(18);
    expect(decideDate(input({ daysOut: 120, occupancyPct: 5, hoursSinceLastPickup: 30 }), settings()).reason)
      .toBe("far_out_no_markdown");
    expect(decideDate(input({ daysOut: 120, occupancyPct: 5, hoursSinceLastPickup: 200, currentPrice: 180 }), settings()).movement)
      .toBe(-3);
  });

  it("181+ days never marks down and pays the top of the ladder", () => {
    expect(decideDate(input({ daysOut: 240, occupancyPct: 0, hoursSinceLastPickup: 5000 }), settings()).reason)
      .toBe("far_out_no_markdown");
    const one = decideDate(input({ daysOut: 240, pickup24h: 1 }), settings()).movement;
    const two = decideDate(input({ daysOut: 240, pickup24h: 2 }), settings()).movement;
    expect(one).toBeGreaterThanOrEqual(20);
    expect(two).toBeGreaterThanOrEqual(one);
  });
});

describe("genuine pickup and cancellations", () => {
  it("cancellations are netted off pickup before anything moves", () => {
    const d = decideDate(input({ daysOut: 20, pickup24h: 2, cancellations24h: 2, hoursSinceLastPickup: 1 }), settings());
    expect(d.direction).not.toBe("increase");
  });

  it("a cancellation never triggers an instant cut", () => {
    const d = decideDate(input({
      daysOut: 20, occupancyPct: 45, hoursSinceLastPickup: 30,
      lastCancellationAt: "2026-08-29T09:40:00Z",
    }), settings());
    expect(d.reason).toBe("cancellation_cooldown");
  });

  it("pickup is always considered before any markdown branch", () => {
    const d = decideDate(input({ daysOut: 20, occupancyPct: 20, hoursSinceLastPickup: 0.2, pickup24h: 1 }), settings());
    expect(d.direction).toBe("increase");
  });
});

describe("safety rails", () => {
  it("sold-out dates hold their closing price", () => {
    expect(decideDate(input({ pickup24h: 3, roomsRemaining: 0 }), settings()).reason).toBe("sold_out");
    expect(decideDate(input({ pickup24h: 3, occupancyPct: 99 }), settings()).reason).toBe("sold_out");
  });

  it("a manual edit blocks a markdown", () => {
    const d = decideDate(input({ pickup24h: 0, occupancyPct: 10, manualHoldUntil: "2026-08-30T10:00:00Z" }), settings());
    expect(d.reason).toBe("manual_hold");
  });

  it("genuine pickup may still lift a softly held date", () => {
    const d = decideDate(input({ pickup24h: 3, manualHoldUntil: "2026-08-30T10:00:00Z" }), settings());
    expect(d.reason).toBe("genuine_pickup");
    expect(d.direction).toBe("increase");
  });

  it("a hard lock blocks every move, pickup included", () => {
    const d = decideDate(
      input({ pickup24h: 3, manualHoldUntil: "2026-08-30T10:00:00Z", holdKind: "hard" }),
      settings(),
    );
    expect(d.reason).toBe("manual_lock");
    expect(d.direction).toBe("hold");
  });

  it("stale data can never move a price", () => {
    expect(decideDate(input({ pickup24h: 3, dataStale: true }), settings()).reason).toBe("stale_data");
  });

  it("a date cannot reverse direction inside the cooldown without new demand", () => {
    const d = decideDate(input({
      daysOut: 20, occupancyPct: 45, hoursSinceLastPickup: 100,
      lastDirection: "increase", lastDecisionAt: "2026-08-29T08:00:00Z",
    }), settings());
    expect(d.reason).toBe("direction_cooldown");
  });

  it("the daily allowance is spent per date and per direction", () => {
    const allowance = decideDate(input({ daysOut: 20, pickup24h: 4 }), settings()).dailyAllowanceEur
      ?? decideDate(input({ daysOut: 20, pickup24h: 4 }), settings()).movement;
    const spent = decideDate(input({ daysOut: 20, pickup24h: 4, movedUpTodayEur: allowance + 10 }), settings());
    expect(spent.reason).toBe("daily_budget_spent");
  });

  it("rejects movements under the €3 minimum", () => {
    const d = decideDate(input({ daysOut: 20, pickup24h: 1, currentPrice: 499, maxPrice: 500 }), settings());
    expect(d.reason).toBe("below_min_movement");
  });

  it("every produced price is a whole euro", () => {
    const d = decideDate(input({ daysOut: 20, pickup24h: 2, currentPrice: 180 }), settings());
    expect(Number.isInteger(d.targetPrice!)).toBe(true);
    expect(Number.isInteger(d.movement)).toBe(true);
    expect(() => assertWholeEuro([180, 188])).not.toThrow();
    expect(() => assertWholeEuro([180.5])).toThrow();
  });

  it("child cells are validated independently against their own bounds", () => {
    const violations = validateCells([
      { stay_date: "2026-09-15", obk_id: "a", room_type_name: "Twin", occupancy: 2, old_price: 180, new_price: 188, currency: "EUR", min_price: 110, max_price: 350 },
      { stay_date: "2026-09-15", obk_id: "a", room_type_name: "Twin", occupancy: 1, old_price: 160, new_price: 100, currency: "EUR", min_price: 110, max_price: 350 },
      { stay_date: "2026-09-15", obk_id: "a", room_type_name: "Twin", occupancy: 3, old_price: 200, new_price: 208.5, currency: "EUR", min_price: 110, max_price: 350 },
    ]);
    expect(violations.map((v) => v.problem)).toEqual(["below_floor", "fractional"]);
  });

  it("a price that was already below its floor is not blocked while it climbs back", () => {
    const climbing = validateCells([
      { stay_date: "2026-09-01", obk_id: "a", room_type_name: "Deluxe Queen Room", occupancy: 1, old_price: 85, new_price: 91, currency: "EUR", min_price: 110, max_price: 350 },
    ]);
    expect(climbing).toEqual([]);

    const sinking = validateCells([
      { stay_date: "2026-09-01", obk_id: "a", room_type_name: "Deluxe Queen Room", occupancy: 1, old_price: 100, new_price: 91, currency: "EUR", min_price: 110, max_price: 350 },
    ]);
    expect(sinking.map((v) => v.problem)).toEqual(["below_floor"]);
  });

  it("repairs legacy below-floor cells without changing the shared date step", () => {
    const oldPrices = [85, 116, 140];
    const step = 6;
    const nextPrices = oldPrices.map((price) => price + step);
    expect(nextPrices.map((price, index) => price - oldPrices[index])).toEqual([6, 6, 6]);
    expect(validateCells([
      { stay_date: "2026-09-01", obk_id: "a", room_type_name: "Deluxe Queen Room", occupancy: 1, old_price: 85, new_price: 91, currency: "EUR", min_price: 100, max_price: 500 },
      { stay_date: "2026-09-01", obk_id: "b", room_type_name: "Economy", occupancy: 2, old_price: 116, new_price: 122, currency: "EUR", min_price: 110, max_price: 500 },
      { stay_date: "2026-09-01", obk_id: "c", room_type_name: "Triple", occupancy: 3, old_price: 140, new_price: 146, currency: "EUR", min_price: 130, max_price: 500 },
    ])).toEqual([]);
  });
});

describe("events and market validation", () => {
  it("an event lifts a date once and only upwards", () => {
    const plain = decideDate(input({ daysOut: 20, pickup24h: 1 }), settings());
    const up = decideDate(input({ daysOut: 20, pickup24h: 1, pendingEventUplift: 5 }), settings());
    expect(up.movement).toBe(plain.movement + 5);
    expect(up.reason).toContain("event");
    const down = decideDate(input({ daysOut: 20, occupancyPct: 45, hoursSinceLastPickup: 30, pendingEventUplift: 10 }), settings());
    expect(down.movement).toBeLessThan(0);
  });

  it("duplicate event listings collapse to one key", () => {
    const a = eventKeyOf({ id: "1", title: "Sziget Festival", city: "Budapest", venue: "Óbudai-sziget" }, "2026-09-15");
    const b = eventKeyOf({ id: "2", title: "sziget  festival!", city: "budapest", venue: "Óbudai-sziget" }, "2026-09-15");
    expect(a).toBe(b);
  });

  it("rejects corrupted or empty event titles", () => {
    expect(eventTitleUsable("Sziget Festival")).toBe(true);
    expect(eventTitleUsable("Ã©vad nyitÃ¡s")).toBe(false);
    expect(eventTitleUsable("")).toBe(false);
  });

  it("needs four distinct fresh competitors, outliers removed", () => {
    const obs = (id: string, rate: number, hoursAgo = 1) => ({
      competitor_id: id, stay_date: "2026-09-15", rate,
      captured_at: new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString(),
    });
    const thin = buildMarketSignal([obs("a", 200), obs("b", 210), obs("c", 190)], NOW);
    expect(thin.median).toBeNull();
    expect(thin.rejected).toBe("too_few_competitors");

    // The same competitor scraped ten times is still one competitor.
    const dupes = buildMarketSignal([obs("a", 200), obs("a", 205), obs("a", 210), obs("a", 215)], NOW);
    expect(dupes.median).toBeNull();

    const good = buildMarketSignal(
      [obs("a", 200), obs("b", 210), obs("c", 190), obs("d", 205), obs("e", 4000)],
      NOW,
    );
    expect(good.sampleSize).toBe(4);
    expect(good.median).toBe(202.5);

    const stale = buildMarketSignal([obs("a", 200, 40), obs("b", 210, 40), obs("c", 190, 40), obs("d", 205, 40)], NOW);
    expect(stale.median).toBeNull();
  });

  it("caps increases at the validated market median multiple", () => {
    const market = { median: 200, sampleSize: 5, ageHours: 2 };
    expect(marketCeiling(market, 40, false, DEFAULT_MARKET_VALIDATION)).toBe(250);
    expect(marketCeiling(market, 90, true, DEFAULT_MARKET_VALIDATION)).toBe(280);
    const d = decideDate(input({ daysOut: 20, pickup24h: 4, currentPrice: 246, market }), settings());
    expect(d.targetPrice).toBeLessThanOrEqual(250);
  });

  it("ignores the market entirely when the evidence is thin", () => {
    const plain = decideDate(input({ daysOut: 20, pickup24h: 4, currentPrice: 300 }), settings());
    const d = decideDate(input({ daysOut: 20, pickup24h: 4, currentPrice: 300, market: { median: 100, sampleSize: 2, ageHours: 1 } }), settings());
    expect(d.targetPrice).toBe(plain.targetPrice);
  });
});

describe("pace targets and explanations", () => {
  it("reads the target from the configured band", () => {
    expect(paceTargetFor(1, PACE)).toBe(92);
    expect(paceTargetFor(45, PACE)).toBe(50);
    expect(paceTargetFor(999, PACE)).toBeNull();
  });

  it("explains a move in plain words", () => {
    const d = decideDate(input({ daysOut: 20, pickup24h: 2 }), settings());
    expect(explainDecision(d)).toContain(`€180 → €${d.targetPrice}`);
  });
});

describe("automatic activation, watchdog and supervised caps", () => {
  const clean = {
    shadowHours: 25, runsTotal: 24, runsFailed: 0, datesEvaluated: 300,
    datesIncreased: 40, datesDecreased: 8, allWholeEuro: true, allWithinBounds: true,
    noDualDirection: true, noBudgetBreach: true, sellableRooms: 21, expectedRooms: 21,
    childCellsConsistent: true, noStaleDecisions: true,
  };

  it("activates automatically after a clean 24 hours", () => {
    expect(evaluateGates(clean).passed).toBe(true);
  });

  it("stays in shadow when inventory is wrong", () => {
    const gate = evaluateGates({ ...clean, sellableRooms: 63 });
    expect(gate.passed).toBe(false);
    expect(gate.failing).toContain("inventory_correct");
  });

  it("stays in shadow on a fractional price, a bound breach or a failed run", () => {
    expect(evaluateGates({ ...clean, allWholeEuro: false }).failing).toContain("whole_euro_only");
    expect(evaluateGates({ ...clean, allWithinBounds: false }).failing).toContain("within_floor_and_ceiling");
    expect(evaluateGates({ ...clean, runsFailed: 1 }).failing).toContain("runs_healthy");
    expect(evaluateGates({ ...clean, shadowHours: 12 }).failing).toContain("shadow_24h_complete");
    expect(evaluateGates({ ...clean, childCellsConsistent: false }).failing).toContain("child_cells_consistent");
  });

  it("a markdown flood keeps the engine in shadow", () => {
    expect(evaluateGates({ ...clean, datesEvaluated: 219, datesIncreased: 2, datesDecreased: 500 }).failing)
      .toContain("markdown_share_sane");
  });

  it("a quiet far-out calendar drifting down does not block activation", () => {
    expect(evaluateGates({ ...clean, datesEvaluated: 219, datesIncreased: 11, datesDecreased: 56 }).failing)
      .not.toContain("markdown_share_sane");
  });

  const quiet = {
    liveHours: 10, fractionalPrices: 0, boundsBreaches: 0, staleDataDecisions: 0,
    overlappingRuns: 0, consecutiveTimeouts: 0, repeatedEventUplifts: 0,
    dualDirectionDates: 0, previoRejections: 0, mappingErrors: 0,
  };

  it("the watchdog pauses on any critical condition", () => {
    expect(evaluateWatchdog(quiet).pause).toBe(false);
    expect(evaluateWatchdog({ ...quiet, fractionalPrices: 1 }).pause).toBe(true);
    expect(evaluateWatchdog({ ...quiet, dualDirectionDates: 1 }).reason).toContain("both directions");
    expect(evaluateWatchdog({ ...quiet, boundsBreaches: 2 }).pause).toBe(true);
  });

  it("halves the movement allowances for the first 48 live hours", () => {
    expect(supervisedCaps(15, 5, true)).toEqual({ maxIncrease: 7, maxDecrease: 3 });
    expect(supervisedCaps(15, 5, false)).toEqual({ maxIncrease: 15, maxDecrease: 5 });
    expect(evaluateWatchdog({ ...quiet, liveHours: 60 }).supervised).toBe(false);
  });
});

describe("the configured window rules are the agreed ones", () => {
  it("carries the exact caps and waits from the brief", () => {
    const byId = Object.fromEntries(OTTOFIORI_WINDOW_RULES.map((w) => [w.id, w]));
    expect(byId.w0_2.no_pickup_wait_hours).toBe(6);
    expect(byId.w3_7.no_pickup_wait_hours).toBe(12);
    expect(byId.w8_30.no_pickup_wait_hours).toBe(24);
    expect(byId.w31_90.no_pickup_wait_hours).toBe(72);
    expect(byId.w181_365.no_pickup_wait_hours).toBeNull();
    expect(byId.w181_365.max_daily_decrease).toBe(0);
    expect(byId.w0_2.max_daily_decrease).toBe(15);
    expect(byId.w8_30.max_daily_increase).toBe(15);
  });
});

describe("a stay date moves as one block", () => {
  const cells = (...allowed: number[]) => allowed.map((a, i) => ({ room_type_name: `RT${i}`, allowed: a }));

  it("measures how far a cell can still move", () => {
    expect(headroom({ min: 100, max: 200, source: "test" }, 180, 1)).toBe(20);
    expect(headroom({ min: 100, max: 200, source: "test" }, 180, -1)).toBe(80);
    expect(headroom({ min: 100, max: 200, source: "test" }, 200, 1)).toBe(0);
    expect(headroom({ min: 100, max: 200, source: "test" }, 180, 0)).toBe(0);
  });

  it("gives every room type the full step when all have room", () => {
    expect(uniformDateStep(cells(50, 40, 30), 10, 3)).toEqual({ step: 10, limitedBy: null, held: false });
  });

  it("throttles the whole date to the tightest room type", () => {
    expect(uniformDateStep(cells(50, 6, 30), 10, 3)).toEqual({ step: 6, limitedBy: "RT1", held: false });
  });

  it("holds the entire date when one room type has no headroom", () => {
    const r = uniformDateStep(cells(50, 0, 30), 10, 3);
    expect(r.held).toBe(true);
    expect(r.step).toBe(0);
    expect(r.limitedBy).toBe("RT1");
  });

  it("holds rather than publishing below the minimum movement", () => {
    expect(uniformDateStep(cells(2), 10, 3).held).toBe(true);
  });

  it("holds a date with no priceable cells", () => {
    expect(uniformDateStep([], 10, 3)).toEqual({ step: 0, limitedBy: null, held: true });
  });

  it("never lets one room type move while another stays put", () => {
    const allowed = [12, 4, 9];
    const { step, held } = uniformDateStep(cells(...allowed), 12, 3);
    expect(held).toBe(false);
    expect(allowed.every((a) => a >= step)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Fill mode: push occupancy near arrival without giving the rate away.
// ---------------------------------------------------------------------------

const FILL = { enabled: true, windowDays: 60, maxTotalDropPct: 15 };

describe("fill mode", () => {
  it("marks a date down that is behind pace, where the ordinary rules would hold", () => {
    const base = input({ daysOut: 17, occupancyPct: 60, roomsRemaining: 9, hoursSinceLastPickup: 100 });
    const ordinary = decideDate(base, settings());
    const filling = decideDate({ ...base, campaignStartPrice: 180 }, settings({ fill: FILL }));
    expect(ordinary.blocked || ordinary.direction === "decrease").toBe(true);
    expect(filling.blocked).toBe(false);
    expect(filling.direction).toBe("decrease");
  });

  it("still lifts the price the moment a genuine booking lands", () => {
    const d = decideDate(
      input({ daysOut: 17, occupancyPct: 60, pickup24h: 2, pickup1h: 1, hoursSinceLastPickup: 0.5, campaignStartPrice: 180 }),
      settings({ fill: FILL }),
    );
    expect(d.blocked).toBe(false);
    expect(d.direction).toBe("increase");
  });

  it("never takes a date more than the total drop limit below its campaign start", () => {
    const d = decideDate(
      input({ daysOut: 5, occupancyPct: 40, currentPrice: 155, campaignStartPrice: 180, hoursSinceLastPickup: 100 }),
      settings({ fill: FILL }),
    );
    // Floor is 180 - 15% = 153, so at most €2 is left — under the minimum move.
    expect(d.blocked).toBe(true);
    expect(d.reason).toBe("below_min_movement");
  });

  it("leaves dates outside the fill window on the ordinary rules", () => {
    const patch = { daysOut: 120, occupancyPct: 10, hoursSinceLastPickup: 200, campaignStartPrice: 180 };
    expect(decideDate(input(patch), settings({ fill: FILL })))
      .toEqual(decideDate(input(patch), settings()));
  });

  it("protects a nearly full date even while filling", () => {
    const d = decideDate(
      input({ daysOut: 4, occupancyPct: 96, roomsRemaining: 1, hoursSinceLastPickup: 100, campaignStartPrice: 180 }),
      settings({ fill: FILL }),
    );
    expect(d.blocked).toBe(true);
  });

  it("is off unless the property switches it on", () => {
    const patch = { daysOut: 17, occupancyPct: 60, hoursSinceLastPickup: 30 };
    expect(decideDate(input(patch), settings({ fill: { ...FILL, enabled: false } })))
      .toEqual(decideDate(input(patch), settings()));
  });
});

describe("ADR-first rules", () => {
  it("lifts a date sitting below the grid price needed to bank the ADR target", () => {
    const d = decideDate(
      input({ currentPrice: 114, occupancyPct: 40, hardAdrFloor: 158, maxPrice: 500 }),
      settings(),
    );
    expect(d.blocked).toBe(false);
    expect(d.direction).toBe("increase");
    expect(d.reason).toBe("net_adr_floor");
    expect(d.targetPrice).toBe(158);
  });

  it("raises a well-selling date on occupancy alone, with no new pickup", () => {
    const d = decideDate(
      input({ daysOut: 17, currentPrice: 114, occupancyPct: 86, hoursSinceLastPickup: 300 }),
      settings(),
    );
    expect(d.reason).toBe("occupancy_lift");
    expect(d.movement).toBeGreaterThanOrEqual(9);
  });

  it("freezes markdowns for a month that is behind its rate target", () => {
    const d = decideDate(
      input({ daysOut: 124, occupancyPct: 5, hoursSinceLastPickup: 400, monthMarkdownsFrozen: true }),
      settings(),
    );
    expect(d.blocked).toBe(true);
    expect(d.reason).toBe("month_adr_pace");
  });

  it("never marks down a date that just took a booking", () => {
    const d = decideDate(
      input({ daysOut: 20, occupancyPct: 45, hoursSinceLastPickup: 30, pickup24h: 0 }),
      settings(),
    );
    expect(d.blocked).toBe(true);
    expect(d.reason).toBe("booked_date_brake");
  });

  it("holds the sold price through the rebooking window after a cancellation", () => {
    const d = decideDate(
      input({
        daysOut: 124, occupancyPct: 5, hoursSinceLastPickup: 400,
        lastCancellationAt: new Date(NOW.getTime() - 3 * 3_600_000).toISOString(),
      }),
      settings(),
    );
    expect(d.blocked).toBe(true);
    expect(d.reason).toBe("rebook_window");
  });

  it("allows only one markdown per date per day", () => {
    const d = decideDate(
      input({ daysOut: 124, occupancyPct: 5, hoursSinceLastPickup: 400, markdownsToday: 1 }),
      settings(),
    );
    expect(d.reason).toBe("markdown_limit");
  });

  it("never cuts a date back on a day it already went up", () => {
    const d = decideDate(
      input({ daysOut: 124, occupancyPct: 5, hoursSinceLastPickup: 400, movedUpTodayEur: 8 }),
      settings(),
    );
    expect(d.reason).toBe("one_way_day");
  });

  it("stops a markdown at the month floor and at the recent-peak depth floor", () => {
    const d = decideDate(
      input({
        daysOut: 124, occupancyPct: 5, hoursSinceLastPickup: 400,
        currentPrice: 150, monthFloor: 149, minPrice: 110, anchorPrice: 120,
      }),
      settings(),
    );
    expect(d.blocked).toBe(true);
    expect(["below_min_movement", "month_adr_pace", "bounds_headroom"]).toContain(d.reason);
  });
});
