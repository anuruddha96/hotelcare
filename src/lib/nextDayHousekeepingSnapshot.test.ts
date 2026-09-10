import { describe, expect, it } from 'vitest';
import {
  buildSelectedDateHousekeepingWorkload,
  nextDayRoomMatchTokens,
  type DailyOverviewWorkRow,
} from './nextDayHousekeepingSnapshot';

const baseRoom = (id: string, room_number: string) => ({
  id,
  room_number,
  hotel: 'mika-downtown',
  floor_number: null,
  room_size_sqm: null,
  room_capacity: 2,
  is_checkout_room: false,
  pms_metadata: {},
  status: 'clean',
  towel_change_required: false,
  linen_change_required: false,
  wing: null,
  elevator_proximity: null,
  room_category: null,
  bed_configuration: null,
  notes: null,
  checkout_time: null,
});

const snapshot = (
  room_number: string,
  status: 'departing' | 'ongoing',
  arrival_date: string,
  departure_date: string,
): DailyOverviewWorkRow => ({
  room_label: room_number,
  room_number,
  arrival_date,
  departure_date,
  status,
  housekeeping_dep: status === 'departing' ? 'DEP' : null,
  housekeeping_stay: null,
  captured_at: '2026-09-09T19:45:02.001Z',
});

describe('next-day housekeeping selected-date snapshot', () => {
  it('maps Mika apartment labels without collapsing them to the last digit', () => {
    const rooms = [
      baseRoom('r12', 'SUITE - 1/2'),
      baseRoom('r16', 'ST - 1/6'),
      baseRoom('r17', 'DB - 1/7'),
      baseRoom('r18', '2B, SUITE - 1/8'),
      baseRoom('r21', 'TRP - 2/1'),
      baseRoom('r22', 'SUITE - 2/2 (DB+Sofa)'),
      baseRoom('r108', '108'),
    ];
    const rows = [
      snapshot('1/2', 'ongoing', '2026-09-08', '2026-09-11'),
      snapshot('1/6', 'departing', '2026-09-09', '2026-09-10'),
      snapshot('1/7', 'ongoing', '2026-09-07', '2026-09-11'),
      snapshot('1/8', 'departing', '2026-09-08', '2026-09-10'),
      snapshot('2/1', 'ongoing', '2026-09-09', '2026-09-12'),
      snapshot('2/2 (DB+Sofa)', 'departing', '2026-09-09', '2026-09-10'),
      snapshot('108 (DB+SNG)', 'departing', '2026-09-07', '2026-09-10'),
    ];

    const workload = buildSelectedDateHousekeepingWorkload(rooms, rows, '2026-09-10');
    expect(workload.rooms.map(room => room.id)).toEqual([
      'r12', 'r16', 'r17', 'r18', 'r21', 'r22', 'r108',
    ]);
    expect(workload.checkoutCount).toBe(4);
    expect(workload.dailyCount).toBe(3);
    expect(nextDayRoomMatchTokens('SUITE - 1/2')).toContain('unit:1/2');
    expect(nextDayRoomMatchTokens('SUITE - 2/2 (DB+Sofa)')).toContain('unit:2/2');
    expect(nextDayRoomMatchTokens('108 (DB+SNG)')).toContain('room:108');
    expect(nextDayRoomMatchTokens('SUITE - 1/2')).not.toContain('room:2');
  });

  it('reproduces the Mika 33-room workload as 19 checkouts and 14 daily rooms', () => {
    const rooms = Array.from({ length: 33 }, (_, index) => baseRoom(`r${index + 1}`, String(101 + index)));
    const rows = rooms.map((room, index) => index < 19
      ? snapshot(room.room_number, 'departing', '2026-09-08', '2026-09-10')
      : snapshot(room.room_number, 'ongoing', '2026-09-08', '2026-09-12'));

    const workload = buildSelectedDateHousekeepingWorkload(rooms, rows, '2026-09-10');
    expect(workload.rooms).toHaveLength(33);
    expect(workload.checkoutCount).toBe(19);
    expect(workload.dailyCount).toBe(14);
  });

  it('keeps tomorrow independent from today even when the same 33 rooms are occupied', () => {
    const rooms = Array.from({ length: 33 }, (_, index) => baseRoom(`r${index + 1}`, String(101 + index)));
    const todayRows = rooms.map((room, index) => index < 19
      ? snapshot(room.room_number, 'departing', '2026-09-08', '2026-09-10')
      : snapshot(room.room_number, 'ongoing', '2026-09-08', '2026-09-12'));
    const tomorrowRows = rooms.map((room, index) => index < 11
      ? snapshot(room.room_number, 'departing', '2026-09-09', '2026-09-11')
      : snapshot(room.room_number, 'ongoing', '2026-09-08', '2026-09-13'));

    const today = buildSelectedDateHousekeepingWorkload(rooms, todayRows, '2026-09-10');
    const tomorrow = buildSelectedDateHousekeepingWorkload(rooms, tomorrowRows, '2026-09-11');

    expect([today.checkoutCount, today.dailyCount]).toEqual([19, 14]);
    expect([tomorrow.checkoutCount, tomorrow.dailyCount]).toEqual([11, 22]);
    expect(tomorrow.rooms.every(room => room.pms_metadata?.plannedHousekeepingDate === '2026-09-11')).toBe(true);
  });

  it('fails closed when a selected-date Previo room cannot be mapped', () => {
    expect(() => buildSelectedDateHousekeepingWorkload(
      [baseRoom('r101', '101')],
      [snapshot('999', 'departing', '2026-09-09', '2026-09-10')],
      '2026-09-10',
    )).toThrow(/mapping is incomplete/i);
  });

  it('does not treat arrival-day reservations as daily cleaning', () => {
    const workload = buildSelectedDateHousekeepingWorkload(
      [baseRoom('r101', '101')],
      [{
        ...snapshot('101', 'ongoing', '2026-09-10', '2026-09-12'),
        status: null,
      }],
      '2026-09-10',
    );
    expect(workload.rooms).toHaveLength(0);
  });
});
