import { addDays, type BookingNight, type CancelledNight } from "@/lib/revenueAnalytics";

export type MovementKind = "booked" | "cancelled";
type MovementNight = BookingNight | CancelledNight;

export interface MovementRoom {
  key: string;
  roomType: string;
  nights: number;
  value: number;
}

export interface ReservationMovementRow {
  key: string;
  resId: string;
  kind: MovementKind;
  at: string;
  /** First ACTUALLY affected night, not the original check-in date. */
  from: string;
  /** Exclusive checkout after the last affected night. */
  checkout: string;
  /** Original reservation dates are context only; never substitute for affected dates. */
  originalFrom: string;
  originalCheckout: string;
  nights: number;
  rooms: MovementRoom[];
  guests: number;
  value: number;
  channel: string;
}

const roomKey = (row: MovementNight) => row.room_key || row.obk_id || row.room_type_name || "room";
const eventTime = (row: MovementNight, kind: MovementKind) =>
  kind === "booked" ? row.created_at_pms : (row as CancelledNight).cancelled_at;
const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/**
 * The PMS may cancel only the unconsumed nights of an in-house reservation.
 * Its original stay_from/stay_to still describe the WHOLE original booking.
 * Group events by reservation AND event timestamp (separate cancellations must
 * never be fused), then derive the visible affected range from stay_date.
 * stay_to is an exclusive checkout date, not the last occupied night.
 */
export function buildReservationMovementRows(
  bookings: BookingNight[],
  cancellations: CancelledNight[],
  windowStartMs: number,
): ReservationMovementRow[] {
  const result: ReservationMovementRow[] = [];
  for (const [kind, source] of [
    ["booked", bookings],
    ["cancelled", cancellations],
  ] as const) {
    const groups = new Map<string, MovementNight[]>();
    for (const row of source) {
      const at = eventTime(row, kind);
      const time = at ? Date.parse(at) : NaN;
      if (!Number.isFinite(time) || time < windowStartMs || !row.stay_date || !row.res_id) continue;
      const key = `${kind}|${row.res_id}|${at}`;
      const bucket = groups.get(key) ?? [];
      bucket.push(row);
      groups.set(key, bucket);
    }

    for (const [key, group] of groups) {
      const unique = new Map<string, MovementNight>();
      for (const row of group) unique.set(`${roomKey(row)}|${row.stay_date}`, row);
      const rows = [...unique.values()];
      if (!rows.length) continue;
      const dates = rows.map((row) => row.stay_date).sort();
      const from = dates[0];
      const checkout = addDays(dates[dates.length - 1], 1);
      const originalFrom = rows.map((row) => row.stay_from).filter((d): d is string => !!d).sort()[0] ?? from;
      const originalCheckout = rows.map((row) => row.stay_to).filter((d): d is string => !!d).sort().at(-1) ?? checkout;
      const byRoom = new Map<string, MovementNight[]>();
      for (const row of rows) {
        const id = roomKey(row);
        const bucket = byRoom.get(id) ?? [];
        bucket.push(row);
        byRoom.set(id, bucket);
      }
      const rooms = [...byRoom].map(([id, roomRows]) => ({
        key: id,
        roomType: roomRows[0].room_type_name ?? "Room",
        nights: new Set(roomRows.map((row) => row.stay_date)).size,
        value: roundMoney(roomRows.reduce((sum, row) => sum + (Number(row.nightly_price_eur) || 0), 0)),
      }));
      result.push({
        key,
        resId: rows[0].res_id,
        kind,
        at: eventTime(rows[0], kind)!,
        from,
        checkout,
        originalFrom,
        originalCheckout,
        nights: new Set(dates).size,
        rooms,
        guests: Math.max(1, ...rows.map((row) => Number(row.guests) || 1)),
        value: roundMoney(rooms.reduce((sum, room) => sum + room.value, 0)),
        channel: rows[0].source_name ?? "Direct / unknown",
      });
    }
  }
  return result;
}

/** Summary must reconcile with the detailed rows, NOT estimated ADR × rooms. */
export function sumReservationMovementRows(rows: ReservationMovementRow[]) {
  let gained = 0;
  let lost = 0;
  let gainedValue = 0;
  let lostValue = 0;
  for (const row of rows) {
    const count = row.rooms.reduce((sum, room) => sum + room.nights, 0);
    if (row.kind === "booked") {
      gained += count;
      gainedValue += row.value;
    } else {
      lost += count;
      lostValue += row.value;
    }
  }
  return { gained, lost, gainedValue: roundMoney(gainedValue), lostValue: roundMoney(lostValue) };
}
