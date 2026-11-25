import { describe, expect, it } from "vitest";
import {
  compressAvailabilityDeltas,
  compressRestrictionDeltas,
  majorToMinorExact,
  mayAckRevision,
} from "./ariDelta";

const TODAY = "2026-10-08";
const PROPERTY = "channex-property-one";

describe("Channex pure ARI delta preparation", () => {
  it("compresses consecutive availability with the same value for one room type", () => {
    expect(compressAvailabilityDeltas(PROPERTY, [
      { propertyId: PROPERTY, roomTypeId: "double", date: "2026-10-10", availability: 2 },
      { propertyId: PROPERTY, roomTypeId: "double", date: "2026-10-08", availability: 2 },
      { propertyId: PROPERTY, roomTypeId: "double", date: "2026-10-09", availability: 2 },
    ], TODAY)).toEqual([{
      property_id: PROPERTY, room_type_id: "double",
      date_from: "2026-10-08", date_to: "2026-10-10", availability: 2,
    }]);
  });

  it("does not merge a gap, room type or changed availability, including zero stock", () => {
    const result = compressAvailabilityDeltas(PROPERTY, [
      { propertyId: PROPERTY, roomTypeId: "double", date: "2026-10-08", availability: 0 },
      { propertyId: PROPERTY, roomTypeId: "double", date: "2026-10-09", availability: 2 },
      { propertyId: PROPERTY, roomTypeId: "double", date: "2026-10-11", availability: 2 },
      { propertyId: PROPERTY, roomTypeId: "twin", date: "2026-10-09", availability: 2 },
    ], TODAY);
    expect(result).toHaveLength(4);
    expect(result.find(r => r.availability === 0)?.date_from).toBe("2026-10-08");
  });

  it("rejects another property before producing a publish batch", () => {
    expect(() => compressAvailabilityDeltas(PROPERTY, [
      { propertyId: "other-property", roomTypeId: "double", date: "2026-10-08", availability: 3 },
    ], TODAY)).toThrow(/Cross-property/);
  });

  it("rejects conflicts instead of silently picking the last inventory value", () => {
    expect(() => compressAvailabilityDeltas(PROPERTY, [
      { propertyId: PROPERTY, roomTypeId: "double", date: "2026-10-08", availability: 2 },
      { propertyId: PROPERTY, roomTypeId: "double", date: "2026-10-08", availability: 0 },
    ], TODAY)).toThrow(/Conflicting/);
  });

  it("deduplicates identical observations of the same date", () => {
    expect(compressAvailabilityDeltas(PROPERTY, [
      { propertyId: PROPERTY, roomTypeId: "double", date: TODAY, availability: 2 },
      { propertyId: PROPERTY, roomTypeId: "double", date: TODAY, availability: 2 },
    ], TODAY)).toHaveLength(1);
  });

  it("blocks invalid, negative and past-dated availability", () => {
    expect(() => compressAvailabilityDeltas(PROPERTY, [
      { propertyId: PROPERTY, roomTypeId: "double", date: "2026-02-29", availability: 1 },
    ], TODAY)).toThrow();
    expect(() => compressAvailabilityDeltas(PROPERTY, [
      { propertyId: PROPERTY, roomTypeId: "double", date: "2026-10-07", availability: 1 },
    ], TODAY)).toThrow(/Past dates/);
    expect(() => compressAvailabilityDeltas(PROPERTY, [
      { propertyId: PROPERTY, roomTypeId: "double", date: TODAY, availability: -1 },
    ], TODAY)).toThrow(/Invalid/);
  });

  it("compresses only matching restriction field sets", () => {
    const rows = compressRestrictionDeltas(PROPERTY, [
      { propertyId: PROPERTY, ratePlanId: "bar", date: "2026-10-09", patch: { rate: 12500 } },
      { propertyId: PROPERTY, ratePlanId: "bar", date: "2026-10-08", patch: { rate: 12500 } },
      { propertyId: PROPERTY, ratePlanId: "bar", date: "2026-10-10", patch: { rate: 12500, min_stay_arrival: 2 } },
    ], TODAY);
    expect(rows).toEqual([
      { property_id: PROPERTY, rate_plan_id: "bar", date_from: TODAY, date_to: "2026-10-09", rate: 12500 },
      { property_id: PROPERTY, rate_plan_id: "bar", date_from: "2026-10-10", date_to: "2026-10-10", rate: 12500, min_stay_arrival: 2 },
    ]);
    expect(rows[0]).not.toHaveProperty("min_stay_arrival");
    expect(rows[0]).not.toHaveProperty("stop_sell");
  });

  it("handles sorted multi-occupancy prices without accidentally converting to a scalar rate", () => {
    const rows = compressRestrictionDeltas(PROPERTY, [
      { propertyId: PROPERTY, ratePlanId: "per-person", date: TODAY,
        patch: { rates: [{ occupancy: 2, rate: 13000 }, { occupancy: 1, rate: 11000 }] } },
    ], TODAY);
    expect(rows[0]).not.toHaveProperty("rate");
    expect(rows[0].rates).toEqual([{ occupancy: 1, rate: 11000 }, { occupancy: 2, rate: 13000 }]);
  });

  it("rejects empty, contradictory or invalid rate restrictions", () => {
    expect(() => compressRestrictionDeltas(PROPERTY, [
      { propertyId: PROPERTY, ratePlanId: "bar", date: TODAY, patch: {} },
    ], TODAY)).toThrow(/Empty/);
    expect(() => compressRestrictionDeltas(PROPERTY, [
      { propertyId: PROPERTY, ratePlanId: "bar", date: TODAY, patch: { rate: 13000, rates: [{ occupancy: 2, rate: 13000 }] } },
    ], TODAY)).toThrow(/scalar rate OR/);
    expect(() => compressRestrictionDeltas(PROPERTY, [
      { propertyId: PROPERTY, ratePlanId: "bar", date: TODAY, patch: { rate: 0 } },
    ], TODAY)).toThrow(/positive/);
  });
});

describe("Channex booking and money safeguards", () => {
  it("converts exact EUR/HUF-style decimals without floating point rounding", () => {
    expect(majorToMinorExact("123.45", 2)).toBe(12345);
    expect(majorToMinorExact("4990", 2)).toBe(499000);
    expect(majorToMinorExact("10", 0)).toBe(10);
    expect(majorToMinorExact("0.10", 2)).toBe(10);
  });

  it("rejects unsupported monetary precision instead of silently rounding", () => {
    expect(() => majorToMinorExact("12.345", 2)).toThrow(/excess/);
    expect(() => majorToMinorExact("1.1", -1)).toThrow(/exponent/);
    expect(() => majorToMinorExact("90071992547410000", 2)).toThrow(/safe integer/);
  });

  it("never acknowledges an unmapped or unpermitted booking revision", () => {
    expect(mayAckRevision({
      expectedProperty: false, permittedTenant: true,
      durableBookingSaved: true, durableReviewSaved: false,
    })).toBe(false);
    expect(mayAckRevision({
      expectedProperty: true, permittedTenant: false,
      durableBookingSaved: true, durableReviewSaved: false,
    })).toBe(false);
  });

  it("requires durable booking application or a persisted manager review case before ACK", () => {
    expect(mayAckRevision({
      expectedProperty: true, permittedTenant: true,
      durableBookingSaved: false, durableReviewSaved: false,
    })).toBe(false);
    expect(mayAckRevision({
      expectedProperty: true, permittedTenant: true,
      durableBookingSaved: false, durableReviewSaved: true,
    })).toBe(true);
    expect(mayAckRevision({
      expectedProperty: true, permittedTenant: true,
      durableBookingSaved: true, durableReviewSaved: false,
    })).toBe(true);
  });
});
