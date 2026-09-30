export const SLNT_HOUSEKEEPING_PLANNING_DAYS = 14;

export type SlntPlanningWindow = {
  fromDate: string;
  toDateExclusive: string;
  dates: string[];
};

export function addIsoDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * SLNT future planning deliberately excludes today. The Previo daily-overview
 * endpoint treats toDate as exclusive, so D+1 -> D+15 gives exactly fourteen
 * business dates (D+1 ... D+14) in one searchReservations request.
 */
export function buildSlnt14DayPlanningWindow(today: string): SlntPlanningWindow {
  const fromDate = addIsoDays(today, 1);
  const dates = Array.from(
    { length: SLNT_HOUSEKEEPING_PLANNING_DAYS },
    (_, index) => addIsoDays(fromDate, index),
  );
  return {
    fromDate,
    toDateExclusive: addIsoDays(fromDate, SLNT_HOUSEKEEPING_PLANNING_DAYS),
    dates,
  };
}

export function groupRowsByBusinessDate<T extends { business_date?: string | null }>(
  rows: T[],
  dates: string[],
): Map<string, T[]> {
  const allowedDates = new Set(dates);
  const grouped = new Map<string, T[]>(dates.map(date => [date, []]));
  for (const row of rows) {
    const businessDate = row.business_date || '';
    if (!allowedDates.has(businessDate)) continue;
    grouped.get(businessDate)!.push(row);
  }
  return grouped;
}

export function isSlntOrganization(value?: string | null): boolean {
  const normalized = (value || '').trim().toLowerCase();
  return normalized === 'slnt' || normalized === 'slnt-group';
}
