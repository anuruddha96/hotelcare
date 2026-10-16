import { describe, expect, it } from "vitest";
import { recoverGozsduScheduledDeparture } from "../../supabase/functions/_shared/gozsduScheduledDepartureEvidence";

const date = "2026-10-16";
const inHouseTurnover = {
  Room: "1BBALC-5002", RoomId: 1856763,
  Occupied: "Yes", CheckedOut: false, IsCheckoutRoom: true,
  Arrival: null, Departure: "11:00",
  NotArrived: false, IsNoShow: false, IsCancelled: false,
  RawReservationStatusId: 3,
  ArrivalDate: "2026-10-15", DepartureDate: date,
  NextArrivalArrivalDate: date, People: 2,
};

describe("Gozsdu missing overnight snapshot recovery", () => {
  it("recovers today's scheduled departure with a same-day incoming booking", () => {
    expect(recoverGozsduScheduledDeparture(inHouseTurnover, 1856763, date)).toEqual({
      status: "departing", arrival_date: "2026-10-15", departure_date: date, pax: 2,
    });
  });
  it("never describes the still-in-house guest as vacant or checked out", () => {
    const result = recoverGozsduScheduledDeparture(inHouseTurnover, 1856763, date);
    expect(result).toEqual({ status: "departing", arrival_date: "2026-10-15", departure_date: date, pax: 2 });
    expect(result).not.toHaveProperty("checkedOutToday");
    expect(result).not.toHaveProperty("readyToClean");
    expect(result).not.toHaveProperty("pmsVacancyVerifiedAt");
  });
  it("rejects a mismatched physical room ID or stale day", () => {
    expect(recoverGozsduScheduledDeparture(inHouseTurnover, 99999, date)).toBeNull();
    expect(recoverGozsduScheduledDeparture(inHouseTurnover, 1856763, "2026-10-17")).toBeNull();
  });
  it("rejects pending arrivals, no-shows, cancelled, and future stays", () => {
    for (const patch of [
      { Arrival: "15:00" }, { NotArrived: true }, { IsNoShow: true },
      { IsCancelled: true }, { ArrivalDate: date }, { DepartureDate: "2026-10-17" },
      { RawReservationStatusId: 8 }, { Occupied: "No" }, { IsCheckoutRoom: false },
      { Departure: null },
    ]) {
      expect(recoverGozsduScheduledDeparture({ ...inHouseTurnover, ...patch }, 1856763, date)).toBeNull();
    }
  });
  it("preserves explicit checkout evidence, without inferring it from a same-day arrival", () => {
    const checkout = { ...inHouseTurnover, RawReservationStatusId: 6, CheckedOut: true };
    expect(recoverGozsduScheduledDeparture(checkout, 1856763, date)?.status).toBe("departing");
    expect(recoverGozsduScheduledDeparture({ ...inHouseTurnover, CheckedOut: true }, 1856763, date)).toBeNull();
  });
});
