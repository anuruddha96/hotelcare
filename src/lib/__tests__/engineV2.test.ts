import { describe, it, expect } from "vitest";
import {
  decideDate,
  paceTargetFor,
  paceStep,
  windowFor,
  marketCeiling,
  DEFAULT_DECISION_SETTINGS,
  DEFAULT_WINDOW_RULES,
  DEFAULT_MARKET_VALIDATION,
  type DecisionInput,
  type DecisionSettings,
  type PaceBand,
} from "../../../supabase/functions/_shared/engineV2";

const NOW = new Date("2026-03-01T10:00:00Z");

const BANDS: PaceBand[] = [
  { min_days_out: 0, max_days_out: 1, target_occupancy_pct: 92 },
  { min_days_out: 2, max_days_out: 3, target_occupancy_pct: 85 },
  { min_days_out: 4, max_days_out: 7, target_occupancy_pct: 75 },
  { min_days_out: 8, max_days_out: 14, target_occupancy_pct: 65 },
  { min_days_out: 15, max_days_out: 30, target_occupancy_pct: 50 },
  { min_days_out: 31, max_days_out: 60, target_occupancy_pct: 35 },
  { min_days_out: 61, max_days_out: 90, target_occupancy_pct: 20 },
  { min_days_out: 91, max_days_out: 365, target_occupancy_pct: 8 },
];

const settings = (over: Partial<DecisionSettings> = {}): DecisionSettings => ({
  ...DEFAULT_DECISION_SETTINGS,
  now: NOW,
  paceBands: BANDS,
  ...over,
});

const input = (over: Partial<DecisionInput> = {}): DecisionInput => ({
  stayDate: "2026-03-20",
  daysOut: 19,
  currentPrice: 150,
  occupancyPct: 50,
  roomsSold: 10,
  roomsRemaining: 11,
  pickup1h: 0,
  pickup24h: 0,
  pickup48h: 0,
  pickup7d: 0,
  cancellations24h: 0,
  lastCancellationAt: null,
  lastDirection: null,
  lastDecisionAt: null,
  movedTodayEur: 0,
  manualHoldUntil: null,
  minPrice: 110,
  maxPrice: 500,
  pendingEventUplift: 0,
  market: { median: null, sampleSize: 0, ageHours: null },
  ...over,
});

describe("pace targets and windows", () => {
  it("maps lead time to the right target", () => {
    expect(paceTargetFor(0, BANDS)).toBe(92);
    expect(paceTargetFor(20, BANDS)).toBe(50);
    expect(paceTargetFor(120, BANDS)).toBe(8);
    expect(paceTargetFor(900, BANDS)).toBeNull();
  });

  it("uses tighter steps far out and forbids long-lead markdowns", () => {
    expect(windowFor(2, DEFAULT_WINDOW_RULES).max_step).toBe(10);
    const far = windowFor(200, DEFAULT_WINDOW_RULES);
    expect(far.allow_decrease).toBe(false);
    expect(far.max_daily).toBe(5);
  });

  it("scales the step with the size of the pace gap", () => {
    const w = windowFor(20, DEFAULT_WINDOW_RULES);
    expect(paceStep(5, w)).toBe(0);
    expect(paceStep(15, w)).toBeGreaterThan(0);
    expect(paceStep(40, w)).toBe(w.max_step);
    expect(paceStep(-40, w)).toBe(-w.max_step);
  });
});

describe("holds", () => {
  it("holds a sold-out date", () => {
    const d = decideDate(input({ roomsRemaining: 0 }), settings());
    expect(d.blocked).toBe(true);
    expect(d.reason).toBe("sold_out");
  });

  it("holds a date a person just repriced", () => {
    const d = decideDate(input({ manualHoldUntil: "2026-03-02T10:00:00Z", occupancyPct: 5 }), settings());
    expect(d.reason).toBe("manual_hold");
  });

  it("holds when occupancy sits on the target", () => {
    const d = decideDate(input({ occupancyPct: 52 }), settings());
    expect(d.reason).toBe("on_pace");
    expect(d.movement).toBe(0);
  });

  it("never marks down a date that took a booking in the last 48h", () => {
    const d = decideDate(input({ occupancyPct: 20, pickup48h: 1 }), settings());
    expect(d.reason).toBe("recent_pickup");
    expect(d.movement).toBe(0);
  });

  it("waits after a cancellation before marking down", () => {
    const d = decideDate(
      input({ occupancyPct: 20, lastCancellationAt: "2026-03-01T09:45:00Z" }),
      settings({ cancellationWaitMinutes: 60 }),
    );
    expect(d.reason).toBe("cancellation_cooldown");
  });

  it("refuses to flip direction inside the cooldown", () => {
    const d = decideDate(
      input({ occupancyPct: 20, lastDirection: "increase", lastDecisionAt: "2026-03-01T07:00:00Z" }),
      settings({ directionChangeHours: 6 }),
    );
    expect(d.reason).toBe("direction_cooldown");
  });

  it("stops once the date has spent its daily budget", () => {
    const d = decideDate(input({ occupancyPct: 20, movedTodayEur: 12 }), settings());
    expect(d.reason).toBe("daily_budget_spent");
  });

  it("skips changes smaller than the minimum movement", () => {
    const d = decideDate(input({ occupancyPct: 20, currentPrice: 111 }), settings({ minMovementEur: 3 }));
    expect(d.reason).toBe("below_min_movement");
  });

  it("holds a long-lead date instead of marking it down", () => {
    const d = decideDate(input({ daysOut: 70, occupancyPct: 0, currentPrice: 150 }), settings());
    expect(d.blocked).toBe(true);
    expect(d.reason).toBe("window_blocks_decrease");
  });
});

describe("movements", () => {
  it("raises the price on genuine pickup", () => {
    const d = decideDate(input({ pickup24h: 3, pickup48h: 3, occupancyPct: 55 }), settings());
    expect(d.direction).toBe("increase");
    expect(d.reason).toBe("genuine_pickup");
    expect(d.targetPrice).toBeGreaterThan(150);
  });

  it("does not treat cancelled-out pickup as demand", () => {
    const d = decideDate(input({ pickup24h: 3, pickup48h: 3, cancellations24h: 3, occupancyPct: 52 }), settings());
    expect(d.direction).toBe("hold");
  });

  it("marks down only when behind pace with no bookings", () => {
    const d = decideDate(input({ occupancyPct: 20 }), settings());
    expect(d.direction).toBe("decrease");
    expect(d.reason).toBe("behind_pace");
    expect(d.targetPrice).toBeLessThan(150);
  });

  it("raises the price when well ahead of pace", () => {
    const d = decideDate(input({ occupancyPct: 85 }), settings());
    expect(d.direction).toBe("increase");
    expect(d.reason).toBe("ahead_of_pace");
  });

  it("never breaks the floor", () => {
    const d = decideDate(input({ occupancyPct: 5, currentPrice: 113, minPrice: 110 }), settings());
    expect(d.targetPrice).toBeGreaterThanOrEqual(110);
  });

  it("never breaks the ceiling", () => {
    const d = decideDate(input({ occupancyPct: 95, currentPrice: 498, maxPrice: 500, roomsRemaining: 4 }), settings());
    expect(d.targetPrice == null || d.targetPrice <= 500).toBe(true);
  });

  it("always produces whole euros", () => {
    for (const price of [111, 137, 199, 233]) {
      for (const occ of [5, 20, 50, 80, 95]) {
        const d = decideDate(input({ currentPrice: price, occupancyPct: occ, pickup24h: occ > 60 ? 3 : 0 }), settings());
        if (d.targetPrice != null) expect(Number.isInteger(d.targetPrice)).toBe(true);
        expect(Number.isInteger(d.movement)).toBe(true);
      }
    }
  });

  it("keeps a single step inside the window cap", () => {
    const d = decideDate(input({ daysOut: 20, occupancyPct: 0, currentPrice: 400 }), settings());
    expect(Math.abs(d.movement)).toBeLessThanOrEqual(windowFor(20, DEFAULT_WINDOW_RULES).max_step);
  });

  it("adds an event uplift once, upwards only", () => {
    const withEvent = decideDate(input({ occupancyPct: 85, pendingEventUplift: 20 }), settings());
    const without = decideDate(input({ occupancyPct: 85 }), settings());
    expect(withEvent.movement).toBeGreaterThanOrEqual(without.movement);
  });
});

describe("market validation", () => {
  it("ignores thin or stale competitor evidence", () => {
    expect(marketCeiling({ median: 100, sampleSize: 2, ageHours: 1 }, 50, DEFAULT_MARKET_VALIDATION)).toBeNull();
    expect(marketCeiling({ median: 100, sampleSize: 8, ageHours: 90 }, 50, DEFAULT_MARKET_VALIDATION)).toBeNull();
  });

  it("caps an increase against a solid market median", () => {
    const d = decideDate(
      input({ occupancyPct: 85, currentPrice: 150, market: { median: 100, sampleSize: 8, ageHours: 2 } }),
      settings(),
    );
    // 140% of 100 = 140, already below the live price, so no rise is allowed.
    expect(d.direction).toBe("hold");
  });
});

describe("regression: the Ottofiori runaway", () => {
  it("cannot mark the same date down more than its daily budget", () => {
    let price = 300;
    let moved = 0;
    let lastDirection: "increase" | "decrease" | null = null;
    for (let run = 0; run < 24; run++) {
      const d = decideDate(
        input({ currentPrice: price, occupancyPct: 0, movedTodayEur: moved, lastDirection, lastDecisionAt: NOW.toISOString() }),
        settings(),
      );
      if (d.blocked) break;
      price = d.targetPrice!;
      moved += Math.abs(d.movement);
      lastDirection = d.direction as any;
    }
    expect(moved).toBeLessThanOrEqual(windowFor(19, DEFAULT_WINDOW_RULES).max_daily);
    expect(price).toBeGreaterThanOrEqual(110);
  });
});
