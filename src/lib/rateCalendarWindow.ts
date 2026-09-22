import { addDays, dateRange } from "@/lib/revenueAnalytics";

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
export function calendarWindow(today: string, month: string | null): string[] {
  if (!month || month < today.slice(0, 7)) return dateRange(today, addDays(today, RATE_CALENDAR_DAYS - 1));
  const start = month === today.slice(0, 7) ? today : `${month}-01`;
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
