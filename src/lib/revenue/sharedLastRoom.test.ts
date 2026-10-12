import { describe, expect, it } from "vitest";
import { canOfferOneSharedRoom, shouldCloseSharedLastRoom } from "./sharedLastRoom";

describe("Last physical room offered in two categories", () => {
  it("keeps both listings available while the last room remains unsold", () => {
    expect(canOfferOneSharedRoom(21, 20, 1)).toBe(true);
    expect(shouldCloseSharedLastRoom(20, 20)).toBe(false);
  });
  it("closes both listings after the 21st room is confirmed booked", () => {
    expect(shouldCloseSharedLastRoom(20, 21)).toBe(true);
  });
  it("does not close prematurely after a booking and cancellation net to no pickup", () => {
    expect(shouldCloseSharedLastRoom(20, 20)).toBe(false);
  });
  it("does not enable pooled mode for two physical rooms or uncertain counts", () => {
    expect(canOfferOneSharedRoom(21, 19, 1)).toBe(false);
    expect(canOfferOneSharedRoom(21, 19, 2)).toBe(false);
    expect(canOfferOneSharedRoom(21, 21, 1)).toBe(false);
    expect(canOfferOneSharedRoom(21, Number.NaN, 1)).toBe(false);
    expect(shouldCloseSharedLastRoom(20, 21, 2)).toBe(false);
  });
});
