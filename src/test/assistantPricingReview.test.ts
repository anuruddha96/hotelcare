import { describe, expect, it } from "vitest";
import {
  buildPricingReview,
  classifyEventImpact,
  expectedOccupancyPct,
  MAX_PROPOSAL_NIGHTS,
  MAX_STEP_EUR,
  type ReviewDay,
} from "../../supabase/functions/_shared/pricingReview";

const TODAY = "2026-11-11";

function day(stay_date: string, occupancyPct: number, extra: Partial<ReviewDay> = {}): ReviewDay {
  const roomsAvailable = 40;
  return {
    stay_date,
    occupancyPct,
    roomsAvailable,
    roomsLeft: Math.round(roomsAvailable * (1 - occupancyPct / 100)),
    netPickup: 0,
    hasData: true,
    ...extra,
  };
}

function review(overrides: Partial<Parameters<typeof buildPricingReview>[0]>) {
  return buildPricingReview({
    today: TODAY,
    days: [],
    rates: [],
    competitorRates: [],
    competitorFresh: true,
    events: [],
    ...overrides,
  });
}

describe("pricing review", () => {
  it("uses the lowest published price of a date as the entry rate", () => {
    const result = review({
      days: [day("2026-11-20", 50)],
      rates: [
        { stay_date: "2026-11-20", price: 140 },
        { stay_date: "2026-11-20", price: 110 },
        { stay_date: "2026-11-20", price: null },
      ],
    });
    expect(result.dates[0].entry_rate).toBe(110);
  });

  it("raises on a high-impact event once demand confirms, and never above the step limit", () => {
    const result = review({
      days: [day("2026-12-05", 62, { netPickup: 4 })],
      rates: [{ stay_date: "2026-12-05", price: 300 }],
      competitorRates: [
        { stay_date: "2026-12-05", rate: 340 },
        { stay_date: "2026-12-05", rate: 360 },
      ],
      events: [{ title: "Christmas Market opening", event_date: "2026-12-04", end_date: "2026-12-06", expected_impact: "High" }],
    });
    const date = result.dates[0];
    expect(date.stance).toBe("raise");
    expect(date.suggested_delta_eur).toBe(MAX_STEP_EUR);
    expect(date.events).toEqual(["Christmas Market opening"]);
    expect(result.summary.high_impact_event_dates).toEqual(["2026-12-05"]);
  });

  it("holds an event date that already carries a large premium over the market", () => {
    const result = review({
      days: [day("2026-12-05", 70, { netPickup: 3 })],
      rates: [{ stay_date: "2026-12-05", price: 200 }],
      competitorRates: [
        { stay_date: "2026-12-05", rate: 140 },
        { stay_date: "2026-12-05", rate: 150 },
      ],
      events: [{ title: "Concert", event_date: "2026-12-05", expected_impact: "high" }],
    });
    expect(result.dates[0].stance).toBe("protect");
    expect(result.dates[0].suggested_delta_eur).toBe(0);
  });

  it("tidies larger steps to multiples of five so neighbouring nights group", () => {
    const result = review({
      days: [day("2026-11-13", 95, { roomsLeft: 2 }), day("2026-11-14", 95, { roomsLeft: 2 })],
      rates: [
        { stay_date: "2026-11-13", price: 150 },
        { stay_date: "2026-11-14", price: 170 },
      ],
    });
    // 8% of 150 = 12 and of 170 = 14: both become 10 / 15 -> multiples of five.
    expect(result.dates.map((d) => d.suggested_delta_eur % 5)).toEqual([0, 0]);
  });

  it("protects the rate on a slow event date instead of discounting it", () => {
    const result = review({
      days: [day("2026-11-25", 20)],
      rates: [{ stay_date: "2026-11-25", price: 120 }],
      competitorRates: [
        { stay_date: "2026-11-25", rate: 90 },
        { stay_date: "2026-11-25", rate: 95 },
      ],
      events: [{ title: "Trade fair", event_date: "2026-11-25", expected_impact: "high" }],
    });
    expect(result.dates[0].stance).toBe("protect");
    expect(result.dates[0].suggested_delta_eur).toBe(0);
    expect(result.proposals).toEqual([]);
  });

  it("ignores an event suggestion that was rejected", () => {
    const result = review({
      days: [day("2026-11-25", 20)],
      rates: [{ stay_date: "2026-11-25", price: 120 }],
      events: [{ title: "Rejected", event_date: "2026-11-25", expected_impact: "high", approved: false }],
    });
    expect(result.dates[0].event_impact).toBe("none");
  });

  it("never discounts scarce inventory", () => {
    const result = review({
      days: [day("2026-11-13", 95, { roomsLeft: 2 })],
      rates: [{ stay_date: "2026-11-13", price: 100 }],
    });
    expect(result.dates[0].stance).toBe("raise");
    expect(result.dates[0].suggested_delta_eur).toBeGreaterThan(0);
  });

  it("steps down toward the market, not below it, when slow and overpriced", () => {
    const result = review({
      days: [day("2026-11-18", 30)],
      rates: [{ stay_date: "2026-11-18", price: 130 }],
      competitorRates: [
        { stay_date: "2026-11-18", rate: 100 },
        { stay_date: "2026-11-18", rate: 110 },
        { stay_date: "2026-11-18", rate: 120 },
      ],
    });
    const date = result.dates[0];
    expect(date.stance).toBe("lower");
    // Median 110 -> target 112; capped at a 15 euro step.
    expect(date.suggested_delta_eur).toBe(-15);
    expect(date.suggested_entry_rate).toBeGreaterThanOrEqual(112);
  });

  it("never suggests a decrease below the minimum-rate floor", () => {
    const result = review({
      days: [day("2026-11-18", 30)],
      rates: [{ stay_date: "2026-11-18", price: 130 }],
      competitorRates: [
        { stay_date: "2026-11-18", rate: 100 },
        { stay_date: "2026-11-18", rate: 110 },
      ],
      minimumRateEur: 125,
    });
    expect(result.dates[0].suggested_entry_rate).toBeGreaterThanOrEqual(125);
  });

  it("does not cut on stale or missing competitor data", () => {
    const stale = review({
      days: [day("2026-11-18", 30)],
      rates: [{ stay_date: "2026-11-18", price: 130 }],
      competitorRates: [
        { stay_date: "2026-11-18", rate: 100 },
        { stay_date: "2026-11-18", rate: 110 },
      ],
      competitorFresh: false,
    });
    expect(stale.dates[0].stance).toBe("hold");
    expect(stale.dates[0].confidence).toBe("low");
    expect(stale.summary.competitor_data).toBe("stale");

    const none = review({ days: [day("2026-11-18", 30)], rates: [{ stay_date: "2026-11-18", price: 130 }] });
    expect(none.dates[0].stance).toBe("hold");
    expect(none.summary.competitor_data).toBe("none");
  });

  it("holds when slow but already competitive", () => {
    const result = review({
      days: [day("2026-11-18", 30)],
      rates: [{ stay_date: "2026-11-18", price: 101 }],
      competitorRates: [
        { stay_date: "2026-11-18", rate: 100 },
        { stay_date: "2026-11-18", rate: 102 },
      ],
    });
    expect(result.dates[0].stance).toBe("hold");
    expect(result.dates[0].reasons.join(" ")).toMatch(/not the lever/);
  });

  it("marks dates without verified data instead of guessing", () => {
    const result = review({
      days: [day("2026-11-18", 0, { hasData: false })],
      rates: [{ stay_date: "2026-11-18", price: 100 }],
    });
    expect(result.dates[0].stance).toBe("insufficient_data");
    expect(result.dates[0].occupancy_pct).toBeNull();
  });

  it("groups consecutive equal steps into ranges of at most seven nights", () => {
    const days: ReviewDay[] = [];
    const rates = [];
    for (let i = 0; i < 10; i++) {
      const date = `2026-11-${String(12 + i).padStart(2, "0")}`;
      days.push(day(date, 96, { roomsLeft: 1 }));
      rates.push({ stay_date: date, price: 100 });
    }
    const result = review({ days, rates });
    expect(result.proposals).toHaveLength(2);
    expect(result.proposals[0].nights).toBe(MAX_PROPOSAL_NIGHTS);
    expect(result.proposals[0].fromDate).toBe("2026-11-12");
    expect(result.proposals[0].toDate).toBe("2026-11-18");
    expect(result.proposals[1].fromDate).toBe("2026-11-19");
    expect(result.proposals.every((p) => Math.abs(p.deltaEur) <= MAX_STEP_EUR && Number.isInteger(p.deltaEur))).toBe(true);
  });

  it("drops past dates and keeps the pace reference monotonic", () => {
    const result = review({
      days: [day("2026-11-10", 50), day("2026-11-12", 50)],
      rates: [{ stay_date: "2026-11-12", price: 100 }],
    });
    expect(result.dates.map((d) => d.stay_date)).toEqual(["2026-11-12"]);
    const curve = [0, 2, 5, 10, 20, 28, 45, 90].map(expectedOccupancyPct);
    expect([...curve].sort((a, b) => b - a)).toEqual(curve);
  });

  it("reads impact wording used by the events table", () => {
    expect(classifyEventImpact("Very High")).toBe("high");
    expect(classifyEventImpact("moderate")).toBe("medium");
    expect(classifyEventImpact("low")).toBe("low");
    expect(classifyEventImpact(null)).toBe("none");
  });
});
