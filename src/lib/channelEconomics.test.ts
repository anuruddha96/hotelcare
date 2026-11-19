import { describe, expect, it } from "vitest";
import {
  byBooking, byChannel, byDay, byRateGroup, certaintyOf, commissionShare, exactShare, monthBounds,
  monthlySeries, monthsBetween, netAdr, rateGroupOf, revenueBridge, shiftMonth, splitByCurrency,
  toEconomicsRow, toMonthlyRow, totalsOf, unknownShare, type EconomicsRow,
} from "./channelEconomics";

function row(partial: Partial<EconomicsRow>): EconomicsRow {
  return toEconomicsRow({
    stay_date: "2026-10-10", booking_ref: "b1", ota_code: null, data_source: "previo",
    channel_key: "booking_com", channel_type: "ota", booked_on: "2026-09-01",
    room_nights: 1, priced_nights: 1, amount: 0, city_tax: 0, revenue_ex_tax: 0, gross_revenue: 0,
    commission: 0, net_revenue: 0, amount_basis: "gross", commission_source: "ota_note",
    commission_rate: 0.18, rate_label: null, meal_plan: null, payout_type: null, currency: "EUR",
    ...partial,
  } as Record<string, unknown>);
}

// Booking.com night: €103.81 in the PMS = €100 room + €3.81 city tax; 18% commission.
const bdc = row({ booking_ref: "bdc-1", ota_code: "5000000001", amount: 103.81, city_tax: 3.81, revenue_ex_tax: 100, gross_revenue: 100, commission: 18, net_revenue: 82, rate_label: "Mobile(App) Rate" });
// Expedia Collect night: the PMS holds the net amount €80 + €2.71 city tax; 20% already kept.
const exp = row({ booking_ref: "exp-1", channel_key: "expedia", amount: 82.71, city_tax: 2.71, revenue_ex_tax: 80, gross_revenue: 100, commission: 20, net_revenue: 80, amount_basis: "net", commission_source: "terms", commission_rate: 0.2 });
// Direct night, no commission.
const dir = row({ booking_ref: "dir-1", channel_key: "direct_web", channel_type: "direct", amount: 90, revenue_ex_tax: 90, gross_revenue: 90, commission: 0, net_revenue: 90, commission_source: "no_commission", commission_rate: 0 });
// eDreams night without terms: commission unknown.
const unk = row({ booking_ref: "edr-1", channel_key: "edreams", amount: 70, revenue_ex_tax: 70, gross_revenue: 70, commission: null, net_revenue: 70, commission_source: "none", commission_rate: null });

describe("toEconomicsRow", () => {
  it("normalises PostgREST strings and unknown enums", () => {
    const r = toEconomicsRow({ stay_date: "2026-10-01", booking_ref: 12, amount: "12.50", commission: null, commission_source: "weird", channel_type: "x", currency: "eur", room_nights: "2" });
    expect(r.amount).toBe(12.5);
    expect(r.commission).toBeNull();
    expect(r.commission_source).toBe("none");
    expect(r.channel_type).toBe("other");
    expect(r.currency).toBe("EUR");
    expect(r.room_nights).toBe(2);
    expect(r.booking_ref).toBe("12");
  });
});

describe("totals and the revenue bridge", () => {
  const t = totalsOf([bdc, exp, dir, unk]);

  it("adds up the waterfall consistently", () => {
    expect(t.amount).toBeCloseTo(346.52, 2);
    expect(t.cityTax).toBeCloseTo(6.52, 2);
    expect(t.revenueExTax).toBeCloseTo(340, 2);
    expect(t.commissionWithheld).toBeCloseTo(20, 2);
    // gross = PMS ex tax + what the net-rate OTA kept
    expect(t.grossRevenue).toBeCloseTo(t.revenueExTax + t.commissionWithheld, 6);
    // net = gross - all known commission
    expect(t.netRevenue).toBeCloseTo(t.grossRevenue - t.commission, 6);
    expect(t.bookings).toBe(4);
  });

  it("splits exact, estimated and unknown commission", () => {
    expect(t.commissionExact).toBe(18);
    expect(t.commissionEstimated).toBe(20);
    expect(exactShare(t)).toBeCloseTo(18 / 38, 6);
    expect(t.unknownGross).toBe(70);
    expect(unknownShare(t)).toBeCloseTo(70 / 270, 6);
    expect(commissionShare(t)).toBeCloseTo(38 / 360, 6);
    expect(netAdr(t)).toBeCloseTo(322 / 4, 6);
  });

  it("builds bridge steps, with the withheld line only when a net-rate OTA is present", () => {
    const steps = revenueBridge(t);
    expect(steps.map((s) => s.key)).toEqual(["pms", "city_tax", "pms_ex_tax", "withheld", "gross", "commission", "net"]);
    expect(revenueBridge(totalsOf([bdc, dir])).map((s) => s.key)).not.toContain("withheld");
  });
});

describe("byChannel", () => {
  it("groups, sorts by gross and records basis and main source", () => {
    const rows = byChannel([bdc, exp, dir, unk, { ...bdc, booking_ref: "bdc-2", commission_source: "statement" }]);
    expect(rows[0].key).toBe("booking_com");
    expect(rows[0].grossRevenue).toBe(200);
    expect(rows.find((r) => r.key === "expedia")?.basis).toBe("net");
    expect(rows.find((r) => r.key === "edreams")?.mainSource).toBe("none");
  });

  it("rates certainty per channel", () => {
    expect(certaintyOf(totalsOf([bdc]), "ota")).toBe("exact");
    expect(certaintyOf(totalsOf([exp]), "ota")).toBe("estimated");
    expect(certaintyOf(totalsOf([bdc, exp]), "ota")).toBe("mixed");
    expect(certaintyOf(totalsOf([unk]), "ota")).toBe("unknown");
    expect(certaintyOf(totalsOf([dir]), "direct")).toBe("none");
  });
});

describe("byDay", () => {
  it("zero-fills every date of the range", () => {
    const days = byDay([bdc, { ...dir, stay_date: "2026-10-12" }], "2026-10-09", "2026-10-12");
    expect(days.map((d) => d.date)).toEqual(["2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12"]);
    expect(days[1].commission).toBe(18);
    expect(days[2].grossRevenue).toBe(0);
    expect(days[3].netRevenue).toBe(90);
  });
});

describe("Booking.com rate plans", () => {
  it.each([
    ["Mobile(App) Rate", "mobile"],
    ["Non-refundable", "non_refundable"],
    ["Genius Mobile rate", "genius"],
    ["Early Booker Deal", "early_booker"],
    ["Last-minute deal", "last_minute"],
    ["Getaway Deal", "deal"],
    ["Standard Rate", "standard"],
    ["Breakfast special", "other"],
    [null, "unlabelled"],
  ])("%s -> %s", (label, group) => {
    expect(rateGroupOf(label)).toBe(group);
  });

  it("gives shares of room nights that add up to one", () => {
    const rows = byRateGroup([
      bdc,
      { ...bdc, booking_ref: "bdc-2", rate_label: "Non-refundable", room_nights: 2, priced_nights: 2 },
      { ...bdc, booking_ref: "bdc-3", rate_label: null },
      exp,
    ]);
    expect(rows.map((r) => r.group)).toEqual(["non_refundable", "mobile", "unlabelled"]);
    expect(rows.reduce((s, r) => s + r.share, 0)).toBeCloseTo(1, 6);
    expect(rows[0].share).toBeCloseTo(0.5, 6);
  });
});

describe("byBooking", () => {
  it("merges the nights of a booking and keeps unknown commission unknown", () => {
    const list = byBooking([
      bdc, { ...bdc, stay_date: "2026-10-11" },
      unk, { ...unk, stay_date: "2026-10-11" },
    ]);
    const b = list.find((x) => x.bookingRef === "bdc-1")!;
    expect(b.firstNight).toBe("2026-10-10");
    expect(b.lastNight).toBe("2026-10-11");
    expect(b.commission).toBe(36);
    expect(list.find((x) => x.bookingRef === "edr-1")!.commission).toBeNull();
  });
});

describe("months and currencies", () => {
  it("works out month bounds and shifts across years", () => {
    expect(monthBounds("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(monthBounds("2028-02").to).toBe("2028-02-29");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-11", 3)).toBe("2027-02");
    expect(monthsBetween("2026-11", "2027-02")).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
  });

  it("never mixes currencies", () => {
    const usd = { ...dir, booking_ref: "usd-1", currency: "USD" };
    const split = splitByCurrency([bdc, usd], "EUR");
    expect(split.rows).toHaveLength(1);
    expect(split.otherRows).toBe(1);
    expect(split.otherCurrencies).toEqual(["USD"]);
  });

  it("builds a zero-filled monthly series in one currency", () => {
    const rows = [
      toMonthlyRow({ month: "2026-10-01", channel_key: "booking_com", commission_source: "ota_note", currency: "EUR", gross_revenue: "1000", commission: "180", net_revenue: "820", room_nights: 10, priced_nights: 10 }),
      toMonthlyRow({ month: "2026-10-01", channel_key: "expedia", commission_source: "terms", currency: "EUR", gross_revenue: 500, commission: 100, net_revenue: 400, room_nights: 5, priced_nights: 5 }),
      toMonthlyRow({ month: "2026-10-01", channel_key: "direct", commission_source: "no_commission", currency: "USD", gross_revenue: 999, commission: 0, net_revenue: 999 }),
    ];
    const series = monthlySeries(rows, ["2026-09", "2026-10"], "EUR");
    expect(series[0].grossRevenue).toBe(0);
    expect(series[1]).toMatchObject({ grossRevenue: 1500, commission: 280, commissionExact: 180, netRevenue: 1220, roomNights: 15 });
  });
});
