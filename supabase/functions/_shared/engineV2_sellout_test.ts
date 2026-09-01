import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  DEFAULT_DECISION_SETTINGS,
  decideDate,
  finalSelloutStep,
  sameDayUrgencyStep,
  type DecisionInput,
  type DecisionSettings,
} from "./engineV2.ts";

// 11:30 UTC is 13:30 in Budapest on 1 September (CEST).
const NOW = new Date("2026-09-01T11:30:00Z");

const settings: DecisionSettings = {
  ...DEFAULT_DECISION_SETTINGS,
  now: NOW,
  paceBands: [
    { min_days_out: 0, max_days_out: 2, target_occupancy_pct: 100 },
    { min_days_out: 3, max_days_out: 7, target_occupancy_pct: 90 },
  ],
};

function input(patch: Partial<DecisionInput> = {}): DecisionInput {
  return {
    stayDate: "2026-09-01",
    daysOut: 0,
    currentPrice: 183,
    occupancyPct: 86,
    roomsSold: 18,
    roomsRemaining: 3,
    pickup1h: 0,
    pickup6h: 1,
    pickup24h: 4,
    pickup48h: 4,
    pickup7d: 4,
    cancellations24h: 1,
    hoursSinceLastPickup: 0.5,
    lastCancellationAt: null,
    lastDirection: "increase",
    lastDecisionAt: "2026-09-01T11:04:00Z",
    lastDecreaseAt: "2026-09-01T08:24:00Z",
    movedUpTodayEur: 37,
    movedDownTodayEur: 6,
    manualHoldUntil: null,
    holdKind: null,
    minPrice: 100,
    maxPrice: 400,
    adrFloor: 190,
    anchorPrice: 160,
    crossed60Occupancy: false,
    pendingEventUplift: 0,
    market: { median: null, sampleSize: 0, ageHours: null },
    campaignStartPrice: 183,
    hardAdrFloor: 190,
    monthFloor: 190,
    monthMarkdownsFrozen: true,
    recentPeakPrice: 183,
    markdownsToday: 2,
    ...patch,
  };
}

Deno.test("normal hourly engine leaves arrival today to the 30-minute worker", () => {
  const decision = decideDate(input(), settings);
  assertEquals(decision.direction, "hold");
  assertEquals(decision.movement, 0);
  assertEquals(decision.targetPrice, 183);
  assertEquals(decision.reason, "same_day_dedicated");
  assertEquals(decision.blocked, true);
});

Deno.test("arrival-day urgency strengthens with time and unsold inventory", () => {
  assertEquals(sameDayUrgencyStep(7 * 60, 3), 3);
  assertEquals(sameDayUrgencyStep(9 * 60, 3), 4);
  assertEquals(sameDayUrgencyStep(11 * 60, 3), 5);
  assertEquals(sameDayUrgencyStep(12 * 60 + 30, 3), 6);
  assertEquals(sameDayUrgencyStep(13 * 60 + 30, 3), 7);
  assertEquals(sameDayUrgencyStep(14 * 60 + 10, 3), 8);
  assertEquals(sameDayUrgencyStep(14 * 60 + 40, 3), 10);
  assertEquals(sameDayUrgencyStep(13 * 60 + 30, 5), 9);
  assertEquals(sameDayUrgencyStep(13 * 60 + 30, 1), 5);
});

Deno.test("arrival today stops automatic sellout pricing at 15:00 Budapest", () => {
  const afterCutoff: DecisionSettings = {
    ...settings,
    now: new Date("2026-09-01T13:05:00Z"), // 15:05 Budapest
  };
  const decision = decideDate(input(), afterCutoff);
  assertEquals(decision.direction, "hold");
  assertEquals(decision.reason, "same_day_cutoff");
});

Deno.test("legacy sellout helper still tempers tomorrow/day+2 moves", () => {
  assertEquals(finalSelloutStep(input({ pickup24h: 0, cancellations24h: 0, occupancyPct: 60 })), 5);
  assertEquals(finalSelloutStep(input({ pickup24h: 1, cancellations24h: 0, occupancyPct: 60 })), 4);
  assertEquals(finalSelloutStep(input({ pickup24h: 4, cancellations24h: 1, occupancyPct: 86 })), 3);
});

Deno.test("tomorrow and day+2 keep smart sellout markdowns while rooms remain", () => {
  const tomorrow = decideDate(input({
    stayDate: "2026-09-02",
    daysOut: 1,
    currentPrice: 170,
    occupancyPct: 70,
    roomsRemaining: 5,
    pickup24h: 0,
    cancellations24h: 0,
    movedUpTodayEur: 0,
    movedDownTodayEur: 0,
    lastDirection: null,
    lastDecisionAt: null,
    hardAdrFloor: 190,
    adrFloor: 190,
    monthFloor: 190,
    monthMarkdownsFrozen: true,
    recentPeakPrice: 170,
    markdownsToday: 0,
  }), settings);
  assertEquals(tomorrow.movement, -4);
  assertEquals(tomorrow.targetPrice, 166);

  const dayTwo = decideDate(input({
    stayDate: "2026-09-03",
    daysOut: 2,
    currentPrice: 165,
    occupancyPct: 95,
    roomsRemaining: 1,
    pickup24h: 3,
    cancellations24h: 0,
    movedUpTodayEur: 0,
    movedDownTodayEur: 0,
    lastDirection: null,
    lastDecisionAt: null,
    hardAdrFloor: 200,
    adrFloor: 200,
    monthFloor: 200,
    recentPeakPrice: 165,
    markdownsToday: 0,
  }), settings);
  assertEquals(dayTwo.movement, -3);
  assertEquals(dayTwo.targetPrice, 162);
});

Deno.test("tomorrow/day+2 sellout still respects explicit manual protection", () => {
  const decision = decideDate(input({
    stayDate: "2026-09-02",
    daysOut: 1,
    manualHoldUntil: "2026-09-01T13:00:00Z",
    holdKind: "soft",
  }), settings);
  assertEquals(decision.direction, "hold");
  assertEquals(decision.reason, "manual_hold");
});

Deno.test("day+3 keeps the ordinary pickup pricing logic", () => {
  const decision = decideDate(input({
    stayDate: "2026-09-04",
    daysOut: 3,
    currentPrice: 170,
    occupancyPct: 86,
    roomsRemaining: 3,
    pickup24h: 1,
    cancellations24h: 0,
    movedUpTodayEur: 0,
    movedDownTodayEur: 0,
    lastDirection: null,
    lastDecisionAt: null,
    lastDecreaseAt: null,
    hardAdrFloor: null,
    adrFloor: null,
    monthFloor: null,
    monthMarkdownsFrozen: false,
    recentPeakPrice: 170,
    markdownsToday: 0,
  }), settings);
  assertEquals(decision.direction, "increase");
  assertEquals(decision.movement, 9);
  assertEquals(decision.reason, "genuine_pickup");
});
