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

  it("keeps uploaded last-night rooms in Daily when Departure is blank and no dated reservation exists", () => {
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

  it("classifies uploaded rows with Departure as Checkout when no dated reservation exists", () => {
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

  it("restores all ten Ottofiori Sept 21 departures from their dates even with blank time and in-house status", () => {
    const departures = ["101", "102", "103", "201", "202", "301", "305", "401", "404", "406"];
    for (const roomNumber of departures) {
      const result = classifyPmsHousekeepingRow({
        ...row(roomNumber, null, "2/2"),
        ArrivalDate: "2026-09-19",
        DepartureDate: "2026-09-21",
        RawReservationStatusId: 3,
      }, "2026-09-21");
      expect(result.isCheckoutRoom, roomNumber).toBe(true);
      expect(result.isScheduledDeparture, roomNumber).toBe(true);
      expect(result.isCheckedOut, roomNumber).toBe(false);
      expect(result.isDailyRoom, roomNumber).toBe(false);
      expect(result.isDepartureTomorrow, roomNumber).toBe(false);
    }
  });

  it("independently classifies tomorrow's departures on Sept 22 without carrying today's flags", () => {
    const tomorrowRow = {
      ...row("104", null, "2/2"),
      ArrivalDate: "2026-09-20",
      DepartureDate: "2026-09-22",
      RawReservationStatusId: 3,
    };
    const sept21 = classifyPmsHousekeepingRow(tomorrowRow, "2026-09-21");
    expect(sept21.isCheckoutRoom).toBe(false);
    expect(sept21.isDepartureTomorrow).toBe(true);
    expect(sept21.isDailyRoom).toBe(true);
    const sept22 = classifyPmsHousekeepingRow(tomorrowRow, "2026-09-22");
    expect(sept22.isCheckoutRoom).toBe(true);
    expect(sept22.isDepartureTomorrow).toBe(false);
    expect(sept22.isCheckedOut).toBe(false);
  });

  it("prioritizes dated departures over a contradictory stale Departure clock or C/O+1 flag", () => {
    const result = classifyPmsHousekeepingRow({
      ...row("203", "11:00", "2/2"),
      ArrivalDate: "2026-09-20",
      DepartureDate: "2026-09-22",
      DepartureTomorrow: false,
      RawReservationStatusId: 3,
    }, "2026-09-21");
    expect(result.isCheckoutRoom).toBe(false);
    expect(result.isDailyRoom).toBe(true);
    expect(result.isDepartureTomorrow).toBe(true);
    expect(result.isStayThrough).toBe(true);
  });

  it("does not classify an old departure date as a new-day checkout", () => {
    const result = classifyPmsHousekeepingRow({
      ...row("102", "11:00", "2/2"),
      ArrivalDate: "2026-09-19",
      DepartureDate: "2026-09-21",
      RawReservationStatusId: 3,
    }, "2026-09-22");
    expect(result.isScheduledDeparture).toBe(false);
    expect(result.isCheckoutRoom).toBe(false);
    expect(result.isDepartureTomorrow).toBe(false);
  });

  it("does not mark scheduled departures as checked out from occupancy alone", () => {
    expect(classifyPmsHousekeepingRow(row("Q-201", "11:00", null)).isCheckedOut).toBe(false);
    expect(classifyPmsHousekeepingRow({ ...row("Q-201", "11:00", null), Occupied: "No" }).isCheckedOut).toBe(false);
    expect(classifyPmsHousekeepingRow({ ...row("Q-201", "11:00", null), Status: "Checked out" }).isCheckedOut).toBe(true);
    expect(classifyPmsHousekeepingRow({ ...row("Q-201", "11:00", null), ReservationStatusId: 6 }).isCheckedOut).toBe(true);
    expect(classifyPmsHousekeepingRow({ ...row("Q-201", "11:00", null), ReservationStatusId: 5 }).isCheckedOut).toBe(false);
  });

  it("keeps reserved arrivals out of Daily until check-in", () => {
    const result = classifyPmsHousekeepingRow({
      Room: "Sobi Apartment",
      Occupied: "No",
      ArrivalDate: "2026-08-08",
      DepartureDate: "2026-08-12",
      NotArrived: true,
      RawReservationStatusId: 2,
      "Night / Total": "1/4",
    }, "2026-08-08");
    expect(result.isNotArrived).toBe(true);
    expect(result.isDailyRoom).toBe(false);
    expect(result.isStayThrough).toBe(false);
  });

  it("treats cancelled and no-show reservations as vacant even if date is today", () => {
    for (const status of [7, 8]) {
      const result = classifyPmsHousekeepingRow({
        Occupied: "No",
        Departure: "10:00",
        ArrivalDate: "2026-08-07",
        DepartureDate: "2026-08-08",
        RawReservationStatusId: status,
        IsNoShow: status === 8,
        IsCancelled: status === 7,
        "Night / Total": "1/3",
      }, "2026-08-08");
      expect(result.isCheckoutRoom).toBe(false);
      expect(result.isDailyRoom).toBe(false);
      expect(result.isCheckedOut).toBe(false);
      expect(result.isDepartureTomorrow).toBe(false);
    }
  });

  it("never marks an occupied mid-stay room as no-show, even if the PMS flag says so", () => {
    const result = classifyPmsHousekeepingRow({
      Room: "TRP-205",
      Occupied: "Yes",
      ArrivalDate: "2026-08-26",
      DepartureDate: "2026-08-31",
      RawReservationStatusId: 2,
      IsNoShow: true,
      "Night / Total": "2/5",
    }, "2026-08-28");
    expect(result.isNoShow).toBe(false);
    expect(result.isDailyRoom).toBe(true);
    expect(result.isCheckoutRoom).toBe(false);
  });

  it("keeps a real no-show (no occupancy, arrival today) flagged", () => {
    const result = classifyPmsHousekeepingRow({
      Room: "DB/TW-303",
      Occupied: "No",
      ArrivalDate: "2026-08-28",
      DepartureDate: "2026-08-30",
      RawReservationStatusId: 8,
      IsNoShow: true,
      "Night / Total": null,
    }, "2026-08-28");
    expect(result.isNoShow).toBe(true);
    expect(result.isDailyRoom).toBe(false);
    expect(result.isCheckoutRoom).toBe(false);
  });
});
