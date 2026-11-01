import { addDays, dateRange } from "@/lib/revenueAnalytics";
import { RATE_HISTORY_DAYS } from "@/lib/rateCalendarPresentation";

/** Rolling date view: today and 29 following dates (30 total). */
export const RATE_CALENDAR_DAYS = 30;

/** Navigation choices do not require downloading rate rows. */
export function nextCalendarMonths(today: string, count = 12) {
  const first = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
  return Array.from({ length: count }, (_, i) => {
    const month = new Date(first);
    month.setUTCMonth(month.getUTCMonth() + i);
    const value = month.toISOString().slice(0, 7);
    const label = `${month.toLocaleString("en-US", { month: "short", timeZone: "UTC" })} ${value.slice(2, 4)}`;
    return { value, label };
  });
}

function monthEnd(month: string): string {
  const [year, number] = month.split("-").map(Number);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Invalid calendar month");
  return new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10);
}

/** One month is bounded to its real end (including leap years). */
export function calendarWindow(today: string, month: string | null, revealHistory = false): string[] {
  // A historical reveal adds three read-only columns; it never consumes any
  // of the thirty future nights and never expands the published-rate horizon.
  const historicalStart = revealHistory ? addDays(today, -RATE_HISTORY_DAYS) : today;
  if (!month || month < today.slice(0, 7)) return dateRange(historicalStart, addDays(today, RATE_CALENDAR_DAYS - 1));
  const start = month === today.slice(0, 7) ? historicalStart : `${month}-01`;
  return dateRange(start, monthEnd(month));
}

/** The legacy published-payload RPC accepts a horizon starting today. Only
 * request the minimum horizon needed to reach the explicitly chosen month.
 * Never expand as a side-effect of horizontal scrolling. */
export function requiredCalendarHorizon(today: string, month: string | null): number {
  if (!month || month < today.slice(0, 7)) return RATE_CALENDAR_DAYS;
  const end = monthEnd(month);
  const days = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000) + 1;
  return Math.max(RATE_CALENDAR_DAYS, Math.min(365, days));
}


/** Inclusive two-year history: the current month plus 24 prior month choices.
 * The actual archive retention boundary is enforced per day. */
export function historicalCalendarMonths(today: string) {
  const [year, month] = today.slice(0, 7).split("-").map(Number);
  return Array.from({ length: 25 }, (_, index) => {
    const d = new Date(Date.UTC(year, month - 1 - index, 1));
    const value = d.toISOString().slice(0, 7);
    const label = d.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
    return { value, label };
  });
}

/** Historic months stop at yesterday, never mix in live/editable dates,
 * and never exceed the same two-year retention period as the database. */
export function historicalMonthDates(today: string, month: string): string[] {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return [];
  const [year, monthNum, day] = today.split("-").map(Number);
  const lowerDate = new Date(Date.UTC(year - 2, monthNum - 1, day)).toISOString().slice(0, 10);
  const start = `${month}-01`;
  const end = [monthEnd(month), addDays(today, -1)].sort()[0];
  if (start > end || end < lowerDate) return [];
  return dateRange(start < lowerDate ? lowerDate : start, end);
}
