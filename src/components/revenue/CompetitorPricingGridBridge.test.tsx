import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  competitorGridStyleText,
  marketSignalFor,
  tooltipFor,
  type MarketRow,
} from "./CompetitorPricingGridBridge";

const NOW = Date.parse("2026-09-06T19:30:00Z");

function row(overrides: Partial<MarketRow> = {}): MarketRow {
  return {
    stay_date: "2026-09-11",
    active_competitor_count: 4,
    observed_competitor_count: 4,
    validated_competitor_count: 4,
    excluded_outlier_count: 0,
    average_rate_eur: 178,
    median_rate_eur: 150,
    min_rate_eur: 145,
    max_rate_eur: 155,
    raw_average_rate_eur: 178,
    freshest_captured_at: "2026-09-06T18:30:00Z",
    competitors: [
      { name: "Comp A", rate_eur: 145, confidence: 0.92 },
      { name: "Comp B", rate_eur: 149, confidence: 0.88 },
      { name: "Comp C", rate_eur: 151, confidence: 0.9 },
      { name: "Comp D", rate_eur: 155, confidence: 0.86 },
    ],
    ...overrides,
  };
}

describe("competitor calendar market signal", () => {
  it("keeps the first demand/market label frozen while dates scroll", () => {
    const css = competitorGridStyleText();
    expect(css).toContain("position: sticky !important");
    expect(css).toContain("left: 0 !important");
    expect(css).toContain("z-index: 40 !important");
    expect(css).not.toContain("position: relative;\n      font-size: 0 !important;\n      color: transparent !important;");
  });

  it("uses the validated median as the visible reference instead of a pulled arithmetic average", () => {
    const signal = marketSignalFor(row(), NOW);
    expect(signal.referenceRate).toBe(150);
    expect(signal.referenceRate).not.toBe(178);
    expect(signal.coverageLabel).toBe("4/4");
    expect(signal.quality).toBe("high");
    expect(signal.confidencePct).toBeGreaterThanOrEqual(75);
  });

  it("does not overstate thin competitor evidence", () => {
    const signal = marketSignalFor(row({
      active_competitor_count: 12,
      observed_competitor_count: 2,
      validated_competitor_count: 1,
      excluded_outlier_count: 1,
      median_rate_eur: 132,
      average_rate_eur: 132,
      min_rate_eur: 132,
      max_rate_eur: 132,
      competitors: [{ name: "Only usable comp", rate_eur: 132, confidence: 0.9 }],
    }), NOW);

    expect(signal.referenceRate).toBe(132);
    expect(signal.coverageLabel).toBe("1/12");
    expect(signal.quality).toBe("low");
    expect(signal.qualityLabel).toBe("Low confidence");
  });

  it("explains the evidence rules and keeps market price pressure separate from demand", () => {
    const tooltip = tooltipFor(
      "2026-09-11",
      row({ excluded_outlier_count: 1, observed_competitor_count: 5 }),
      "2026-09-11 · demand Strong (78/100)\n3 room-nights picked up",
      NOW,
    );

    expect(tooltip).toContain("demand Strong (78/100)");
    expect(tooltip).toContain("validated median");
    expect(tooltip).toContain("EUR only");
    expect(tooltip).toContain("statistical outlier");
    expect(tooltip).toContain("Market price pressure is not the same as city occupancy");
  });
});
