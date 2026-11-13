import { describe, expect, it } from "vitest";
import { budapestDate, pricingProposalKey, pricingReviewApprovals } from "./pricingApproval";

const TODAY = "2026-11-13";
const output = () => ({
  source: "revenue_published_payload",
  confidence: "verified" as const,
  data: {
    hotel_id: "ottofiori",
    hotel_name: "Hotel Ottofiori",
    currency: "EUR",
    proposals: [
      { fromDate: "2026-11-15", toDate: "2026-11-16", deltaEur: 10, nights: 2, reason: "Strong verified demand" },
      { fromDate: "2026-11-22", toDate: "2026-11-22", deltaEur: 15, nights: 1, reason: "High event impact" },
    ],
  },
});

describe("verified revenue pricing confirmation cards", () => {
  it("creates one role-authorized proposal per verified date range, without publishing anything", () => {
    const proposals = pricingReviewApprovals(output(), "top_management_manager", TODAY);
    expect(proposals).toHaveLength(2);
    expect(proposals[0]).toMatchObject({
      kind: "action_proposal",
      action: "adjust_revenue_prices",
      hotelId: "ottofiori",
      fields: [
        { label: "Stay dates", value: "2026-11-15 → 2026-11-16" },
        { label: "Adjustment", value: "+10 EUR per published price cell" },
        { label: "Scope", value: "2 nights · all eligible room types and occupancies" },
      ],
      input: { hotelId: "ottofiori", fromDate: "2026-11-15", toDate: "2026-11-16", deltaEur: 10 },
    });
    expect(proposals[1].input).toEqual({
      hotelId: "ottofiori", fromDate: "2026-11-22", toDate: "2026-11-22", deltaEur: 15,
    });
  });

  it("never exposes approval buttons to unauthorized roles", () => {
    for (const role of ["reception", "manager", "housekeeping", null, undefined]) {
      expect(pricingReviewApprovals(output(), role, TODAY)).toEqual([]);
    }
    expect(pricingReviewApprovals(output(), "admin", TODAY)).toHaveLength(2);
    expect(pricingReviewApprovals(output(), "top_management", TODAY)).toHaveLength(2);
  });

  it("rejects fabricated, unverified or unrelated model tool results", () => {
    expect(pricingReviewApprovals({ data: output().data }, "admin", TODAY)).toEqual([]);
    expect(pricingReviewApprovals({ ...output(), source: "model_freeform" }, "admin", TODAY)).toEqual([]);
    expect(pricingReviewApprovals({ ...output(), confidence: "unverified" }, "admin", TODAY)).toEqual([]);
    expect(pricingReviewApprovals({ ...output(), data: { ...output().data, currency: "HUF" } }, "admin", TODAY)).toEqual([]);
    expect(pricingReviewApprovals({ ...output(), data: { ...output().data, hotel_id: "" } }, "admin", TODAY)).toEqual([]);
  });

  it("checks real future dates, bounded changes and a maximum seven nights", () => {
    const samples = [
      { fromDate: "2026-11-12", toDate: "2026-11-12", deltaEur: 10, nights: 1 }, // past
      { fromDate: "2026-11-15", toDate: "2026-11-22", deltaEur: 10, nights: 8 }, // > 7
      { fromDate: "2026-11-15", toDate: "2026-11-16", deltaEur: 21, nights: 2 }, // > 20
      { fromDate: "2026-11-15", toDate: "2026-11-16", deltaEur: 0, nights: 2 },
      { fromDate: "2026-02-30", toDate: "2026-03-01", deltaEur: 10, nights: 1 },
      { fromDate: "2026-11-20", toDate: "2026-11-19", deltaEur: 10, nights: 0 },
      { fromDate: "2026-11-15", toDate: "2026-11-16", deltaEur: 10, nights: 1 }, // inaccurate range
    ];
    const test = { ...output(), data: { ...output().data, proposals: samples } };
    expect(pricingReviewApprovals(test, "admin", TODAY)).toEqual([]);
  });

  it("deduplicates repeated proposals and exposes matching keys for model-made cards", () => {
    const item = output().data.proposals[0];
    const test = { ...output(), data: { ...output().data, proposals: [item, item] } };
    const result = pricingReviewApprovals(test, "admin", TODAY);
    expect(result).toHaveLength(1);
    expect(pricingProposalKey(result[0].action, result[0].input)).toBe(
      "adjust_revenue_prices|ottofiori|2026-11-15|2026-11-16|10",
    );
  });

  it("uses Budapest calendar days around UTC midnight", () => {
    expect(budapestDate(new Date("2026-11-12T23:20:00Z"))).toBe("2026-11-13");
  });
});
