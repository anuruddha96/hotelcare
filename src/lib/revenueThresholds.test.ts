import { describe, expect, it } from "vitest";
import { DEFAULT_THRESHOLDS, occupancyTone2, pickupTone, rateTone } from "./revenueThresholds";

describe("readable dark revenue tones", () => {
  it("retains critical classifications with light red text and low intensity fill", () => {
    for (const tone of [rateTone(20, DEFAULT_THRESHOLDS), rateTone(1000, DEFAULT_THRESHOLDS), occupancyTone2(25, DEFAULT_THRESHOLDS)]) {
      expect(tone.severity).toBe("critical");
      expect(tone.className).toContain("dark:text-red-300");
      expect(tone.className).toContain("dark:bg-destructive/[0.07]");
    }
  });
  it("keeps cancellation and positive pickup meanings, without saturated dark cells", () => {
    const lost = pickupTone(-3, DEFAULT_THRESHOLDS);
    const strong = pickupTone(4, DEFAULT_THRESHOLDS);
    expect(lost.label).toBe("net cancellations");
    expect(strong.label).toBe("strong pickup");
    expect(lost.className).toContain("dark:text-foreground");
    expect(strong.className).toContain("dark:bg-emerald-400/20");
  });
  it("does not change healthy rate classification or missing values", () => {
    expect(rateTone(100, DEFAULT_THRESHOLDS)).toMatchObject({ severity: "ok", className: "" });
    expect(rateTone(null, DEFAULT_THRESHOLDS).severity).toBe("none");
  });
});
