import { describe, expect, it, vi } from "vitest";
import { aggregateChannels, channelTotals, channelValue, momDelta, monthShift, normaliseRevenueSource, type ChannelNight } from "./SegmentPerformancePanel";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/hooks/useMonthReconciliationDays", () => ({ useMonthReconciliationDays: () => ({ data: [] }) }));
vi.mock("@/lib/revenueCurrency", () => ({ money: (value: number) => `€${Math.round(value)}` }));

const today = Date.parse("2026-11-13T03:00:00Z");
const row = (override: Partial<ChannelNight> = {}): ChannelNight => ({
  stay_date: "2026-11-12",
  res_id: "R1",
  source_name: "Booking.com",
  status_id: 2,
  nightly_price_eur: 130,
  created_at_pms: "2026-11-12T10:00:00Z",
  stay_from: "2026-11-12", stay_to: "2026-11-13",
  ...override,
});
describe("channel report reconciliation", () => {
  it("strips Previo numeric identifiers and technical XML suffixes from channel labels", () => {
    expect(normaliseRevenueSource("770\\n            Booking.com XML")).toBe("Booking.com");
    expect(normaliseRevenueSource("1509\\n            AgodaXML")).toBe("Agoda");
    expect(normaliseRevenueSource(null)).toBe("Unspecified source");
  });
  it("excludes cancelled, unconfirmed statuses and long inventory holds", () => {
    const result = aggregateChannels([
      row(), row({ res_id: "X", status_id: 7 }),
      row({ res_id: "Y", status_id: 8 }), row({ res_id: "Z", status_id: null }),
      row({ res_id: "Hold", source_name: "", stay_from: "2026-01-01", stay_to: "2027-12-31" }),
    ], "2026-11", today - 7 * 86400000);
    expect(result).toMatchObject([{ name: "Booking.com", sold: 1, priced: 1, reservations: 1, revenue: 130, recent: 1 }]);
  });
  it("does not misclassify unknown sources as direct and uses positively priced denominator", () => {
    const result = aggregateChannels([
      row({ res_id: "A", source_name: null, nightly_price_eur: 0 }),
      row({ res_id: "A", source_name: "  ", nightly_price_eur: 120 }),
      row({ res_id: "B", source_name: "Direct", nightly_price_eur: 110 }),
    ], "2026-11", today - 7 * 86400000);
    expect(result.find((r) => r.name === "Unspecified source")).toMatchObject({ sold: 2, priced: 1, reservations: 1, revenue: 120 });
    expect(result.find((r) => r.name === "Direct")).toMatchObject({ sold: 1, priced: 1, revenue: 110 });
  });
  it("includes all stay nights in a selected month but not other months", () => {
    const result = aggregateChannels([
      row({ stay_date: "2026-11-01" }),
      row({ stay_date: "2026-11-30", res_id: "R2" }),
      row({ stay_date: "2026-12-01", res_id: "R3" }),
    ], "2026-11", today - 7 * 86400000);
    expect(result).toMatchObject([{ name: "Booking.com", sold: 2, reservations: 2, revenue: 260 }]);
  });
});


describe("month-over-month channel analytics", () => {
  it("shifts months across year boundaries correctly", () => {
    expect(monthShift("2026-01", -1)).toBe("2025-12");
    expect(monthShift("2026-12", 1)).toBe("2027-01");
    expect(monthShift("2026-11", -5)).toBe("2026-06");
  });

  it("matches verified October and November channel totals without averaging channel ADRs", () => {
    const october = aggregateChannels([
      row({ stay_date: "2026-10-01", source_name: "Booking.com", res_id: "A", nightly_price_eur: 90 }),
      row({ stay_date: "2026-10-02", source_name: "Booking.com", res_id: "A", nightly_price_eur: 110 }),
      row({ stay_date: "2026-10-02", source_name: "Agoda", res_id: "B", nightly_price_eur: 300 }),
    ], "2026-10", today - 7 * 86400000);
    const november = aggregateChannels([
      row({ stay_date: "2026-11-01", source_name: "Booking.com", res_id: "C", nightly_price_eur: 100 }),
      row({ stay_date: "2026-11-02", source_name: "Agoda", res_id: "D", nightly_price_eur: 200 }),
      row({ stay_date: "2026-11-03", source_name: "Agoda", res_id: "D", nightly_price_eur: 300 }),
      row({ stay_date: "2026-11-04", source_name: "Agoda", res_id: "D", nightly_price_eur: 400 }),
    ], "2026-11", today - 7 * 86400000);
    const current = channelTotals(november);
    const previous = channelTotals(october);
    expect(previous).toMatchObject({ sold: 3, priced: 3, revenue: 500, reservations: 2 });
    expect(current).toMatchObject({ sold: 4, priced: 4, revenue: 1000, reservations: 2 });
    expect(channelValue(previous, "adr")).toBeCloseTo(500/3);
    expect(channelValue(current, "adr")).toBe(250);
    expect(momDelta(channelValue(current, "sold"), channelValue(previous, "sold"))?.absolute).toBe(1);
    expect(momDelta(channelValue(current, "sold"), channelValue(previous, "sold"))?.percent).toBeCloseTo(100 / 3);
    expect(momDelta(channelValue(current, "revenue"), channelValue(previous, "revenue"))).toMatchObject({
      absolute: 500, percent: 100,
    });
  });

  it("does not invent rates or percent growth without a valid baseline", () => {
    expect(channelValue(null, "adr")).toBeNull();
    expect(channelValue(null, "sold")).toBe(0);
    expect(channelValue({ sold: 4, revenue: 0, priced: 0, reservations: 2 }, "adr")).toBeNull();
    expect(momDelta(120, 0)).toEqual({ absolute: 120, percent: null });
    expect(momDelta(120, null)).toBeNull();
    expect(momDelta(80, 100)).toEqual({ absolute: -20, percent: -20 });
  });

  it("preserves distinct reservation counts and correctly excludes cancelled nights in both periods", () => {
    const all = [
      row({ stay_date: "2026-10-31", res_id: "OLD", nightly_price_eur: 120 }),
      row({ stay_date: "2026-11-01", res_id: "NEW", nightly_price_eur: 180 }),
      row({ stay_date: "2026-11-02", res_id: "NEW", nightly_price_eur: 220 }),
      row({ stay_date: "2026-11-03", res_id: "CANCELLED", status_id: 7, nightly_price_eur: 400 }),
    ];
    const prev = channelTotals(aggregateChannels(all, "2026-10", 0));
    const current = channelTotals(aggregateChannels(all, "2026-11", 0));
    expect(prev).toMatchObject({ sold: 1, reservations: 1, revenue: 120 });
    expect(current).toMatchObject({ sold: 2, reservations: 1, revenue: 400 });
  });
});
