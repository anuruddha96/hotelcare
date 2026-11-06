import { describe, expect, it } from "vitest";
import {
  DEFAULT_PICKUP_WINDOW_DAYS,
  PICKUP_WINDOW_48H,
  pickupWindowFirstDay,
  pickupWindowLabel,
  pickupWindowStartMs,
} from "@/lib/revenueAnalytics";

describe("revenue management pickup windows", () => {
  it("defaults to yesterday and today, not the automation's rolling 48 hours", () => {
    expect(DEFAULT_PICKUP_WINDOW_DAYS).toBe(2);
    expect(pickupWindowLabel(DEFAULT_PICKUP_WINDOW_DAYS)).toBe("Yesterday + today");
    expect(pickupWindowStartMs(PICKUP_WINDOW_48H, Date.parse("2026-11-06T09:00:00Z")))
      .toBe(Date.parse("2026-11-04T09:00:00Z"));
  });

  it.each([
    ["winter", "2026-11-06T09:00:00Z", "2026-11-04T23:00:00Z", "2026-11-05"],
    ["summer", "2026-07-06T09:00:00Z", "2026-07-04T22:00:00Z", "2026-07-05"],
    ["spring DST change", "2026-03-29T12:00:00Z", "2026-03-27T23:00:00Z", "2026-03-28"],
    ["autumn DST change", "2026-10-25T12:00:00Z", "2026-10-23T22:00:00Z", "2026-10-24"],
  ])("uses the exact Budapest midnight for %s", (_, now, expected, firstDay) => {
    const start = pickupWindowStartMs(DEFAULT_PICKUP_WINDOW_DAYS, Date.parse(now));
    expect(start).toBe(Date.parse(expected));
    expect(pickupWindowFirstDay(DEFAULT_PICKUP_WINDOW_DAYS, Date.parse(now))).toBe(firstDay);
  });

  it("today starts at local midnight, not 24 hours ago", () => {
    expect(pickupWindowStartMs(1, Date.parse("2026-11-06T09:00:00Z")))
      .toBe(Date.parse("2026-11-05T23:00:00Z"));
  });
});
