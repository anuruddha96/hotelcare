/**
 * KPI reconciliation helpers for the Revenue page occupancy cross-check.
 * Pure functions over rows of public.revenue_kpi_reconciliation_days().
 */

/**
 * One hotel-month, the same shape as public.revenue_kpi_reconciliation_months().
 * Only the columns this card reads are typed.
 */
export interface KpiReconciliationMonth {
  hotel_id: string;
  month_start: string;
  capacity_room_nights: number | null;
  booked_nights_all: number;
  hold_nights: number;
  commercial_sold: number;
  unassigned_nights: number;
  option_nights: number;
  previo_dashboard_occupied: number;
  past_nights: number;
  housekeeping_verified_nights: number;
  housekeeping_mismatch_nights: number;
  previo_dashboard_occupancy_pct: number | null;
  hotelcare_commercial_occupancy_pct: number | null;
  best_physical_occupancy_pct: number | null;
  best_commercial_occupancy_pct: number | null;
}

/** One row of public.revenue_kpi_reconciliation_days(); only the columns used here. */
export interface ReconciliationDay {
  hotel_id: string;
  stay_date: string;
  is_past_night: boolean;
  capacity_rooms: number | null;
  commercial_capacity: number;
  booked_nights_all: number;
  hold_nights: number;
  commercial_sold: number;
  unassigned_nights: number;
  option_nights: number;
  previo_dashboard_occupied: number;
  best_source: string;
  best_physical_occupied: number;
  best_commercial_sold: number;
  room_revenue_gross: number | string;
  unpriced_nights: number;
  flags: string[] | null;
}

const num = (v: number | string | null | undefined) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const ratioPct = (a: number, b: number) => (b > 0 ? Math.round((1000 * a) / b) / 10 : null);

/** Same arithmetic as public.revenue_kpi_reconciliation_months(), done on the client. */
export function summariseReconciliationDays(days: ReconciliationDay[]): KpiReconciliationMonth | null {
  if (!days.length) return null;
  const sum = (f: (d: ReconciliationDay) => number) => days.reduce((s, d) => s + f(d), 0);
  const capacity = sum((d) => num(d.capacity_rooms));
  const commercialCapacity = sum((d) => num(d.commercial_capacity));
  const past = days.filter((d) => d.is_past_night);
  return {
    hotel_id: days[0].hotel_id,
    month_start: `${days[0].stay_date.slice(0, 7)}-01`,
    capacity_room_nights: capacity,
    booked_nights_all: sum((d) => num(d.booked_nights_all)),
    hold_nights: sum((d) => num(d.hold_nights)),
    commercial_sold: sum((d) => num(d.commercial_sold)),
    unassigned_nights: sum((d) => num(d.unassigned_nights)),
    option_nights: sum((d) => num(d.option_nights)),
    previo_dashboard_occupied: sum((d) => num(d.previo_dashboard_occupied)),
    past_nights: past.length,
    housekeeping_verified_nights: days.filter((d) => d.best_source === "housekeeping_verified").length,
    housekeeping_mismatch_nights: days.filter((d) => (d.flags ?? []).includes("housekeeping_mismatch")).length,
    previo_dashboard_occupancy_pct: ratioPct(sum((d) => num(d.previo_dashboard_occupied)), capacity),
    hotelcare_commercial_occupancy_pct: ratioPct(sum((d) => num(d.commercial_sold)), commercialCapacity),
    best_physical_occupancy_pct: ratioPct(sum((d) => num(d.best_physical_occupied)), capacity),
    best_commercial_occupancy_pct: ratioPct(sum((d) => num(d.best_commercial_sold)), commercialCapacity),
  };
}

export interface MonthBreakdownRow {
  key: "stayed" | "books" | "month";
  firstDay: string;
  lastDay: string;
  sold: number;
  capacity: number;
  occupancyPct: number | null;
  /** Booking value per priced sold night, incl. breakfast and extras. */
  adrGross: number | null;
  revparGross: number | null;
}

/**
 * Splits a month into nights already stayed and nights still on the books, plus
 * the whole month, so a manager can see how the month total is built.
 */
export function buildMonthBreakdown(days: ReconciliationDay[]): MonthBreakdownRow[] {
  const make = (key: MonthBreakdownRow["key"], part: ReconciliationDay[]): MonthBreakdownRow | null => {
    if (!part.length) return null;
    const sold = part.reduce((s, d) => s + num(d.commercial_sold), 0);
    const priced = part.reduce((s, d) => s + num(d.commercial_sold) - num(d.unpriced_nights), 0);
    const capacity = part.reduce((s, d) => s + num(d.commercial_capacity), 0);
    const revenue = part.reduce((s, d) => s + num(d.room_revenue_gross), 0);
    const dates = part.map((d) => d.stay_date).sort();
    return {
      key,
      firstDay: dates[0],
      lastDay: dates[dates.length - 1],
      sold,
      capacity,
      occupancyPct: ratioPct(sold, capacity),
      adrGross: priced > 0 ? Math.round((revenue / priced) * 100) / 100 : null,
      revparGross: capacity > 0 ? Math.round((revenue / capacity) * 100) / 100 : null,
    };
  };
  const rows = [
    make("stayed", days.filter((d) => d.is_past_night)),
    make("books", days.filter((d) => !d.is_past_night)),
  ].filter((r): r is MonthBreakdownRow => r !== null);
  // A whole-month line only adds information when both parts exist.
  if (rows.length === 2) {
    const month = make("month", days);
    if (month) rows.push(month);
  }
  return rows;
}

