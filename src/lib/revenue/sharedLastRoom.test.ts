import { describe, expect, it } from "vitest";
import { activeTransferLookups, canOfferOneSharedRoom, shouldCloseSharedLastRoom } from "./sharedLastRoom";

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

describe("reopening the original room from an existing exclusive upgrade", () => {
  const rules = [
    { source_obk_id: "982617", target_obk_id: "976815", stay_date: "2026-10-13", status: "active" },
    { source_obk_id: "other-quad", target_obk_id: "other-queen", stay_date: "2026-10-14", status: "closed" },
  ];
  it("finds the previously promoted Queen when the original Quad is reopened", () => {
    const lookup = activeTransferLookups(rules);
    expect(lookup.promotedByOriginal.get("982617|2026-10-13")).toBe("976815");
    expect(lookup.originalByPromoted.get("976815|2026-10-13")).toBe("982617");
  });
  it("does not treat already closed or different-day transfers as reusable inventory", () => {
    const lookup = activeTransferLookups(rules);
    expect(lookup.promotedByOriginal.has("other-quad|2026-10-14")).toBe(false);
    expect(lookup.promotedByOriginal.has("982617|2026-10-14")).toBe(false);
  });
});
