import { describe, expect, it } from "vitest";
import {
  hasRevenueDayPreset, isRdHotelsRevenueOrganization, revenueDaysForPreset,
} from "./revenueBulkDaySelection";

describe("Bulk revenue editor day presets", () => {
  it("uses Friday and Saturday for RD Hotels Budapest, with Sunday excluded until explicitly selected", () => {
    expect(isRdHotelsRevenueOrganization("rdhotels")).toBe(true);
    expect(isRdHotelsRevenueOrganization("rd-hotels")).toBe(true);
    const weekend = revenueDaysForPreset("rdhotels", "weekends");
    expect([...weekend].sort()).toEqual([5, 6]);
    expect(hasRevenueDayPreset(weekend, "rdhotels", "weekends")).toBe(true);
    weekend.add(0); // Opt into Sunday separately.
    expect([...weekend].sort()).toEqual([0, 5, 6]);
    expect(hasRevenueDayPreset(weekend, "rdhotels", "weekends")).toBe(false);
  });

  it("keeps Saturday and Sunday as the standard weekend for other tenants, with optional Friday", () => {
    for (const org of ["slnt", "another-property", null]) {
      const weekend = revenueDaysForPreset(org, "weekends");
      expect([...weekend].sort()).toEqual([0, 6]);
      weekend.add(5);
      expect([...weekend].sort()).toEqual([0, 5, 6]);
      expect(hasRevenueDayPreset(weekend, org, "weekends")).toBe(false);
    }
  });

  it("keeps all-days independent from weekday and weekend presets", () => {
    expect([...revenueDaysForPreset("rdhotels", "weekdays")].sort()).toEqual([1, 2, 3, 4]);
    expect([...revenueDaysForPreset("slnt", "weekdays")].sort()).toEqual([1, 2, 3, 4, 5]);
    expect([...revenueDaysForPreset("rdhotels", "all")].sort()).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(hasRevenueDayPreset(new Set([5, 6]), "slnt", "weekends")).toBe(false);
  });

  it("targets exactly the selected weekdays in April 2027", () => {
    const april = Array.from({ length: 30 }, (_, i) => new Date(Date.UTC(2027, 3, i + 1)));
    const selected = (org: string, days: Set<number>) =>
      april.filter((d) => days.has(d.getUTCDay())).map((d) => d.toISOString().slice(0, 10));
    expect(selected("rdhotels", revenueDaysForPreset("rdhotels", "weekends"))).toEqual([
      "2027-04-02", "2027-04-03", "2027-04-09", "2027-04-10",
      "2027-04-16", "2027-04-17", "2027-04-23", "2027-04-24", "2027-04-30",
    ]);
    const rdPlusSunday = revenueDaysForPreset("rdhotels", "weekends");
    rdPlusSunday.add(0);
    expect(selected("rdhotels", rdPlusSunday)).toHaveLength(13);
    expect(selected("slnt", revenueDaysForPreset("slnt", "weekends"))).toHaveLength(8);
  });
});
