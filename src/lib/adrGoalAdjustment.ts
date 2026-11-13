import type { RoomTypeRate } from "@/lib/revenueAnalytics";

/** These are actual changed room-nights, never an inferred continuous stay span. */
export interface GoalPriceScope {
  stayDate: string;
  roomTypeName: string;
}

export interface GoalRateChange {
  rate: RoomTypeRate;
  from: number;
  to: number;
}

const scopeKey = (date: string, room: string) => `${date}|${room}`;
const cellKey = (r: RoomTypeRate) => `${scopeKey(r.stay_date, r.room_type_name ?? "")}|${r.occupancy}`;

export function bookingGoalScope(rooms: Array<{ roomType: string; dates: string[] }>): GoalPriceScope[] {
  const keys = new Set<string>();
  const result: GoalPriceScope[] = [];
  for (const room of rooms) {
    if (!room.roomType) continue;
    for (const date of room.dates) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const key = scopeKey(date, room.roomType);
      if (keys.has(key)) continue;
      keys.add(key);
      result.push({ stayDate: date, roomTypeName: room.roomType });
    }
  }
  return result.sort((a, b) => a.stayDate.localeCompare(b.stayDate) || a.roomTypeName.localeCompare(b.roomTypeName));
}

/**
 * A goal shortcut adds a fixed *whole base-currency amount* to existing prices.
 * The checkout date, gaps in booked nights, other room types and other dates
 * cannot enter the result; every occupancy pillar of a scoped room/date moves
 * by the same amount, preserving existing guest supplements.
 */
export function buildGoalPriceChanges(
  rates: RoomTypeRate[],
  scope: GoalPriceScope[],
  signedDelta: number,
  today: string,
): { changes: GoalRateChange[]; missing: GoalPriceScope[]; invalid: boolean } {
  if (!Number.isSafeInteger(signedDelta) || signedDelta === 0 || Math.abs(signedDelta) > 1000000) {
    return { changes: [], missing: scope, invalid: true };
  }
  const allowed = new Set(scope.map((s) => scopeKey(s.stayDate, s.roomTypeName)));
  const found = new Set<string>();
  const seen = new Set<string>();
  const changes: GoalRateChange[] = [];
  let invalid = false;
  for (const rate of rates) {
    const key = scopeKey(rate.stay_date, rate.room_type_name ?? "");
    if (!allowed.has(key) || rate.stay_date < today) continue;
    if (!Number.isFinite(rate.price) || rate.price <= 0 || !rate.obk_id || !Number.isInteger(rate.occupancy)) {
      invalid = true;
      continue;
    }
    const cell = cellKey(rate);
    if (seen.has(cell)) continue;
    seen.add(cell);
    found.add(key);
    const from = Math.round(rate.price);
    const to = from + signedDelta;
    if (to < 1 || to > 10000000) { invalid = true; continue; }
    changes.push({ rate, from, to });
  }
  const missing = scope.filter((s) => s.stayDate >= today && !found.has(scopeKey(s.stayDate, s.roomTypeName)));
  return { changes, missing, invalid };
}
