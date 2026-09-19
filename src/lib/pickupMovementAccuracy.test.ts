import { describe, expect, it } from "vitest";
import { buildReservationMovementRows, sumReservationMovementRows } from "./pickupMovementAccuracy";
import type { BookingNight, CancelledNight } from "./revenueAnalytics";

const start = Date.parse("2026-09-17T06:30:00Z");
const cancelled = (stay_date: string, cancelled_at = "2026-09-19T04:16:08Z", room_key = "2301965"): CancelledNight => ({
  res_id: "114057191",
  obk_id: "977103",
  room_key,
  room_type_name: "Double Room",
  stay_date,
  stay_from: "2026-09-16",
  stay_to: "2026-09-22",
  nightly_price_eur: 152.98,
  cancelled_at,
  source_name: "Booking.com XML",
  guests: 2,
});
const booked = (stay_date: string, room_key = "room1"): BookingNight => ({
  res_id: "116108343",
  obk_id: "982615",
  room_key,
  room_type_name: "Single Room",
  stay_date,
  stay_from: "2026-09-23",
  stay_to: "2026-09-24",
  nightly_price_eur: 133.69,
  created_at_pms: "2026-09-18T19:06:46Z",
  guests: 1,
});

describe("accurate Previo movement presentation", () => {
  it("shows only cancelled remaining nights and the proper exclusive checkout", () => {
    const rows = buildReservationMovementRows([], [
      cancelled("2026-09-16", "2026-08-17T05:52:57Z", "old-room"),
      cancelled("2026-09-19"), cancelled("2026-09-20"), cancelled("2026-09-21"),
    ], start);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      resId: "114057191", kind: "cancelled", from: "2026-09-19", checkout: "2026-09-22",
      originalFrom: "2026-09-16", originalCheckout: "2026-09-22", nights: 3, value: 458.94,
    });
    expect(sumReservationMovementRows(rows)).toEqual({
      gained: 0, lost: 3, gainedValue: 0, lostValue: 458.94,
    });
  });

  it("treats a one-night reservation as check-in 23 Sep, checkout 24 Sep", () => {
    const rows = buildReservationMovementRows([booked("2026-09-23")], [], start);
    expect(rows[0]).toMatchObject({ from: "2026-09-23", checkout: "2026-09-24", nights: 1 });
  });

  it("uses exact nightly amounts for gained/lost/net and counts room-nights for groups", () => {
    const rows = buildReservationMovementRows(
      [booked("2026-09-23"), booked("2026-09-23", "room2")],
      [cancelled("2026-09-19")], start,
    );
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.kind === "booked")?.rooms).toHaveLength(2);
    expect(sumReservationMovementRows(rows)).toEqual({
      gained: 2, lost: 1, gainedValue: 267.38, lostValue: 152.98,
    });
  });

  it("does not double-count a duplicate imported room-night", () => {
    const rows = buildReservationMovementRows([], [cancelled("2026-09-19"), cancelled("2026-09-19")], start);
    expect(sumReservationMovementRows(rows).lost).toBe(1);
  });

  it("keeps separate cancellation events for the same reservation separate", () => {
    const rows = buildReservationMovementRows([], [
      cancelled("2026-09-19", "2026-09-18T10:00:00Z"),
      cancelled("2026-09-20", "2026-09-19T04:16:08Z"),
    ], start);
    expect(rows).toHaveLength(2);
    expect(sumReservationMovementRows(rows).lost).toBe(2);
  });

  it("excludes bookings and cancellations outside the 48-hour timestamp window", () => {
    const rows = buildReservationMovementRows(
      [{ ...booked("2026-09-23"), created_at_pms: "2026-09-15T01:00:00Z" }],
      [cancelled("2026-09-19", "2026-08-17T05:52:57Z")], start,
    );
    expect(rows).toEqual([]);
  });
});
