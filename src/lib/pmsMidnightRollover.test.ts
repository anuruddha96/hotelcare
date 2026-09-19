import { describe, expect, it } from "vitest";
import { todayBudapest, tomorrowBudapest, startOfBudapestDayUtc, rollForwardSelectedBusinessDate } from "./budapestTime";
import { budapestBusinessDate, budapestBusinessDayStartUtc } from "../../supabase/functions/_shared/budapestBusinessDate";
import { classifyPmsHousekeepingRow } from "./pmsClassification";

describe("Budapest housekeeping business dates", () => {
  it.each([
    ["2026-09-19T21:59:00Z", "2026-09-19"],
    ["2026-09-19T22:00:00Z", "2026-09-20"],
    ["2026-09-19T22:12:00Z", "2026-09-20"],
    ["2026-03-28T22:59:00Z", "2026-03-28"],
    ["2026-03-28T23:00:00Z", "2026-03-29"],
    ["2026-10-24T21:59:00Z", "2026-10-24"],
    ["2026-10-24T22:00:00Z", "2026-10-25"],
    ["2026-10-25T22:59:00Z", "2026-10-25"],
    ["2026-10-25T23:00:00Z", "2026-10-26"],
  ])("uses local date for %s", (instant, expected) => {
    const at = new Date(instant);
    expect(todayBudapest(at)).toBe(expected);
    expect(budapestBusinessDate(at)).toBe(expected);
  });

  it.each([
    ["2026-09-20", "2026-09-19T22:00:00.000Z"],
    ["2026-03-29", "2026-03-28T23:00:00.000Z"],
    ["2026-03-30", "2026-03-29T22:00:00.000Z"],
    ["2026-10-25", "2026-10-24T22:00:00.000Z"],
    ["2026-10-26", "2026-10-25T23:00:00.000Z"],
  ])("returns correct UTC history cutoff for %s", (day, expected) => {
    expect(startOfBudapestDayUtc(day)).toBe(expected);
    expect(budapestBusinessDayStartUtc(day)).toBe(expected);
  });

  it("rolls an open room board forward but protects selected dates and unsaved assignments", () => {
    expect(rollForwardSelectedBusinessDate("2026-09-19", "2026-09-19", "2026-09-20")).toBe("2026-09-20");
    expect(rollForwardSelectedBusinessDate("2026-09-18", "2026-09-19", "2026-09-20")).toBe("2026-09-18");
    expect(rollForwardSelectedBusinessDate("2026-09-21", "2026-09-19", "2026-09-20")).toBe("2026-09-21");
    expect(rollForwardSelectedBusinessDate("2026-09-19", "2026-09-19", "2026-09-20", true)).toBe("2026-09-19");
  });

  it("turns yesterday's seven C/O+1 rooms into today's scheduled checkouts only on a new PMS snapshot", () => {
    const before = new Date("2026-09-19T21:59:00Z");
    const after = new Date("2026-09-19T22:12:00Z");
    expect(todayBudapest(before)).toBe("2026-09-19");
    expect(tomorrowBudapest(before)).toBe("2026-09-20");
    expect(todayBudapest(after)).toBe("2026-09-20");

    const sevenPrevioRooms = Array.from({ length: 7 }, (_, index) => ({
      Room: `40${index + 1}`,
      Occupied: "Yes",
      DepartureDate: "2026-09-20",
      ArrivalDate: "2026-09-19",
      "Night / Total": "1/1",
    }));
    const yesterday = sevenPrevioRooms.map((room) =>
      classifyPmsHousekeepingRow({ ...room, Departure: null, DepartureTomorrow: true }, todayBudapest(before)),
    );
    expect(yesterday.filter((room) => room.isCheckoutRoom)).toHaveLength(0);
    expect(yesterday.filter((room) => room.isDepartureTomorrow)).toHaveLength(7);

    // On the new Budapest day, Previo must supply a fresh snapshot. A planned
    // departure must NEVER be interpreted as the guest physically checked out.
    const today = sevenPrevioRooms.map((room) =>
      classifyPmsHousekeepingRow({ ...room, Departure: "11:00", DepartureTomorrow: false, CheckedOut: false }, todayBudapest(after)),
    );
    expect(today.filter((room) => room.isCheckoutRoom)).toHaveLength(7);
    expect(today.filter((room) => room.isCheckedOut)).toHaveLength(0);
  });
});
