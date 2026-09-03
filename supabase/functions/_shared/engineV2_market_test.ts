import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  DEFAULT_DECISION_SETTINGS,
  decideDate,
  marketRebalanceCap,
  type DecisionInput,
  type DecisionSettings,
} from "./engineV2.ts";

const NOW = new Date("2026-09-03T19:15:00Z");

const settings: DecisionSettings = {
  ...DEFAULT_DECISION_SETTINGS,
  now: NOW,
  raiseOnAnyPickup: false,
  occupancyLiftEnabled: false,
  marketValidation: {
    min_competitors: 2,
    max_age_hours: 30,
    median_cap_low_occ_pct: 110,
    median_cap_high_occ_pct: 125,
  },
  paceBands: [
    { min_days_out: 0, max_days_out: 7, target_occupancy_pct: 88 },
    { min_days_out: 8, max_days_out: 14, target_occupancy_pct: 80 },
    { min_days_out: 15, max_days_out: 30, target_occupancy_pct: 72 },
    { min_days_out: 31, max_days_out: 60, target_occupancy_pct: 60 },
    { min_days_out: 61, max_days_out: 90, target_occupancy_pct: 40 },
  ],
  windowRules: [
    { id: "w0_2", min_days_out: 0, max_days_out: 2, no_pickup_wait_hours: 4, max_daily_decrease: 15, max_daily_increase: 8, min_hours_between_decreases: 0, require_above_anchor: false },
    { id: "w3_7", min_days_out: 3, max_days_out: 7, no_pickup_wait_hours: 6, max_daily_decrease: 10, max_daily_increase: 8, min_hours_between_decreases: 0, require_above_anchor: false },
    { id: "w8_30", min_days_out: 8, max_days_out: 30, no_pickup_wait_hours: 8, max_daily_decrease: 8, max_daily_increase: 8, min_hours_between_decreases: 2, require_above_anchor: false },
    { id: "w31_90", min_days_out: 31, max_days_out: 60, no_pickup_wait_hours: 18, max_daily_decrease: 6, max_daily_increase: 8, min_hours_between_decreases: 18, require_above_anchor: false },
    { id: "w31_90", min_days_out: 61, max_days_out: 90, no_pickup_wait_hours: 36, max_daily_decrease: 4, max_daily_increase: 8, min_hours_between_decreases: 36, require_above_anchor: true },
  ],
};

function input(patch: Partial<DecisionInput> = {}): DecisionInput {
  return {
    stayDate: "2026-10-10",
    daysOut: 37,
    currentPrice: 293,
    occupancyPct: 47.6,
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
    holdKind: null,
    minPrice: 100,
    maxPrice: 500,
    adrFloor: 150,
    anchorPrice: 121,
    crossed60Occupancy: false,
    pendingEventUplift: 0,
    market: { median: 182.5, sampleSize: 6, ageHours: 3 },
    campaignStartPrice: 293,
    hardAdrFloor: 100,
    monthFloor: 210,
    monthMarkdownsFrozen: true,
    recentPeakPrice: 293,
    markdownsToday: 0,
    ...patch,
  };
}

Deno.test("soft overpriced date uses validated competitor market to rebalance", () => {
  const decision = decideDate(input(), settings);
  assertEquals(marketRebalanceCap(input(), settings), 201);
  assertEquals(decision.direction, "decrease");
  assertEquals(decision.reason, "market_rebalance");
  assertEquals(decision.targetPrice! < 293, true);
});

Deno.test("one booking with soft occupancy holds instead of increasing", () => {
  const decision = decideDate(input({
    stayDate: "2026-09-16",
    daysOut: 13,
    currentPrice: 247,
    occupancyPct: 71.4,
    roomsRemaining: 6,
    pickup1h: 1,
    pickup6h: 1,
    pickup24h: 1,
    pickup48h: 1,
    pickup7d: 1,
    hoursSinceLastPickup: 0.5,
    market: { median: 186, sampleSize: 5, ageHours: 3 },
    monthMarkdownsFrozen: false,
    monthFloor: null,
  }), settings);
  assertEquals(decision.direction, "hold");
  assertEquals(decision.reason, "single_pickup_hold");
});

Deno.test("manager edit remains authoritative even when market says overpriced", () => {
  const decision = decideDate(input({
    manualHoldUntil: "2026-09-03T23:00:00Z",
    holdKind: "soft",
  }), settings);
  assertEquals(decision.direction, "hold");
  assertEquals(decision.reason, "manual_hold");
});
