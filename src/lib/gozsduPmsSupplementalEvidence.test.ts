import { describe, expect, it } from 'vitest';
import {
  isGozsduVerifiedCheckout,
  isGozsduVerifiedUnsold,
  reconcileGozsduPmsRoster,
} from './gozsduPmsRoster';

const date = '2026-10-19';
const now = Date.parse('2026-10-19T07:55:00Z');
const lastSync = '2026-10-19T06:38:20Z';
const occupied = {
  room_label: '1B-101', room_number: '101',
  arrival_date: '2026-10-17', departure_date: '2026-10-21',
  status: 'ongoing', housekeeping_dep: null,
  captured_at: '2026-10-19T07:45:01Z',
};
const rooms = [
  { id: 'occupied', room_number: '101', pms_metadata: {} },
  { id: 'checkout', room_number: '3002', pms_metadata: {
    pmsProvider: 'previo', pmsSyncDate: date, lastServerMorningSyncAt: lastSync,
    checkedOutToday: true, scheduledDepartureToday: true,
    checkedOutAt: '2026-10-19T06:27:32Z', departureDate: date,
    isNoShow: false, isCancelled: false, currentNight: 3, totalNights: 3,
  } },
  { id: 'arrival', room_number: '410', pms_metadata: {
    pmsProvider: 'previo', pmsSyncDate: date, lastServerMorningSyncAt: lastSync,
    arrivalToday: true, reservationStatusId: 2, scheduledDepartureToday: false,
    isNoShow: false, isCancelled: false, checkedOutToday: false, totalNights: 3,
  } },
  { id: 'unsold', room_number: '411', pms_metadata: {
    pmsProvider: 'previo', pmsSyncDate: date, lastServerMorningSyncAt: lastSync,
    pmsOccupancyStatus: 'unsold',
    pmsVacancyEvidence: 'current_previo_reservation_snapshot_and_physical_room_roster',
    pmsVacancyVerifiedAt: lastSync, reservationId: null,
    occupiedToday: false, arrivalToday: false, checkedOutToday: false,
    isNoShow: false,
  } },
];
const registry = [
  { room_id: 'occupied', pms_room_name: '1B-101', service_status: 'operating' },
  { room_id: 'checkout', pms_room_name: '1BBALC-3002', service_status: 'operating' },
  { room_id: 'arrival', pms_room_name: '1BBALC-410', service_status: 'operating' },
  { room_id: 'unsold', pms_room_name: '1BBALC-411', service_status: 'operating' },
];

describe('Gozsdu 19 October sparse occupied-night reconciliation', () => {
  it('accepts only independent fresh same-day Previo room evidence for the omitted rooms', () => {
    const result = reconcileGozsduPmsRoster(rooms, registry, [occupied], date, now);
    expect([...result.byRoom.keys()]).toHaveLength(4);
    expect(result.byRoom.get('checkout')?.bucket).toBe('checkout');
    expect(result.byRoom.get('arrival')?.bucket).toBe('arrival');
    expect(result.byRoom.get('unsold')?.bucket).toBe('other');
    expect(result.byRoom.get('unsold')?.service).toBe('none');
  });

  it('keeps an unknown or stale unreported room blocked, rather than assuming vacant', () => {
    const unknown = rooms.map(r => r.id === 'unsold'
      ? { ...r, pms_metadata: { ...r.pms_metadata, pmsVacancyEvidence: null } } : r);
    expect(() => reconcileGozsduPmsRoster(unknown, registry, [occupied], date, now))
      .toThrow(/booking and occupancy are UNKNOWN/);
    const stale = rooms.map(r => r.id === 'unsold'
      ? { ...r, pms_metadata: { ...r.pms_metadata, pmsVacancyVerifiedAt: '2026-10-19T03:00:00Z' } } : r);
    expect(() => reconcileGozsduPmsRoster(stale, registry, [occupied], date, now))
      .toThrow(/booking and occupancy are UNKNOWN/);
  });

  it('never turns a room without explicit checkout evidence into a checkout', () => {
    expect(isGozsduVerifiedCheckout(rooms[1], date, now)).toBe(true);
    expect(isGozsduVerifiedCheckout({ ...rooms[1], pms_metadata: {
      ...rooms[1].pms_metadata, checkedOutToday: false,
    } }, date, now)).toBe(false);
    expect(isGozsduVerifiedUnsold(rooms[3], date, now)).toBe(true);
    expect(isGozsduVerifiedUnsold({ ...rooms[3], pms_metadata: {
      ...rooms[3].pms_metadata, arrivalToday: true,
    } }, date, now)).toBe(false);
  });

  it('does not authorize a different date or a late, stale room sync', () => {
    expect(isGozsduVerifiedCheckout(rooms[1], '2026-10-20', now)).toBe(false);
    expect(isGozsduVerifiedUnsold(rooms[3], '2026-10-20', now)).toBe(false);
    expect(isGozsduVerifiedUnsold(rooms[3], date, now + 3 * 3600_000)).toBe(false);
  });
});
