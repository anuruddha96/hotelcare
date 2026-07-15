import { describe, expect, it } from "vitest";
import { classifyPmsHousekeepingRow } from "./pmsClassification";

describe("PMS housekeeping classification", () => {
  const row = (Room: string, Departure: string | null, nightTotal: string | null) => ({
    Room,
    Occupied: "Yes",
    Departure,
    CheckedOut: false,
    DepartureTomorrow: false,
    "Night / Total": nightTotal,
  });

  it("keeps uploaded last-night rooms in Daily when Departure is blank", () => {
    for (const room of [
      row("QRP-406", null, "2/2"),
      row("DB/TW-102", null, "2/2"),
      row("DB/TW-103", null, "2/2"),
      row("DB/TW-202", null, "3/3"),
      row("TRP-205", null, "2/2"),
    ]) {
      const result = classifyPmsHousekeepingRow(room);
      expect(result.isCheckoutRoom, room.Room).toBe(false);
      expect(result.isDailyRoom, room.Room).toBe(true);
      expect(result.isDepartureTomorrow, room.Room).toBe(true);
    }
  });

  it("classifies uploaded rows with Departure as Checkout", () => {
    for (const room of [
      row("Q-403", "11:00", null),
      row("DB/TW-203", "11:00", null),
      row("TRP-305", "11:00", null),
    ]) {
      const result = classifyPmsHousekeepingRow(room);
      expect(result.isCheckoutRoom, room.Room).toBe(true);
      expect(result.isDailyRoom, room.Room).toBe(false);
      expect(result.departureTime, room.Room).toBe("11:00");
    }
  });
});