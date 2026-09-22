import { describe, expect, it } from 'vitest';
import { isGozsduAwaitingArrival, reconcileGozsduPmsRoster } from './gozsduPmsRoster';

const date = '2026-09-22';
const captured_at = '2026-09-22T08:36:20.279Z';
const now = Date.parse('2026-09-22T08:40:00Z');
const arrivalMetadata = {
  roomId: '1856811', pmsSyncDate: date, arrivalToday: true, notArrived: true,
  reservationStatusId: 2, isNoShow: false, isCancelled: false,
  occupiedToday: false, checkedOutToday: false, scheduledDepartureToday: false,
  totalNights: 3,
};
const arrivalRooms = ['3B-C41', '2B-C34', '2B-1/2/4', '16'].map((room_number, i) => ({
  id: `arrival-${i}`, room_number, pms_metadata: { ...arrivalMetadata, totalNights: i + 1 },
}));
const rooms = [
  { id: 'checkout', room_number: 'ST-101', pms_metadata: { isNoShow: false } },
  { id: 'stay', room_number: 'ST-102', pms_metadata: { isNoShow: false } },
  ...arrivalRooms,
];
const registry = rooms.map(room => ({ room_id: room.id, pms_room_name: room.room_number === '16' ? '1BBALC-B16' : room.room_number, service_status: 'operating' }));
const snapshots = [
  { room_label: 'ST-101', room_number: 'ST-101', arrival_date: '2026-09-19', departure_date: date, status: 'departing', housekeeping_dep: 'DEP', captured_at },
  { room_label: 'ST-102', room_number: 'ST-102', arrival_date: '2026-09-21', departure_date: '2026-09-25', status: 'ongoing', housekeeping_dep: null, captured_at },
];

describe('Gozsdu awaiting-arrival classification', () => {
  it('recognises all four confirmed same-day pending arrivals including the mapped B16 alias', () => {
    for (const room of arrivalRooms) expect(isGozsduAwaitingArrival(room, date)).toBe(true);
    const result = reconcileGozsduPmsRoster(rooms, registry, snapshots, date, now);
    expect(result.byRoom.size).toBe(6);
    expect(result.byRoom.get('checkout')?.bucket).toBe('checkout');
    expect(result.byRoom.get('stay')?.bucket).toBe('other');
    for (const room of arrivalRooms) {
      expect(result.byRoom.get(room.id)?.bucket).toBe('arrival');
      expect(result.byRoom.get(room.id)?.service).toBe('none');
      expect(result.byRoom.get(room.id)?.night).toBe(1);
    }
  });

  it('does not assume a pending arrival is a no-show or checked-out room', () => {
    const room = arrivalRooms[0];
    for (const patch of [
      { isNoShow: true }, { reservationStatusId: 8 }, { isCancelled: true },
      { occupiedToday: true }, { checkedOutToday: true }, { scheduledDepartureToday: true },
      { notArrived: false }, { arrivalToday: false }, { pmsSyncDate: '2026-09-21' },
      { reservationStatusId: 3 },
    ]) {
      expect(isGozsduAwaitingArrival({ ...room, pms_metadata: { ...room.pms_metadata, ...patch } }, date)).toBe(false);
    }
    expect(isGozsduAwaitingArrival(room, '2026-09-21')).toBe(false);
    expect(isGozsduAwaitingArrival({ id: 'empty', room_number: 'empty' }, date)).toBe(false);
  });

  it('preserves incomplete-coverage protection for missing rooms without an explicit pending arrival', () => {
    const unknown = rooms.map(room => room.id === 'arrival-0'
      ? { ...room, pms_metadata: { ...room.pms_metadata, notArrived: false } } : room);
    expect(() => reconcileGozsduPmsRoster(unknown, registry, snapshots, date, now)).toThrow(/incomplete/);
  });

  it('rejects stale snapshots and duplicate room rows even with pending arrivals', () => {
    expect(() => reconcileGozsduPmsRoster(rooms, registry, snapshots, date, now + 7200000)).toThrow(/stale/);
    expect(() => reconcileGozsduPmsRoster(rooms, registry, [...snapshots, snapshots[0]], date, now)).toThrow(/duplicated/);
  });

  it('honours an actual scheduled departure over a coincident same-day arrival', () => {
    const sameDay = { ...snapshots[0], room_label: '3B-C41', room_number: '3B-C41' };
    const result = reconcileGozsduPmsRoster(rooms, registry, [...snapshots, sameDay], date, now);
    expect(result.byRoom.get('arrival-0')?.bucket).toBe('checkout');
  });
});
