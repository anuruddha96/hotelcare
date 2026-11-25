import { describe, expect, it } from 'vitest';
import { channelProduction, dailyOverview, dateRange, performanceReport, toCsv } from './receptionReports';

const res = (id: string, from: string, to: string, over: Record<string, unknown> = {}) => ({
  id, status: 'confirmed', check_in_date: from, check_out_date: to, room_id: `room-${id}`,
  total_amount: 200, balance_due: 0, adults: 2, children: 0, source: 'previo', pms_channel: 'Booking.com',
  rooms: { room_number: id }, ...over,
});

const rows = [
  res('101', '2026-11-14', '2026-11-16', { status: 'checked_in' }),              // leaves on the 16th
  res('102', '2026-11-16', '2026-11-18', { balance_due: 200, pms_payment_status: 'unpaid' }), // arrives on the 16th
  res('103', '2026-11-15', '2026-11-19', { status: 'checked_in', total_amount: 400, pms_channel: 'Expedia' }), // stays over
  res('104', '2026-11-16', '2026-11-17', { status: 'cancelled' }),
  res('105', '2026-11-16', '2026-11-17', { pms_missing_since: '2026-11-15T10:00:00Z' }),
];

describe('dailyOverview', () => {
  const day = dailyOverview(rows, '2026-11-16', 10);
  it('splits the day into arrivals, departures and stay-overs', () => {
    expect(day.arrivals.map((r) => r.id)).toEqual(['102']);
    expect(day.departures.map((r) => r.id)).toEqual(['101']);
    expect(day.stayovers.map((r) => r.id)).toEqual(['103']);
  });
  it('counts tonight without cancelled or vanished bookings', () => {
    expect(day).toMatchObject({ roomsTonight: 2, guestsTonight: 4, occupancyPercent: 20, balanceToCollect: 200 });
  });
});

describe('performanceReport', () => {
  const report = performanceReport(rows, '2026-11-15', '2026-11-17', 10);
  it('counts a room night on the nights slept, not on the departure day', () => {
    expect(report.days.map((d) => d.roomsSold)).toEqual([2, 2, 2]);
    expect(report.days[1]).toMatchObject({ date: '2026-11-16', revenue: 200, adr: 100, revpar: 20, occupancyPercent: 20, arrivals: 1, departures: 1 });
  });
  it('totals the period', () => {
    expect(report.totals).toMatchObject({ roomsSold: 6, roomsAvailable: 30, occupancyPercent: 20, revenue: 600, adr: 100, revpar: 20, bookings: 2, averageStay: 3 });
  });
  it('survives a hotel without rooms and an inverted range', () => {
    expect(performanceReport(rows, '2026-11-16', '2026-11-16', 0).days[0]).toMatchObject({ occupancyPercent: null, revpar: null });
    expect(performanceReport(rows, '2026-11-17', '2026-11-15', 10).days).toEqual([]);
    expect(dateRange('2026-11-30', '2026-12-02')).toEqual(['2026-11-30', '2026-12-01', '2026-12-02']);
  });
});

describe('channelProduction', () => {
  it('attributes only the nights inside the period, biggest channel first', () => {
    const table = channelProduction(rows, '2026-11-16', '2026-11-17');
    expect(table).toEqual([
      { channel: 'Booking.com', key: 'booking', bookings: 1, roomNights: 2, revenue: 200, adr: 100, sharePercent: 50 },
      { channel: 'Expedia', key: 'expedia', bookings: 1, roomNights: 2, revenue: 200, adr: 100, sharePercent: 50 },
    ]);
  });
});

describe('toCsv', () => {
  it('escapes separators and neutralises spreadsheet formulas', () => {
    const csv = toCsv(['Guest', 'Total'], [['Kovács; Anna', 120.5], ['=HYPERLINK("x")', -5], ['He said "hi"', null]]);
    expect(csv.startsWith('\ufeff')).toBe(true);
    expect(csv.slice(1).split('\r\n')).toEqual(['Guest;Total', '"Kovács; Anna";120.5', `"'=HYPERLINK(""x"")";-5`, '"He said ""hi""";']);
  });
});
