import { describe, expect, it } from "vitest";
import { standardRoomsToSellDecision } from "./roomsToSellAdjustment";

describe("standard rooms-to-sell workflow", () => {
  it("uses independent availability for increases without selecting an upgrade", () => {
    expect(standardRoomsToSellDecision(1, 0, 1)).toEqual({ kind: "standard", roomsToSell: 1 });
    expect(standardRoomsToSellDecision(2, 1, 5)).toEqual({ kind: "standard", roomsToSell: 2 });
  });
  it("reduces or closes a category without using linked-room allocation", () => {
    expect(standardRoomsToSellDecision(0, 1, 5)).toEqual({ kind: "standard", roomsToSell: 0 });
    expect(standardRoomsToSellDecision(1, 2, 5)).toEqual({ kind: "standard", roomsToSell: 1 });
  });
  it("avoids writing an unchanged count", () => {
    expect(standardRoomsToSellDecision(1, 1, 5)).toEqual({ kind: "unchanged" });
  });
  it("rejects fractions, negative, over-capacity and missing Previo availability", () => {
    for (const n of [-1, 1.5, NaN, 6]) {
      expect(standardRoomsToSellDecision(n, 1, 5).kind).toBe("invalid");
    }
    expect(standardRoomsToSellDecision(1, undefined, 5).kind).toBe("invalid");
  });
});
