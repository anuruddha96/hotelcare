import { describe, expect, it } from "vitest";
import type { BookingNight, CancelledNight } from "@/lib/revenueAnalytics";
import {
  isFreshIndicativeQuote, matchesRoomNight, movementInWindow, priceDifference,
  reservationJourneyEvents, safeEvidenceUrl, selectRoomStayMovements,
  sortedJourneyEvents,
} from "@/lib/revenue/priceDemandJourney";

const stay = "2026-12-30";
const room = "Economy Double";
const obk = "982505";
const bookedAt = "2026-11-20T12:00:00.000Z";
const cancelledAt = "2026-11-19T12:00:00.000Z";

function booking(fields: Partial<BookingNight> = {}): BookingNight {
  return {
    stay_date: stay, res_id: "R1", room_key: "101", obk_id: obk,
    room_type_name: room, nightly_price_eur: 150, stay_from: "2026-12-29",
    stay_to: "2027-01-02", source_name: "Booking.com",
    created_at_pms: bookedAt, guests: 2, ...fields,
  };
}

function cancellation(fields: Partial<CancelledNight> = {}): CancelledNight {
  return {
    stay_date: stay, res_id: "C1", room_key: "102", obk_id: obk,
    room_type_name: room, nightly_price_eur: 130,
    stay_from: "2026-12-29", stay_to: "2027-01-02",
    source_name: "Direct", created_at_pms: "2026-11-01T12:00:00.000Z",
    guests: 2, cancelled_at: cancelledAt, ...fields,
  };
}

describe("price and demand journey evidence", () => {
  it("calculates signed price changes and never invents a missing previous price", () => {
    expect(priceDifference(133, 128)).toBe(-5);
    expect(priceDifference(138, 133)).toBe(-5);
    expect(priceDifference(100, 110)).toBe(10);
    expect(priceDifference(100, 100)).toBe(0);
    expect(priceDifference(null, 110)).toBe(null);
    expect(priceDifference(100, Number.NaN)).toBe(null);
  });

  it("matches the selected STAY night and PMS room type, not guest count or rate plan", () => {
    expect(matchesRoomNight(booking(), stay, room, obk)).toBe(true);
    expect(matchesRoomNight(booking({ room_type_name: "Czech translated label" }), stay, room, obk)).toBe(true);
    expect(matchesRoomNight(booking({ obk_id: "unrelated-room" }), stay, room, obk)).toBe(false);
    expect(matchesRoomNight(booking({ stay_date: "2026-12-31" }), stay, room, obk)).toBe(false);
    expect(matchesRoomNight(booking({ obk_id: null }), stay, room, obk)).toBe(true);
  });

  it("keeps real cancellations when there are no active reservations for this room type", () => {
    const rows = selectRoomStayMovements(
      [booking({ room_type_name: "Deluxe Queen", obk_id: "other" })],
      [cancellation(), cancellation({ stay_date: "2026-12-31" })],
      stay, room, obk,
    );
    expect(rows.active).toHaveLength(0);
    expect(rows.cancelled).toHaveLength(1);
    expect(reservationJourneyEvents(rows)[0].kind).toBe("cancellation");
  });

  it("deduplicates room nights by reservation and actual room key without dropping multi-room bookings", () => {
    const rooms = selectRoomStayMovements(
      [booking(), booking(), booking({ room_key: "103" })], [], stay, room, obk,
    );
    expect(rooms.active).toHaveLength(2);
  });

  it("does not include source-less multi-year inventory holds as actual commercial bookings", () => {
    const movements = selectRoomStayMovements(
      [booking({ source_name: null, stay_from: "2025-01-01", stay_to: "2027-01-02" })],
      [], stay, room, obk,
    );
    expect(movements.active).toHaveLength(0);
  });

  it("counts only timestamped actual pickup and cancellations, including the exact date boundaries", () => {
    const movements = selectRoomStayMovements(
      [booking(), booking({ res_id: "R2", room_key: "104", created_at_pms: null })],
      [cancellation()], stay, room, obk,
    );
    const asOf = Date.parse("2026-11-21T12:00:00.000Z");
    expect(movementInWindow(movements, 7, asOf)).toEqual({ bookings: 1, cancellations: 1, net: 0 });
    expect(movementInWindow(movements, 1, asOf)).toEqual({ bookings: 1, cancellations: 0, net: 1 });
    const timeline = sortedJourneyEvents(reservationJourneyEvents(movements));
    expect(timeline[0].kind).toBe("booking");
    expect(timeline.find((event) => event.kind === "cancellation")?.at).toBe(cancelledAt);
  });

  it("does not promote an unverified market observation into a fresh comparable rate", () => {
    const now = Date.parse("2026-11-21T12:00:00.000Z");
    const fresh = { competitor_id: "c1", rate: 160, currency: "EUR", confidence: 0.8, captured_at: bookedAt };
    expect(isFreshIndicativeQuote(fresh, now)).toBe(true);
    expect(isFreshIndicativeQuote({ ...fresh, currency: "HUF" }, now)).toBe(false);
    expect(isFreshIndicativeQuote({ ...fresh, confidence: 0.2 }, now)).toBe(false);
    expect(isFreshIndicativeQuote({ ...fresh, captured_at: "2026-11-11T12:00:00.000Z" }, now)).toBe(false);
  });

  it("accepts only HTTP(S) source links", () => {
    expect(safeEvidenceUrl("https://example.com/rates")).toBe("https://example.com/rates");
    expect(safeEvidenceUrl("javascript:alert(1)")).toBe(null);
    expect(safeEvidenceUrl("not a URL")).toBe(null);
  });
});
