/**
 * Front-office reports computed from the reservations HotelCare already holds
 * (imported from Previo, received through Channex, or created natively).
 * Pure functions: the page only loads rows and renders the result.
 *
 * Conventions (hotel industry standard):
 *   - A room night belongs to the date the guest sleeps: arrival ≤ night < departure.
 *   - Cancelled, no-show and "no longer in the PMS" bookings never count.
 *   - Revenue per night = booking total / nights (the per-night split is not known).
 *   - Occupancy = rooms sold / rooms available; ADR = revenue / rooms sold;
 *     RevPAR = revenue / rooms available.
 */
import { reservationChannel, reservationGuestLabel } from './reservations';

export interface ReportReservation {
  id: string;
  status?: string | null;
  check_in_date: string;
  check_out_date: string;
  room_id?: string | null;
  total_amount?: number | string | null;
  balance_due?: number | string | null;
  currency?: string | null;
  adults?: number | null;
  children?: number | null;
  source?: string | null;
  pms_channel?: string | null;
  ota_name?: string | null;
  pms_missing_since?: string | null;
  pms_payment_status?: string | null;
  special_requests?: string | null;
  rooms?: { room_number?: string | null; room_type?: string | null } | null;
  [key: string]: unknown;
}

const COUNTED = new Set(['pending', 'confirmed', 'checked_in', 'checked_out']);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const counted = (r: ReportReservation) =>
  COUNTED.has(String(r.status ?? '')) && !r.pms_missing_since
  && DAY.test(r.check_in_date) && DAY.test(r.check_out_date) && r.check_out_date > r.check_in_date;

export function addDaysIso(day: string, amount: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + amount);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

/** Every date from `from` to `to`, both included (max 400 to keep a typo from freezing the page). */
export function dateRange(from: string, to: string): string[] {
  if (!DAY.test(from) || !DAY.test(to) || to < from) return [];
  const out: string[] = [];
  for (let day = from; day <= to && out.length < 400; day = addDaysIso(day, 1)) out.push(day);
  return out;
}

const guests = (r: ReportReservation) => Math.max(0, Number(r.adults ?? 0)) + Math.max(0, Number(r.children ?? 0));
const nightlyRate = (r: ReportReservation) => {
  const nights = daysBetween(r.check_in_date, r.check_out_date);
  const total = Number(r.total_amount ?? 0);
  return nights > 0 && Number.isFinite(total) ? total / nights : 0;
};
const byRoom = (a: ReportReservation, b: ReportReservation) =>
  String(a.rooms?.room_number ?? '\uffff').localeCompare(String(b.rooms?.room_number ?? '\uffff'), undefined, { numeric: true })
  || reservationGuestLabel(a).localeCompare(reservationGuestLabel(b));

// ---------------------------------------------------------------- Daily overview

export interface DailyOverview {
  date: string;
  arrivals: ReportReservation[];
  departures: ReportReservation[];
  stayovers: ReportReservation[];
  /** Rooms occupied tonight (arrivals + stay-overs with a room or floating). */
  roomsTonight: number;
  guestsTonight: number;
  occupancyPercent: number | null;
  /** Still to collect from today's arrivals and departures. */
  balanceToCollect: number;
}

/** The day sheet reception and housekeeping work from: who comes, who goes, who stays. */
export function dailyOverview(reservations: readonly ReportReservation[], date: string, totalRooms: number): DailyOverview {
  const rows = reservations.filter(counted);
  const arrivals = rows.filter((r) => r.check_in_date === date).sort(byRoom);
  const departures = rows.filter((r) => r.check_out_date === date).sort(byRoom);
  const stayovers = rows.filter((r) => r.check_in_date < date && r.check_out_date > date).sort(byRoom);
  const tonight = [...arrivals, ...stayovers];
  const balanceToCollect = [...arrivals, ...departures]
    .filter((r) => r.pms_payment_status !== 'paid')
    .reduce((sum, r) => sum + Math.max(0, Number(r.balance_due ?? 0) || 0), 0);
  return {
    date, arrivals, departures, stayovers,
    roomsTonight: tonight.length,
    guestsTonight: tonight.reduce((sum, r) => sum + guests(r), 0),
    occupancyPercent: totalRooms > 0 ? Math.round((tonight.length / totalRooms) * 100) : null,
    balanceToCollect: Math.round(balanceToCollect * 100) / 100,
  };
}

// ---------------------------------------------------------------- Performance

export interface PerformanceDay {
  date: string;
  roomsSold: number;
  roomsAvailable: number;
  occupancyPercent: number | null;
  revenue: number;
  adr: number | null;
  revpar: number | null;
  arrivals: number;
  departures: number;
}

export interface PerformanceReport {
  days: PerformanceDay[];
  totals: Omit<PerformanceDay, 'date'> & { averageStay: number | null; bookings: number };
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/** Occupancy, ADR and RevPAR per night and for the whole period. */
export function performanceReport(
  reservations: readonly ReportReservation[], from: string, to: string, totalRooms: number,
): PerformanceReport {
  const rows = reservations.filter(counted);
  const days = dateRange(from, to).map<PerformanceDay>((date) => {
    let roomsSold = 0; let revenue = 0; let arrivals = 0; let departures = 0;
    for (const r of rows) {
      if (r.check_in_date <= date && r.check_out_date > date) { roomsSold += 1; revenue += nightlyRate(r); }
      if (r.check_in_date === date) arrivals += 1;
      if (r.check_out_date === date) departures += 1;
    }
    return {
      date, roomsSold, roomsAvailable: totalRooms,
      occupancyPercent: totalRooms > 0 ? Math.round((roomsSold / totalRooms) * 1000) / 10 : null,
      revenue: round2(revenue),
      adr: roomsSold > 0 ? round2(revenue / roomsSold) : null,
      revpar: totalRooms > 0 ? round2(revenue / totalRooms) : null,
      arrivals, departures,
    };
  });
  const sold = days.reduce((s, d) => s + d.roomsSold, 0);
  const available = days.reduce((s, d) => s + d.roomsAvailable, 0);
  const revenue = days.reduce((s, d) => s + d.revenue, 0);
  const arriving = rows.filter((r) => r.check_in_date >= from && r.check_in_date <= to);
  const stayNights = arriving.reduce((s, r) => s + daysBetween(r.check_in_date, r.check_out_date), 0);
  return {
    days,
    totals: {
      roomsSold: sold, roomsAvailable: available,
      occupancyPercent: available > 0 ? Math.round((sold / available) * 1000) / 10 : null,
      revenue: round2(revenue),
      adr: sold > 0 ? round2(revenue / sold) : null,
      revpar: available > 0 ? round2(revenue / available) : null,
      arrivals: days.reduce((s, d) => s + d.arrivals, 0),
      departures: days.reduce((s, d) => s + d.departures, 0),
      averageStay: arriving.length ? Math.round((stayNights / arriving.length) * 10) / 10 : null,
      bookings: arriving.length,
    },
  };
}

// ---------------------------------------------------------------- Channel production

export interface ChannelRow {
  channel: string;
  key: string;
  bookings: number;
  roomNights: number;
  revenue: number;
  adr: number | null;
  sharePercent: number;
}

/** Room nights and revenue per sales channel for the nights inside the period. */
export function channelProduction(reservations: readonly ReportReservation[], from: string, to: string): ChannelRow[] {
  const endExclusive = addDaysIso(to, 1);
  const map = new Map<string, ChannelRow>();
  for (const r of reservations.filter(counted)) {
    const start = r.check_in_date > from ? r.check_in_date : from;
    const end = r.check_out_date < endExclusive ? r.check_out_date : endExclusive;
    const nights = daysBetween(start, end);
    if (nights <= 0) continue;
    const channel = reservationChannel(r);
    const row = map.get(channel.label) ?? { channel: channel.label, key: channel.key, bookings: 0, roomNights: 0, revenue: 0, adr: null, sharePercent: 0 };
    row.bookings += 1;
    row.roomNights += nights;
    row.revenue += nightlyRate(r) * nights;
    map.set(channel.label, row);
  }
  const totalNights = [...map.values()].reduce((s, row) => s + row.roomNights, 0);
  return [...map.values()]
    .map((row) => ({
      ...row,
      revenue: round2(row.revenue),
      adr: row.roomNights > 0 ? round2(row.revenue / row.roomNights) : null,
      sharePercent: totalNights > 0 ? Math.round((row.roomNights / totalNights) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.roomNights - a.roomNights || a.channel.localeCompare(b.channel));
}

// ---------------------------------------------------------------- Export

/** CSV with a UTF-8 BOM and ";" separator, which Excel opens correctly on Hungarian/European systems. */
export function toCsv(header: readonly string[], rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>): string {
  const cell = (value: string | number | null | undefined) => {
    let text = value == null ? '' : String(value);
    // Never let a guest name or note be run as a spreadsheet formula.
    if (/^[=+\-@\t\r]/.test(text) && typeof value !== 'number') text = `'${text}`;
    return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return `\ufeff${[header, ...rows].map((row) => row.map(cell).join(';')).join('\r\n')}`;
}
