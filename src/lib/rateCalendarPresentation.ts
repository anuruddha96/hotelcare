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
 * Match the calendar's actual date count (30 rolling nights or 28–31 month
 * dates). Desktop fit mode deliberately overrides the zoom minimum; otherwise
 * a 60px minimum forces users to scroll even on a large monitor. Narrow
 * screens and explicitly zoomed-in detail mode keep legible scrollable cells.
 */
export function rateCalendarColumnWidth(
  viewportWidth: number, leftWidth: number, zoomCellWidth: number,
  dateCount = 30, fitAllDates = false,
): number {
  const minWidth = Math.max(1, zoomCellWidth);
  const available = viewportWidth - leftWidth - 2;
  if (available <= 0) return minWidth;
  const fitted = Math.max(1, Math.floor(available / Math.max(1, dateCount)));
  return fitAllDates ? fitted : Math.max(minWidth, fitted);
}

export function historicalRateKey(obkId: string, occupancy: number, date: string): string {
  return obkId + "|" + occupancy + "|" + date;
}
