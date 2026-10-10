import { describe, expect, it } from "vitest";
import { isDirectChannel, movementAdr, movementGoalDelta, movementRoomNights } from "./bookingMovementPresentation";

describe("unified booking movement display", () => {
  it("uses distinct room-nights for group booking ADR", () => {
    const reservation = { rooms: [{ nights: 3 }, { nights: 3 }], value: 900 };
    expect(movementRoomNights(reservation)).toBe(6);
    expect(movementAdr(reservation)).toBe(150);
    expect(movementGoalDelta(movementAdr(reservation), 130)).toBe(20);
  });
  it("does not label missing/zero room revenue as below target", () => {
    expect(movementAdr({ rooms: [{ nights: 2 }], value: 0 })).toBeNull();
    expect(movementGoalDelta(null, 130)).toBeNull();
    expect(movementGoalDelta(150, null)).toBeNull();
  });
  it("recognises partner channels and direct sources", () => {
    expect(isDirectChannel("770 Booking.com XML")).toBe(false);
    expect(isDirectChannel("Expedia")).toBe(false);
    expect(isDirectChannel("1 RESERVATION+")).toBe(true);
    expect(isDirectChannel(null)).toBe(false);
    expect(isDirectChannel("Direct / unknown")).toBe(false);
  });
  it("detects bookings below their explicit property target", () => {
    expect(movementGoalDelta(127, 130)).toBe(-3);
    expect(movementGoalDelta(130, 130)).toBe(0);
  });
});
