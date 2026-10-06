import { describe, expect, it } from "vitest";
import {
  assertReservationStatusTransition,
  buildReservationIdempotencyKey,
  calculateAvailableInventory,
  canTransitionReservationStatus,
  expandStayNights,
} from "../reservations";

describe("reservation lifecycle", () => {
  it("allows the normal confirmed stay lifecycle", () => {
    expect(canTransitionReservationStatus("tentative", "confirmed")).toBe(true);
    expect(canTransitionReservationStatus("confirmed", "checked_in")).toBe(true);
    expect(canTransitionReservationStatus("checked_in", "checked_out")).toBe(true);
  });

  it("allows cancellation and no-show only before check-in", () => {
    expect(canTransitionReservationStatus("tentative", "cancelled")).toBe(true);
    expect(canTransitionReservationStatus("confirmed", "cancelled")).toBe(true);
    expect(canTransitionReservationStatus("confirmed", "no_show")).toBe(true);
    expect(canTransitionReservationStatus("checked_in", "cancelled")).toBe(false);
  });

  it("treats terminal states as terminal and rejects no-op transitions", () => {
    expect(canTransitionReservationStatus("checked_out", "confirmed")).toBe(false);
    expect(canTransitionReservationStatus("cancelled", "confirmed")).toBe(false);
    expect(canTransitionReservationStatus("no_show", "confirmed")).toBe(false);
    expect(canTransitionReservationStatus("confirmed", "confirmed")).toBe(false);
  });

  it("throws for an invalid transition", () => {
    expect(() => assertReservationStatusTransition("checked_out", "checked_in")).toThrow(
      "Invalid reservation status transition",
    );
  });
});

describe("stay-night expansion", () => {
  it("creates arrival-inclusive and departure-exclusive nights", () => {
    expect(expandStayNights("2026-09-15", "2026-09-18")).toEqual([
      "2026-09-15",
      "2026-09-16",
      "2026-09-17",
    ]);
  });

  it("handles a one-night stay", () => {
    expect(expandStayNights("2026-10-24", "2026-10-25")).toEqual(["2026-10-24"]);
  });

  it("does not drift across the European DST boundary because it uses UTC dates", () => {
    expect(expandStayNights("2026-10-24", "2026-10-27")).toEqual([
      "2026-10-24",
      "2026-10-25",
      "2026-10-26",
    ]);
  });

  it("rejects impossible or reversed stays", () => {
    expect(() => expandStayNights("2026-02-30", "2026-03-02")).toThrow("Invalid calendar date");
    expect(() => expandStayNights("2026-09-15", "2026-09-15")).toThrow(
      "Departure date must be after arrival date",
    );
    expect(() => expandStayNights("15-09-2026", "2026-09-16")).toThrow("Invalid ISO date");
  });
});

describe("canonical inventory", () => {
  it("subtracts reservations, out-of-order rooms and blocks", () => {
    expect(
      calculateAvailableInventory({
        physicalInventory: 20,
        reserved: 11,
        outOfOrder: 1,
        blocks: 2,
      }),
    ).toBe(6);
  });

  it("adds an explicit overbooking allowance and never returns negative inventory", () => {
    expect(
      calculateAvailableInventory({
        physicalInventory: 10,
        reserved: 10,
        outOfOrder: 1,
        blocks: 0,
        overbookingAllowance: 2,
      }),
    ).toBe(1);

    expect(
      calculateAvailableInventory({
        physicalInventory: 3,
        reserved: 5,
        outOfOrder: 1,
        blocks: 0,
      }),
    ).toBe(0);
  });

  it("rejects negative and fractional inventory inputs", () => {
    expect(() =>
      calculateAvailableInventory({ physicalInventory: -1, reserved: 0, outOfOrder: 0, blocks: 0 }),
    ).toThrow("physicalInventory must be a non-negative integer");

    expect(() =>
      calculateAvailableInventory({ physicalInventory: 10, reserved: 1.5, outOfOrder: 0, blocks: 0 }),
    ).toThrow("reserved must be a non-negative integer");
  });
});

describe("external reservation identity", () => {
  it("is deterministic and normalizes organization/provider names", () => {
    const first = buildReservationIdempotencyKey({
      organizationSlug: " RDHOTELS ",
      hotelId: "hotel-1",
      sourceSystem: " Previo ",
      externalReservationId: "ABC-123",
    });
    const second = buildReservationIdempotencyKey({
      organizationSlug: "rdhotels",
      hotelId: "hotel-1",
      sourceSystem: "previo",
      externalReservationId: "ABC-123",
    });

    expect(first).toBe(second);
  });

  it("keeps otherwise-identical reservations separate across organizations", () => {
    const first = buildReservationIdempotencyKey({
      organizationSlug: "rdhotels",
      hotelId: "hotel-1",
      sourceSystem: "previo",
      externalReservationId: "ABC-123",
    });
    const second = buildReservationIdempotencyKey({
      organizationSlug: "other-org",
      hotelId: "hotel-1",
      sourceSystem: "previo",
      externalReservationId: "ABC-123",
    });

    expect(first).not.toBe(second);
  });

  it("escapes delimiters so different identities cannot collapse into the same key", () => {
    const first = buildReservationIdempotencyKey({
      organizationSlug: "rdhotels",
      hotelId: "hotel:1",
      sourceSystem: "booking.com",
      externalReservationId: "A:B",
    });
    const second = buildReservationIdempotencyKey({
      organizationSlug: "rdhotels",
      hotelId: "hotel",
      sourceSystem: "1:booking.com",
      externalReservationId: "A:B",
    });

    expect(first).not.toBe(second);
  });

  it("requires all external identity fields", () => {
    expect(() =>
      buildReservationIdempotencyKey({
        organizationSlug: "rdhotels",
        hotelId: "hotel-1",
        sourceSystem: "previo",
        externalReservationId: " ",
      }),
    ).toThrow(
      "organizationSlug, hotelId, sourceSystem and externalReservationId are required",
    );
  });
});
