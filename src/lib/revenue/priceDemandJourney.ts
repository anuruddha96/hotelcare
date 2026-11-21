import type { BookingNight, CancelledNight } from "@/lib/revenueAnalytics";
import { isNonCommercialInventoryHold } from "@/lib/revenueAnalytics";

/**
 * A rate cell is (stay date, PMS room type, guest count/rate plan).
 * Booking demand is (stay date, PMS room type) across ALL its rate plans.
 * Comparing only a rate plan would hide genuine bookings from other plans.
 */
export function matchesRoomNight(
  row: { stay_date: string; obk_id?: string | null; room_type_name?: string | null },
  stayDate: string,
  roomTypeName: string,
  obkId?: string | null,
): boolean {
  if (String(row.stay_date).slice(0, 10) !== stayDate) return false;
  // The PMS OBK is authoritative when both sides have it. Names may be
  // translated or changed; never let a matching label override a different OBK.
  if (obkId && row.obk_id) return String(row.obk_id) === String(obkId);
  const normalize = (s: string | null | undefined) => (s ?? "").trim().toLocaleLowerCase();
  return !!normalize(row.room_type_name) && normalize(row.room_type_name) === normalize(roomTypeName);
}

function uniqueByStay<T extends { res_id: string; room_key?: string | null }>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    // A reservation can contain several actual rooms; room_key distinguishes
    // them when available. No room_key means count a booking reference once.
    const key = String(row.res_id) + "|" + (row.room_key || "");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export interface RoomStayMovements {
  active: BookingNight[];
  cancelled: CancelledNight[];
}

export function selectRoomStayMovements(
  nights: BookingNight[],
  cancellations: CancelledNight[],
  stayDate: string,
  roomTypeName: string,
  obkId?: string | null,
): RoomStayMovements {
  return {
    active: uniqueByStay(nights.filter((row) =>
      matchesRoomNight(row, stayDate, roomTypeName, obkId)
      && !isNonCommercialInventoryHold(row)
    )),
    cancelled: uniqueByStay(cancellations.filter((row) =>
      matchesRoomNight(row, stayDate, roomTypeName, obkId)
      && !isNonCommercialInventoryHold(row)
    )),
  };
}

/**
 * Counts booking REFERENCES affecting this one night, never the number of
 * occupied rooms or a fake "conversion rate". Timestamps come from Previo.
 */
export function movementInWindow(movements: RoomStayMovements, days: number, nowMs: number) {
  const since = nowMs - days * 86_400_000;
  const inside = (stamp: string | null | undefined) => {
    const at = Date.parse(stamp || "");
    return Number.isFinite(at) && at >= since && at <= nowMs;
  };
  const bookings = movements.active.filter((row) => inside(row.created_at_pms)).length;
  const cancellations = movements.cancelled.filter((row) => inside(row.cancelled_at)).length;
  return { bookings, cancellations, net: bookings - cancellations };
}

export type JourneyEventType = "booking" | "cancellation" | "price";
export interface JourneyEvent {
  id: string;
  kind: JourneyEventType;
  at: string | null;
  title: string;
  detail: string | null;
  price: number | null;
  source: string | null;
}

/** Timeline is strictly the selected room type and stay night. */
export function reservationJourneyEvents(movements: RoomStayMovements): JourneyEvent[] {
  const booked: JourneyEvent[] = movements.active.map((row) => ({
    id: "booked-" + row.res_id + "-" + (row.room_key || ""),
    kind: "booking",
    at: row.created_at_pms,
    title: "Reservation received",
    detail: [row.stay_from && row.stay_to ? row.stay_from + " to " + row.stay_to : null,
      row.guests != null ? String(row.guests) + " guests" : null,
      "Reservation #" + row.res_id].filter(Boolean).join(" · "),
    source: row.source_name || null,
    price: row.nightly_price_eur == null ? null : Number(row.nightly_price_eur),
  }));
  const cancelled: JourneyEvent[] = movements.cancelled.map((row) => ({
    id: "cancelled-" + row.res_id + "-" + (row.room_key || ""),
    kind: "cancellation",
    at: row.cancelled_at,
    title: "Reservation cancelled",
    detail: [row.stay_from && row.stay_to ? row.stay_from + " to " + row.stay_to : null,
      "Reservation #" + row.res_id].filter(Boolean).join(" · "),
    source: row.source_name || null,
    price: row.nightly_price_eur == null ? null : Number(row.nightly_price_eur),
  }));
  return [...booked, ...cancelled];
}

export function sortedJourneyEvents(events: JourneyEvent[]) {
  return [...events].sort((a, b) => {
    const atA = Date.parse(a.at || "") || 0;
    const atB = Date.parse(b.at || "") || 0;
    return atB - atA || a.id.localeCompare(b.id);
  });
}

export interface MarketObservation {
  competitor_id: string;
  rate: number | null;
  currency: string | null;
  confidence: number | null;
  captured_at: string | null;
}

/**
 * Do not treat stale, non-EUR, low confidence quotes as a current market rate.
 * The observations are still INDICATIVE: room, board, and cancellation terms
 * need matching before a true competitor price parity claim is possible.
 */
export function isFreshIndicativeQuote(row: MarketObservation, nowMs: number): boolean {
  const captured = Date.parse(row.captured_at || "");
  const rate = Number(row.rate);
  return row.currency?.toUpperCase() === "EUR"
    && row.rate != null && Number.isFinite(rate) && rate > 0
    && (row.confidence == null || Number(row.confidence) >= 0.45)
    && Number.isFinite(captured)
    && captured <= nowMs && nowMs - captured <= 72 * 60 * 60 * 1000;
}

export function safeEvidenceUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
