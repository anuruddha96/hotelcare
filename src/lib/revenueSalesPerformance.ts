export type SalesPerformanceCompare = "goal" | "yesterday" | "lastweek";
export type SalesPerformanceMetric = "value" | "nights" | "adr";

export interface SalesPerformanceBooking {
  res_id: string;
  createdDay: string;
  createdMinutes: number;
  roomNights: number;
  revenue: number;
  cancelled: boolean;
}

export interface SalesPerformanceGoals {
  days: number;
  targetValue: number;
  targetRoomNights: number;
  targetAdr: number;
}

export interface SalesPerformancePoint {
  label: string;
  grossValueWindow: number;
  cancelledValueWindow: number;
  netValue: number;
  grossNightsWindow: number;
  cancelledNightsWindow: number;
  netNights: number;
  adr: number | null;
  compareValue: number | null;
  compareNights: number | null;
  compareAdr: number | null;
  windowBookings: number;
  windowCancellations: number;
}

export interface SalesPerformancePace {
  current: number | null;
  benchmark: number | null;
  delta: number | null;
}

interface BuildSalesPerformanceSeriesInput {
  bookings: SalesPerformanceBooking[];
  from: string;
  to: string;
  today: string;
  nowMinutes: number;
  compare: SalesPerformanceCompare;
  goals: SalesPerformanceGoals;
}

const DAY_MS = 86_400_000;
const MINUTES_PER_DAY = 24 * 60;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function addIsoDays(date: string, amount: number): string {
  const parsed = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed)) return date;
  return new Date(parsed + amount * DAY_MS).toISOString().slice(0, 10);
}

function enumerateDays(from: string, to: string): string[] {
  if (!from || !to || to < from) return [];
  const days: string[] = [];
  let cursor = from;
  while (cursor <= to && days.length < 370) {
    days.push(cursor);
    cursor = addIsoDays(cursor, 1);
  }
  return days;
}

function dailyLabel(date: string): string {
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  if (!Number.isFinite(month) || !Number.isFinite(day)) return date;
  return `${day} ${MONTHS[month - 1] ?? ""}`.trim();
}

function shiftForCompare(compare: SalesPerformanceCompare): number | null {
  if (compare === "yesterday") return -1;
  if (compare === "lastweek") return -7;
  return null;
}

function oneDaySeries(
  bookings: SalesPerformanceBooking[],
  day: string,
  buckets: number[],
): Array<{
  grossValue: number;
  cancelledValue: number;
  netValue: number;
  grossNights: number;
  cancelledNights: number;
  netNights: number;
  adr: number | null;
  grossValueWindow: number;
  cancelledValueWindow: number;
  grossNightsWindow: number;
  cancelledNightsWindow: number;
  windowBookings: number;
  windowCancellations: number;
}> {
  const live = bookings.filter((b) => !b.cancelled && b.createdDay === day);
  const cancelled = bookings.filter((b) => b.cancelled && b.createdDay === day);

  let grossValue = 0;
  let cancelledValue = 0;
  let grossNights = 0;
  let cancelledNights = 0;

  return buckets.map((minute, index) => {
    // Use the previous bucket edge rather than "minute - 120". The final
    // point is the live current time and is often not aligned to a 2-hour
    // boundary; using a rolling 120-minute window there would double-count
    // bookings already included in the previous bucket.
    const windowStart = index === 0 ? -1 : buckets[index - 1];
    const liveInWindow = live.filter((b) => b.createdMinutes <= minute && b.createdMinutes > windowStart);
    const cancelledInWindow = cancelled.filter((b) => b.createdMinutes <= minute && b.createdMinutes > windowStart);

    const grossValueWindow = liveInWindow.reduce((sum, b) => sum + b.revenue, 0);
    const cancelledValueWindow = cancelledInWindow.reduce((sum, b) => sum + b.revenue, 0);
    const grossNightsWindow = liveInWindow.reduce((sum, b) => sum + b.roomNights, 0);
    const cancelledNightsWindow = cancelledInWindow.reduce((sum, b) => sum + b.roomNights, 0);

    grossValue += grossValueWindow;
    cancelledValue += cancelledValueWindow;
    grossNights += grossNightsWindow;
    cancelledNights += cancelledNightsWindow;

    return {
      grossValue,
      cancelledValue,
      netValue: grossValue - cancelledValue,
      grossNights,
      cancelledNights,
      netNights: grossNights - cancelledNights,
      adr: grossNights > 0 ? grossValue / grossNights : null,
      grossValueWindow,
      cancelledValueWindow,
      grossNightsWindow,
      cancelledNightsWindow,
      windowBookings: new Set(liveInWindow.map((b) => b.res_id)).size,
      windowCancellations: new Set(cancelledInWindow.map((b) => b.res_id)).size,
    };
  });
}

function buildIntradaySeries(input: BuildSalesPerformanceSeriesInput): SalesPerformancePoint[] {
  const cutoff = input.from === input.today
    ? Math.max(0, Math.min(MINUTES_PER_DAY - 1, input.nowMinutes))
    : MINUTES_PER_DAY - 1;
  const buckets: number[] = [];
  for (let minute = 0; minute <= cutoff; minute += 120) buckets.push(minute);
  if (buckets.length === 0 || buckets[buckets.length - 1] < cutoff) buckets.push(cutoff);

  const current = oneDaySeries(input.bookings, input.from, buckets);
  const shift = shiftForCompare(input.compare);
  const compareDay = shift === null ? null : addIsoDays(input.from, shift);
  const shifted = compareDay ? oneDaySeries(input.bookings, compareDay, buckets) : null;

  const dailyTargetValue = input.goals.days > 0 ? input.goals.targetValue / input.goals.days : 0;
  const dailyTargetNights = input.goals.days > 0 ? input.goals.targetRoomNights / input.goals.days : 0;

  return buckets.map((minute, index) => {
    const cur = current[index];
    const benchmark = shifted?.[index] ?? null;
    const elapsedShare = Math.min(1, Math.max(0, (minute + 1) / MINUTES_PER_DAY));

    return {
      label: `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`,
      grossValueWindow: Math.round(cur.grossValueWindow),
      cancelledValueWindow: -Math.round(cur.cancelledValueWindow),
      netValue: Math.round(cur.netValue),
      grossNightsWindow: cur.grossNightsWindow,
      cancelledNightsWindow: -cur.cancelledNightsWindow,
      netNights: cur.netNights,
      adr: cur.adr === null ? null : Math.round(cur.adr),
      compareValue: input.compare === "goal"
        ? (dailyTargetValue > 0 ? Math.round(dailyTargetValue * elapsedShare) : null)
        : (benchmark ? Math.round(benchmark.netValue) : null),
      compareNights: input.compare === "goal"
        ? (dailyTargetNights > 0 ? Math.round(dailyTargetNights * elapsedShare * 10) / 10 : null)
        : (benchmark ? benchmark.netNights : null),
      compareAdr: input.compare === "goal"
        ? (input.goals.targetAdr > 0 ? input.goals.targetAdr : null)
        : (benchmark?.adr === null || benchmark?.adr === undefined ? null : Math.round(benchmark.adr)),
      windowBookings: cur.windowBookings,
      windowCancellations: cur.windowCancellations,
    };
  });
}

function buildDailySeries(input: BuildSalesPerformanceSeriesInput): SalesPerformancePoint[] {
  const days = enumerateDays(input.from, input.to);
  const shift = shiftForCompare(input.compare);
  const dailyTargetValue = input.goals.days > 0 ? input.goals.targetValue / input.goals.days : 0;
  const dailyTargetNights = input.goals.days > 0 ? input.goals.targetRoomNights / input.goals.days : 0;

  let grossValue = 0;
  let cancelledValue = 0;
  let grossNights = 0;
  let cancelledNights = 0;
  let compareGrossValue = 0;
  let compareCancelledValue = 0;
  let compareGrossNights = 0;
  let compareCancelledNights = 0;

  return days.map((day, index) => {
    const live = input.bookings.filter((b) => !b.cancelled && b.createdDay === day);
    const cancelled = input.bookings.filter((b) => b.cancelled && b.createdDay === day);
    const grossValueWindow = live.reduce((sum, b) => sum + b.revenue, 0);
    const cancelledValueWindow = cancelled.reduce((sum, b) => sum + b.revenue, 0);
    const grossNightsWindow = live.reduce((sum, b) => sum + b.roomNights, 0);
    const cancelledNightsWindow = cancelled.reduce((sum, b) => sum + b.roomNights, 0);

    grossValue += grossValueWindow;
    cancelledValue += cancelledValueWindow;
    grossNights += grossNightsWindow;
    cancelledNights += cancelledNightsWindow;

    let compareValue: number | null = null;
    let compareNights: number | null = null;
    let compareAdr: number | null = null;

    if (input.compare === "goal") {
      compareValue = dailyTargetValue > 0 ? Math.round(dailyTargetValue * (index + 1)) : null;
      compareNights = dailyTargetNights > 0 ? Math.round(dailyTargetNights * (index + 1) * 10) / 10 : null;
      compareAdr = input.goals.targetAdr > 0 ? input.goals.targetAdr : null;
    } else if (shift !== null) {
      const compareDay = addIsoDays(day, shift);
      const compareLive = input.bookings.filter((b) => !b.cancelled && b.createdDay === compareDay);
      const compareCancelled = input.bookings.filter((b) => b.cancelled && b.createdDay === compareDay);

      compareGrossValue += compareLive.reduce((sum, b) => sum + b.revenue, 0);
      compareCancelledValue += compareCancelled.reduce((sum, b) => sum + b.revenue, 0);
      compareGrossNights += compareLive.reduce((sum, b) => sum + b.roomNights, 0);
      compareCancelledNights += compareCancelled.reduce((sum, b) => sum + b.roomNights, 0);

      compareValue = Math.round(compareGrossValue - compareCancelledValue);
      compareNights = compareGrossNights - compareCancelledNights;
      compareAdr = compareGrossNights > 0 ? Math.round(compareGrossValue / compareGrossNights) : null;
    }

    return {
      label: dailyLabel(day),
      grossValueWindow: Math.round(grossValueWindow),
      cancelledValueWindow: -Math.round(cancelledValueWindow),
      netValue: Math.round(grossValue - cancelledValue),
      grossNightsWindow,
      cancelledNightsWindow: -cancelledNightsWindow,
      netNights: grossNights - cancelledNights,
      adr: grossNights > 0 ? Math.round(grossValue / grossNights) : null,
      compareValue,
      compareNights,
      compareAdr,
      windowBookings: new Set(live.map((b) => b.res_id)).size,
      windowCancellations: new Set(cancelled.map((b) => b.res_id)).size,
    };
  });
}

export function buildSalesPerformanceSeries(input: BuildSalesPerformanceSeriesInput): SalesPerformancePoint[] {
  if (!input.from || !input.to || input.to < input.from) return [];
  return input.from === input.to ? buildIntradaySeries(input) : buildDailySeries(input);
}

export function getSalesPerformancePace(
  points: SalesPerformancePoint[],
  metric: SalesPerformanceMetric,
): SalesPerformancePace {
  const last = points.length ? points[points.length - 1] : null;
  if (!last) return { current: null, benchmark: null, delta: null };

  const current = metric === "value" ? last.netValue : metric === "nights" ? last.netNights : last.adr;
  const benchmark = metric === "value" ? last.compareValue : metric === "nights" ? last.compareNights : last.compareAdr;

  return {
    current,
    benchmark,
    delta: current === null || benchmark === null ? null : current - benchmark,
  };
}
