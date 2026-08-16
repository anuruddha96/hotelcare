import { describe, it, expect } from "vitest";
import {
  smartMarkdownAllowed,
  strongDemandStep,
  clampAiFactor,
  markdownBlockReason,
  pickDueRule,
  nextRunAt,
  observationWindow,
} from "../../supabase/functions/_shared/pricingRules";

describe("smart pricing — weak demand", () => {
  const win = { nearTermDays: 30, lowOccupancyPct: 50, healthyOccupancyPct: 75, longLeadDays: 60 };

  it("marks down a near-term date under the weak threshold", () => {
    expect(smartMarkdownAllowed({ ...win, occupancyPct: 42, daysOut: 12 })).toBe(true);
  });

  it("marks down a near-term date that is behind pace for its lead time", () => {
    expect(smartMarkdownAllowed({ ...win, occupancyPct: 66.7, daysOut: 30 })).toBe(true);
  });

  it("leaves a near-term date alone once it is genuinely healthy", () => {
    expect(smartMarkdownAllowed({ ...win, occupancyPct: 82, daysOut: 12 })).toBe(false);
  });

  it("uses the softer threshold far out so a quiet December is not discounted", () => {
    expect(smartMarkdownAllowed({ ...win, occupancyPct: 55, daysOut: 120 })).toBe(false);
  });


  it("positive pickup always beats a markdown in the same evaluation", () => {
    expect(markdownBlockReason({
      hadPickup: true, roomsAvailable: 5, occupancyPct: 20,
      protectHighOccupancy: true, markdownMaxOccupancyPct: 88,
      manualHoldHours: 6, now: new Date("2026-08-14T10:00:00Z"),
    })).toBe("pickup");
  });
});

describe("smart pricing — strong demand", () => {
  const base = {
    occupancyPct: 89, daysOut: 75, longLeadDays: 30, highOccupancyPct: 85,
    increase: 5, raisedToday: 0, maxDailyIncreasePerDate: 40, markedDownToday: false,
  };

  it("raises a long-lead, high-occupancy date", () => {
    expect(strongDemandStep(base)).toBe(5);
  });

  it("does nothing inside the long-lead window", () => {
    expect(strongDemandStep({ ...base, daysOut: 12 })).toBe(0);
  });

  it("never raises a date that was marked down in the same cycle", () => {
    expect(strongDemandStep({ ...base, markedDownToday: true })).toBe(0);
  });

  it("respects the daily rise cap for the date", () => {
    expect(strongDemandStep({ ...base, raisedToday: 38 })).toBe(2);
    expect(strongDemandStep({ ...base, raisedToday: 40 })).toBe(0);
  });
});

describe("AI advisor is clamped", () => {
  it("can only confirm or soften, never enlarge", () => {
    expect(clampAiFactor(2.5)).toBe(1);
    expect(clampAiFactor(-3)).toBe(0);
    expect(clampAiFactor(0.4)).toBeCloseTo(0.4);
  });

  it("falls back to the deterministic move on malformed output", () => {
    expect(clampAiFactor("nonsense")).toBe(1);
    expect(clampAiFactor(undefined)).toBe(1);
  });
});

describe("scheduler", () => {
  const rule = (over: Partial<Parameters<typeof pickDueRule>[0][number]> = {}) => ({
    hotel_id: "ottofiori", is_enabled: true, next_run_at: null,
    evaluation_interval_minutes: 60, ...over,
  });

  it("claims exactly one due hotel", () => {
    const now = new Date("2026-08-14T12:00:00Z");
    const due = pickDueRule([
      rule({ hotel_id: "a", next_run_at: "2026-08-14T11:00:00Z" }),
      rule({ hotel_id: "b", next_run_at: "2026-08-14T11:30:00Z" }),
    ], now);
    expect(due?.hotel_id).toBe("a");
  });

  it("does not evaluate again before the 60-minute interval is due", () => {
    const now = new Date("2026-08-14T12:00:00Z");
    expect(pickDueRule([rule({ next_run_at: "2026-08-14T12:30:00Z" })], now)).toBeNull();
  });

  it("measures the next slot from now, so a missed hour is never replayed", () => {
    const now = new Date("2026-08-14T12:00:00Z");
    expect(nextRunAt(now, 60)).toBe("2026-08-14T13:00:00.000Z");
    const window = observationWindow(now, "2026-08-14T04:00:00Z", 60);
    expect(window.from).toBe("2026-08-14T06:00:00.000Z"); // bounded to 6 hours
  });
});

import {
  immediateWindowDecision,
  detectDemandSpike,
  eventSurcharge,
} from "../../supabase/functions/_shared/pricingRules";

describe("immediate selling window", () => {
  const base = {
    enabled: true, immediateWindowDays: 14, baseStep: 1, immediateStep: 3,
    tightOccupancyPct: 85,
  };

  it("marks a soft near date down every cycle with the bigger step", () => {
    const d = immediateWindowDecision({ ...base, daysOut: 5, occupancyPct: 55 });
    expect(d.inWindow).toBe(true);
    expect(d.forceMarkdown).toBe(true);
    expect(d.allowIncrease).toBe(false);
    expect(d.step).toBe(3);
  });

  it("lets a tight near date hold and rise", () => {
    const d = immediateWindowDecision({ ...base, daysOut: 3, occupancyPct: 92 });
    expect(d.forceMarkdown).toBe(false);
    expect(d.allowIncrease).toBe(true);
    expect(d.step).toBe(1);
  });

  it("leaves long-lead dates to the normal rules", () => {
    const d = immediateWindowDecision({ ...base, daysOut: 40, occupancyPct: 20 });
    expect(d.inWindow).toBe(false);
    expect(d.forceMarkdown).toBe(false);
    expect(d.step).toBe(1);
  });

  it("is inert when the property switched it off", () => {
    const d = immediateWindowDecision({ ...base, enabled: false, daysOut: 2, occupancyPct: 10 });
    expect(d.inWindow).toBe(false);
  });
});

describe("demand spike detection", () => {
  const base = { enabled: true, thresholdPct: 5, daysOut: 60, immediateWindowDays: 14 };

  it("flags a date filling faster than the month around it", () => {
    const r = detectDemandSpike({ ...base, occupancyNowPct: 48, occupancyThenPct: 40, baselineDeltaPct: 1 });
    expect(r.spike).toBe(true);
    expect(r.deltaPct).toBe(8);
  });

  it("ignores a lift the whole month shares", () => {
    const r = detectDemandSpike({ ...base, occupancyNowPct: 48, occupancyThenPct: 40, baselineDeltaPct: 7 });
    expect(r.spike).toBe(false);
  });

  it("never fires inside the immediate selling window", () => {
    const r = detectDemandSpike({ ...base, daysOut: 6, occupancyNowPct: 60, occupancyThenPct: 40 });
    expect(r.spike).toBe(false);
  });

  it("stays silent without history", () => {
    expect(detectDemandSpike({ ...base, occupancyNowPct: 60, occupancyThenPct: null }).spike).toBe(false);
  });
});

describe("event surcharge", () => {
  it("charges full value for a high-impact event", () => {
    expect(eventSurcharge({ impact: "high", surcharge: 10 })).toBe(10);
  });
  it("halves a medium event and ignores a low one", () => {
    expect(eventSurcharge({ impact: "medium", surcharge: 10 })).toBe(5);
    expect(eventSurcharge({ impact: "low", surcharge: 10 })).toBe(0);
  });
  it("respects the per-change and daily caps", () => {
    expect(eventSurcharge({ impact: "high", surcharge: 30, maximumIncrease: 12 })).toBe(12);
    expect(eventSurcharge({ impact: "high", surcharge: 30, remainingDailyRoom: 4 })).toBe(4);
  });
});
