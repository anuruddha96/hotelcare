export interface HistoricalDailyKpi {
  stay_date: string;
  roomsSold: number;
  roomsAvailable: number;
  occupancyPct: number;
  revenue: number;
  adr: number | null;
  revpar: number | null;
}

export interface HistoricalKpiSummary {
  days: number;
  roomNights: number;
  availableRoomNights: number;
  revenue: number;
  occupancyPct: number | null;
  adr: number | null;
  revpar: number | null;
}

const roundMoney = (value: number): number => Math.round(value * 100) / 100;
const roundPct = (value: number): number => Math.round(value * 10) / 10;

function finiteNonNegative(value: number | null | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

/**
 * Canonical historical KPI roll-up for Revenue/RMS analytics.
 *
 * ADR is weighted by sold room nights and RevPAR by available room nights.
 * This avoids averaging daily percentages/rates, which produces misleading
 * multi-day and YoY comparisons when inventory or occupancy varies by date.
 *
 * Callers remain responsible for tenant/property scoping before passing rows.
 */
export function summarizeHistoricalKpis(rows: HistoricalDailyKpi[]): HistoricalKpiSummary {
  let roomNights = 0;
  let availableRoomNights = 0;
  let revenue = 0;

  for (const row of rows) {
    roomNights += finiteNonNegative(row.roomsSold);
    availableRoomNights += finiteNonNegative(row.roomsAvailable);
    revenue += finiteNonNegative(row.revenue);
  }

  const roundedRevenue = roundMoney(revenue);
  return {
    days: rows.length,
    roomNights,
    availableRoomNights,
    revenue: roundedRevenue,
    occupancyPct: availableRoomNights > 0
      ? roundPct((roomNights / availableRoomNights) * 100)
      : null,
    adr: roomNights > 0
      ? roundMoney(roundedRevenue / roomNights)
      : null,
    revpar: availableRoomNights > 0
      ? roundMoney(roundedRevenue / availableRoomNights)
      : null,
  };
}
