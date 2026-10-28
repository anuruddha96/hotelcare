import { describe, expect, it } from "vitest";
import { budapestBusinessDate, isHistoricalRateDate } from "./rateWriteDates";

describe("Previo rate write dates", () => {
  it("uses the hotel business date at the UTC midnight boundary", () => {
    const at = new Date("2026-10-19T22:30:00Z"); // 00:30 on October 20 in Budapest
    expect(budapestBusinessDate(at)).toBe("2026-10-20");
    expect(isHistoricalRateDate("2026-10-19", at)).toBe(true);
    expect(isHistoricalRateDate("2026-10-20", at)).toBe(false);
    expect(isHistoricalRateDate("2026-10-21", at)).toBe(false);
  });

  it("handles the daylight-saving change without using a fixed UTC offset", () => {
    const at = new Date("2026-10-25T23:30:00Z");
    expect(budapestBusinessDate(at)).toBe("2026-10-26");
    expect(isHistoricalRateDate("2026-10-25", at)).toBe(true);
  });
});
