import { describe, expect, it } from "vitest";
import { inferredGuestCapacity, validateFirstRateLadder, initialRateDates } from "./initialRoomRates";

describe("explicit first-time Previo room prices", () => {
  it("uses three guest levels for new Mika 2+1 but never guesses prices", () => {
    expect(inferredGuestCapacity("Double or twin 2+1")).toBe(3);
    expect(validateFirstRateLadder(["", "", ""], 3)).toBeNull();
  });
  it("rejects incomplete, invalid or decreasing occupancy ladders", () => {
    expect(validateFirstRateLadder(["150", "145", "160"], 3)).toBeNull();
    expect(validateFirstRateLadder(["150", "160", ""], 3)).toBeNull();
    expect(validateFirstRateLadder(["150", "160", "0"], 3)).toBeNull();
    expect(validateFirstRateLadder(["150", "160", "170"], 3)).toEqual([150, 160, 170]);
  });
  it("honors actual known guest levels instead of guessing from words", () => {
    expect(inferredGuestCapacity("Executive suite", [1, 2, 3, 4, 5, 6])).toBe(6);
  });
  it("restricts bulk initialization to a bounded calendar window", () => {
    expect(initialRateDates("2026-10-14", 7)).toHaveLength(7);
    expect(initialRateDates("2026-10-14", 999)).toEqual([]);
    expect(initialRateDates("not-a-date", 7)).toEqual([]);
  });
});
