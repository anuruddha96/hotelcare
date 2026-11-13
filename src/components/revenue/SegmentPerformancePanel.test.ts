import { describe, expect, it, vi } from "vitest";
import { aggregateChannels, normaliseRevenueSource, type ChannelNight } from "./SegmentPerformancePanel";

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
