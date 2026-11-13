import { describe, expect, it } from 'vitest';
import { importFreshness, needsAction, nightlyOccupancy, reservationAttention, topSeverity } from './receptionAttention';

const TODAY = '2026-11-13';
const kinds = (flags: ReturnType<typeof reservationAttention>) => flags.map((f) => f.kind);
const booking = (over: Record<string, unknown> = {}) => ({
  status: 'confirmed', check_in_date: TODAY, check_out_date: '2026-11-15', room_id: 'r1',
  balance_due: 0, total_amount: 300, source: 'previo', pms_payment_status: null, ...over,
});

describe('reservationAttention', () => {
  it('flags nothing for a paid booking arriving today into a clean room', () => {
    expect(reservationAttention(booking(), TODAY, 'clean')).toEqual([]);
  });

  it('flags a room that is not ready for a guest arriving today', () => {
    expect(kinds(reservationAttention(booking(), TODAY, 'dirty'))).toEqual(['room_not_ready']);
    expect(kinds(reservationAttention(booking({ check_in_date: '2026-11-14' }), TODAY, 'dirty'))).toEqual([]);
  });

  it('flags money due on arrival today or tomorrow, unless Previo says paid', () => {
    expect(kinds(reservationAttention(booking({ balance_due: 300 }), TODAY, 'clean'))).toEqual(['unpaid_arrival']);
    expect(kinds(reservationAttention(booking({ balance_due: 300, check_in_date: '2026-11-14' }), TODAY, 'clean'))).toEqual(['unpaid_arrival']);
    expect(kinds(reservationAttention(booking({ balance_due: 300, check_in_date: '2026-11-20', check_out_date: '2026-11-22' }), TODAY))).toEqual([]);
    expect(kinds(reservationAttention(booking({ balance_due: 300, pms_payment_status: 'paid' }), TODAY, 'clean'))).toEqual([]);
  });

  it('flags a guest who should already be in house', () => {
    const flags = reservationAttention(booking({ check_in_date: '2026-11-12' }), TODAY, 'clean');
    expect(kinds(flags)).toEqual(['overdue_arrival']);
    expect(topSeverity(flags)).toBe('high');
  });

  it('flags active bookings without a room, but not finished ones', () => {
    expect(kinds(reservationAttention(booking({ room_id: null, check_in_date: '2026-11-20', check_out_date: '2026-11-22' }), TODAY))).toEqual(['unassigned']);
    expect(kinds(reservationAttention(booking({ room_id: null, status: 'checked_out' }), TODAY))).toEqual([]);
  });

  it('flags a Previo option ending within a day', () => {
    const now = Date.parse('2026-11-13T09:00:00Z');
    const option = booking({ status: 'pending', pms_status_id: 1, check_in_date: '2026-11-20', check_out_date: '2026-11-22' });
    expect(kinds(reservationAttention({ ...option, pms_option_expires_at: '2026-11-13T20:00:00Z' }, TODAY, null, now))).toEqual(['option_expiring']);
    expect(kinds(reservationAttention({ ...option, pms_option_expires_at: '2026-11-16T20:00:00Z' }, TODAY, null, now))).toEqual([]);
  });

  it('marks departures as information, not action', () => {
    const flags = reservationAttention(booking({ status: 'checked_in', check_in_date: '2026-11-10', check_out_date: TODAY }), TODAY);
    expect(kinds(flags)).toEqual(['due_out']);
    expect(needsAction(flags)).toBe(false);
  });

  it('orders several reasons by importance', () => {
    expect(kinds(reservationAttention(booking({ balance_due: 50 }), TODAY, 'dirty'))).toEqual(['room_not_ready', 'unpaid_arrival']);
  });

  it('ignores read-only snapshots and malformed dates', () => {
    expect(reservationAttention({ ...booking(), snapshotOnly: true }, TODAY, 'dirty')).toEqual([]);
    expect(reservationAttention(booking({ check_in_date: 'soon' }), TODAY, 'dirty')).toEqual([]);
  });
});

describe('nightlyOccupancy', () => {
  it('counts each room once per night and skips cancelled or unassigned bookings', () => {
    const rows = [
      { status: 'confirmed', room_id: 'a', check_in_date: '2026-11-13', check_out_date: '2026-11-15' },
      { status: 'checked_in', room_id: 'b', check_in_date: '2026-11-12', check_out_date: '2026-11-14' },
      { status: 'confirmed', room_id: 'a', check_in_date: '2026-11-13', check_out_date: '2026-11-14' },
      { status: 'cancelled', room_id: 'c', check_in_date: '2026-11-13', check_out_date: '2026-11-14' },
      { status: 'confirmed', room_id: null, check_in_date: '2026-11-13', check_out_date: '2026-11-14' },
    ];
    expect(nightlyOccupancy(rows, ['2026-11-13', '2026-11-14', '2026-11-15'], 4)).toEqual([
      { date: '2026-11-13', occupied: 2, percent: 50 },
      { date: '2026-11-14', occupied: 1, percent: 25 },
      { date: '2026-11-15', occupied: 0, percent: 0 },
    ]);
    expect(nightlyOccupancy(rows, ['2026-11-13'], 0)[0].percent).toBeNull();
  });
});

describe('importFreshness', () => {
  const now = Date.parse('2026-11-13T12:00:00Z');
  it('grades the last successful import', () => {
    expect(importFreshness('2026-11-13T11:50:00Z', now)).toEqual({ state: 'fresh', minutes: 10 });
    expect(importFreshness('2026-11-13T01:00:00Z', now).state).toBe('aging');
    expect(importFreshness('2026-09-03T08:20:00Z', now).state).toBe('stale');
    expect(importFreshness(null, now)).toEqual({ state: 'never', minutes: null });
    expect(importFreshness('2027-01-01T00:00:00Z', now).state).toBe('never');
  });
});
