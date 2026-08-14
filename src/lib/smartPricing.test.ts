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
  it("marks down a near-term date under the weak threshold", () => {
    expect(smartMarkdownAllowed({ occupancyPct: 42, daysOut: 12, nearTermDays: 30, lowOccupancyPct: 50 })).toBe(true);
  });

  it("leaves a healthy date alone even without pickup", () => {
    expect(smartMarkdownAllowed({ occupancyPct: 72, daysOut: 12, nearTermDays: 30, lowOccupancyPct: 50 })).toBe(false);
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
