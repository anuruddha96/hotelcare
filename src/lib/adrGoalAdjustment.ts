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


const DAY_MS = 86_400_000;
const MAX_ROW_SCOPE_DAYS = 366;

function utcDay(value: string): number | null {
  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(value)) return null;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value ? parsed : null;
}

/** A calendar row means EVERY date in the manager-selected period for each
 * booked room type (all of its occupancy/guest-price pillars), not the dates
 * from which the triggering booking happened to originate.
 */
export function calendarGoalRowScope(roomTypes: string[], from: string, to: string): GoalPriceScope[] {
  const start = utcDay(from);
  const end = utcDay(to);
  if (start === null || end === null || end < start || (end - start) / DAY_MS >= MAX_ROW_SCOPE_DAYS) return [];
  const types = [...new Set(roomTypes.filter((name) => !!name.trim()))];
  const scope: GoalPriceScope[] = [];
  for (let day = start; day <= end; day += DAY_MS) {
    const stayDate = new Date(day).toISOString().slice(0, 10);
    for (const roomTypeName of types) scope.push({ stayDate, roomTypeName });
  }
  return scope;
}

/** Default the booking shortcut to the full calendar month(s) containing its
 * actual stay nights, starting today when part of the month is historical. */
export function goalMonthRange(fromNight: string, toNight: string, today: string): { from: string; to: string } {
  const from = fromNight.slice(0, 7) + "-01";
  const lastMonth = toNight.slice(0, 7);
  const lastMonthStart = utcDay(lastMonth + "-01");
  if (utcDay(from) === null || lastMonthStart === null || from > toNight) {
    return { from: today, to: today };
  }
  const to = new Date(new Date(lastMonthStart).setUTCMonth(new Date(lastMonthStart).getUTCMonth() + 1) - DAY_MS)
    .toISOString().slice(0, 10);
  return { from: from < today ? today : from, to };
}

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
 * A goal shortcut adds a fixed whole base-currency amount to every selected
 * room/date/occupancy cell, preserving the existing guest-price supplements.
 * The caller chooses either booked nights or the full calendar-row period.
 */
export function buildGoalPriceChanges(
  rates: RoomTypeRate[],
  scope: GoalPriceScope[],
  signedDelta: number,
  today: string,
): { changes: GoalRateChange[]; missing: GoalPriceScope[]; missingTiers: Array<GoalPriceScope & { occupancy: number }>; invalid: boolean } {
  if (!Number.isSafeInteger(signedDelta) || signedDelta === 0 || Math.abs(signedDelta) > 1000000) {
    return { changes: [], missing: scope, missingTiers: [], invalid: true };
  }
  const allowed = new Set(scope.map((s) => scopeKey(s.stayDate, s.roomTypeName)));
  const found = new Set<string>();
  const seen = new Set<string>();
  const tiersByRoom = new Map<string, Set<number>>();
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
    if (!tiersByRoom.has(rate.room_type_name ?? "")) tiersByRoom.set(rate.room_type_name ?? "", new Set());
    tiersByRoom.get(rate.room_type_name ?? "")!.add(rate.occupancy);
    const from = Math.round(rate.price);
    const to = from + signedDelta;
    if (to < 1 || to > 10000000) { invalid = true; continue; }
    changes.push({ rate, from, to });
  }
  const missing = scope.filter((s) => s.stayDate >= today && !found.has(scopeKey(s.stayDate, s.roomTypeName)));
  const missingTiers: Array<GoalPriceScope & { occupancy: number }> = [];
  for (const item of scope) {
    if (item.stayDate < today || !found.has(scopeKey(item.stayDate, item.roomTypeName))) continue;
    for (const occupancy of tiersByRoom.get(item.roomTypeName) ?? []) {
      if (!seen.has(`${scopeKey(item.stayDate, item.roomTypeName)}|${occupancy}`)) {
        missingTiers.push({ ...item, occupancy });
      }
    }
  }
  return { changes, missing, missingTiers, invalid };
}
