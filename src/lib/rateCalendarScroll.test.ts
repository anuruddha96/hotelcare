import { describe, expect, it } from "vitest";
import {
  shouldAllowRateCalendarEdgePan,
  shouldResetRateCalendarViewport,
} from "./rateCalendarScroll";

describe("Rate & Pickup calendar viewport", () => {
  it("never pans when a mouse only hovers near a calendar edge", () => {
    expect(shouldAllowRateCalendarEdgePan("mouse", false, false)).toBe(false);
    expect(shouldAllowRateCalendarEdgePan("pen", false, false)).toBe(false);
    expect(shouldAllowRateCalendarEdgePan("touch", false, false)).toBe(false);
  });

  it("allows edge panning only while the user intentionally drags a selection", () => {
    expect(shouldAllowRateCalendarEdgePan("mouse", true, false)).toBe(true);
    expect(shouldAllowRateCalendarEdgePan("mouse", false, true)).toBe(true);
    expect(shouldAllowRateCalendarEdgePan("mouse", true, true)).toBe(true);
    expect(shouldAllowRateCalendarEdgePan("touch", true, true)).toBe(false);
  });

  it("does not reset horizontal position during a live refresh of the same view", () => {
    const key = "ottofiori|2026-11-04||";
    expect(shouldResetRateCalendarViewport(key, key, true)).toBe(false);
    expect(shouldResetRateCalendarViewport(key, key, false)).toBe(false);
    expect(shouldResetRateCalendarViewport(key, "memories|2026-11-04||", false)).toBe(false);
  });

  it("positions once after first data load or an intentional view change", () => {
    const initial = "ottofiori|2026-11-04||";
    expect(shouldResetRateCalendarViewport(null, initial, true)).toBe(true);
    expect(shouldResetRateCalendarViewport(initial, "memories|2026-11-04||", true)).toBe(true);
    expect(shouldResetRateCalendarViewport(initial, "ottofiori|2026-11-04|2026-12|", true)).toBe(true);
    expect(shouldResetRateCalendarViewport(initial, "ottofiori|2026-11-04||2026-10", true)).toBe(true);
  });
});
