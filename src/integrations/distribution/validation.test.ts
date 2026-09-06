import { describe, expect, it } from "vitest";
import { validateAriUpdate } from "./validation";

const baseUpdate = {
  hotelId: "hotel-1",
  roomTypeId: "room-standard",
  startDate: "2026-09-10",
};

describe("validateAriUpdate", () => {
  it("accepts a valid price update", () => {
    const result = validateAriUpdate({
      ...baseUpdate,
      price: 149,
      currency: "EUR",
    });

    expect(result).toEqual({ valid: true, errors: [] });
  });

  it("accepts inventory and restriction updates without a price", () => {
    const result = validateAriUpdate({
      ...baseUpdate,
      inventory: 4,
      restrictions: { minStay: 2, stopSell: false },
    });

    expect(result.valid).toBe(true);
  });

  it("rejects an empty ARI mutation", () => {
    const result = validateAriUpdate(baseUpdate);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "ARI update must change price, inventory or restrictions",
    );
  });

  it("rejects invalid dates and date ranges", () => {
    const result = validateAriUpdate({
      ...baseUpdate,
      startDate: "2026-09-12",
      endDate: "2026-09-10",
      inventory: 1,
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("endDate cannot be before startDate");
  });

  it("requires currency when price is supplied", () => {
    const result = validateAriUpdate({
      ...baseUpdate,
      price: 120,
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "currency must be a 3-letter uppercase ISO currency when price is set",
    );
  });

  it("rejects impossible stay restrictions", () => {
    const result = validateAriUpdate({
      ...baseUpdate,
      inventory: 1,
      restrictions: { minStay: 4, maxStay: 2 },
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("maxStay cannot be lower than minStay");
  });
});
