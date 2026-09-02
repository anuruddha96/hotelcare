import { describe, expect, it } from "vitest";
import {
  datesOverlap,
  formatMoney,
  isLateArrivalCandidate,
  isPmsManaged,
  lifecycleErrorKey,
  matchesQuickFilter,
  nightsBetween,
  reservationGuestLabel,
  roomReadiness,
} from "./reservations";

const TODAY = "2026-09-02";

describe("nightsBetween", () => {
  it("computes nights for a normal stay", () => {
    expect(nightsBetween("2026-09-02", "2026-09-05")).toBe(3);
  });
  it("never returns negative nights", () => {
    expect(nightsBetween("2026-09-05", "2026-09-02")).toBe(0);
  });
  it("handles invalid input", () => {
    expect(nightsBetween("bad", "2026-09-05")).toBe(0);
  });
});

describe("datesOverlap (half-open intervals)", () => {
  it("detects an overlap", () => {
    expect(datesOverlap("2026-09-01", "2026-09-05", "2026-09-04", "2026-09-08")).toBe(true);
  });
  it("back-to-back stays do not overlap (checkout day = next check-in)", () => {
    expect(datesOverlap("2026-09-01", "2026-09-05", "2026-09-05", "2026-09-08")).toBe(false);
    expect(datesOverlap("2026-09-05", "2026-09-08", "2026-09-01", "2026-09-05")).toBe(false);
  });
  it("containment overlaps", () => {
    expect(datesOverlap("2026-09-01", "2026-09-10", "2026-09-03", "2026-09-04")).toBe(true);
  });
});

describe("reservationGuestLabel", () => {
  const base = { status: "confirmed", check_in_date: TODAY, check_out_date: "2026-09-04" };
  it("prefers the joined guest profile", () => {
    expect(
      reservationGuestLabel({ ...base, guests: { first_name: "Anna", last_name: "Kovacs" } }),
    ).toBe("Anna Kovacs");
  });
  it("falls back to the PMS guest label", () => {
    expect(reservationGuestLabel({ ...base, pms_guest_name: "J. Smith" })).toBe("J. Smith");
  });
  it("shows a PMS booking ref instead of inventing a name", () => {
    expect(
      reservationGuestLabel({ ...base, source: "previo", source_reservation_id: "123456:801" }),
    ).toBe("Previo #123456");
  });
  it("falls back to the reservation number", () => {
    expect(reservationGuestLabel({ ...base, reservation_number: "RES-20260902-0001" })).toBe(
      "RES-20260902-0001",
    );
  });
});

describe("matchesQuickFilter", () => {
  const res = (over: Record<string, unknown>) => ({
    status: "confirmed",
    check_in_date: TODAY,
    check_out_date: "2026-09-04",
    ...over,
  });
  it("arrivals = today's pending/confirmed check-ins", () => {
    expect(matchesQuickFilter(res({}), "arrivals", TODAY)).toBe(true);
    expect(matchesQuickFilter(res({ status: "checked_in" }), "arrivals", TODAY)).toBe(false);
    expect(matchesQuickFilter(res({ check_in_date: "2026-09-03" }), "arrivals", TODAY)).toBe(false);
  });
  it("departures = today's checked-in checkouts", () => {
    expect(
      matchesQuickFilter(res({ status: "checked_in", check_in_date: "2026-08-30", check_out_date: TODAY }), "departures", TODAY),
    ).toBe(true);
    expect(
      matchesQuickFilter(res({ status: "confirmed", check_out_date: TODAY }), "departures", TODAY),
    ).toBe(false);
  });
  it("inhouse and future and terminal filters", () => {
    expect(matchesQuickFilter(res({ status: "checked_in" }), "inhouse", TODAY)).toBe(true);
    expect(matchesQuickFilter(res({ check_in_date: "2026-09-10" }), "future", TODAY)).toBe(true);
    expect(matchesQuickFilter(res({ status: "cancelled" }), "cancelled", TODAY)).toBe(true);
    expect(matchesQuickFilter(res({ status: "no_show" }), "no_show", TODAY)).toBe(true);
  });
});

describe("isLateArrivalCandidate", () => {
  it("flags confirmed bookings with a past arrival date", () => {
    expect(
      isLateArrivalCandidate(
        { status: "confirmed", check_in_date: "2026-08-31", check_out_date: "2026-09-04" },
        TODAY,
      ),
    ).toBe(true);
  });
  it("ignores checked-in and today's arrivals", () => {
    expect(
      isLateArrivalCandidate(
        { status: "checked_in", check_in_date: "2026-08-31", check_out_date: "2026-09-04" },
        TODAY,
      ),
    ).toBe(false);
    expect(
      isLateArrivalCandidate(
        { status: "confirmed", check_in_date: TODAY, check_out_date: "2026-09-04" },
        TODAY,
      ),
    ).toBe(false);
  });
});

describe("formatMoney", () => {
  it("formats HUF with Ft suffix and no decimals", () => {
    expect(formatMoney(26041.4, "HUF")).toMatch(/26\s?041 Ft/);
  });
  it("formats EUR", () => {
    expect(formatMoney(120, "EUR")).toBe("€120");
  });
  it("handles null", () => {
    expect(formatMoney(null, "EUR")).toBe("€0");
  });
});

describe("misc helpers", () => {
  it("isPmsManaged only for previo source", () => {
    expect(isPmsManaged({ source: "previo" })).toBe(true);
    expect(isPmsManaged({ source: "direct" })).toBe(false);
    expect(isPmsManaged({ source: null })).toBe(false);
  });
  it("roomReadiness maps statuses", () => {
    expect(roomReadiness(null)).toBe("unassigned");
    expect(roomReadiness({ status: "clean" })).toBe("clean");
    expect(roomReadiness({ status: "dirty" })).toBe("dirty");
    expect(roomReadiness({ status: "occupied" })).toBe("occupied");
    expect(roomReadiness({ status: "maintenance" })).toBe("other");
  });
  it("lifecycleErrorKey extracts known codes", () => {
    expect(lifecycleErrorKey(new Error('ROOM_CONFLICT'))).toBe("pms.err.roomConflict");
    expect(lifecycleErrorKey({ message: "P0001: BALANCE_DUE" })).toBe("pms.err.balanceDue");
    expect(lifecycleErrorKey(new Error("something else"))).toBe(null);
  });
});
