import { addDays } from "@/lib/revenueAnalytics";

/** Past dates are informational, never publishable or selectable. */
export const RATE_HISTORY_DAYS = 3;

export function historyStart(today: string): string {
  return addDays(today, -RATE_HISTORY_DAYS);
}

export function canEditCalendarDate(date: string, today: string, canEditRates: boolean): boolean {
  return canEditRates && date >= today;
}

/**
 * One shared column width for rolling and single-month navigation.
 * On a narrow viewport prefer horizontal scrolling to shrinking numbers.
 */
export function rateCalendarColumnWidth(viewportWidth: number, leftWidth: number, zoomCellWidth: number): number {
  const minWidth = Math.max(1, zoomCellWidth);
  const available = viewportWidth - leftWidth - 2;
  return available <= 0 ? minWidth : Math.max(minWidth, Math.floor(available / 30));
}

export function historicalRateKey(obkId: string, occupancy: number, date: string): string {
  return obkId + "|" + occupancy + "|" + date;
}
