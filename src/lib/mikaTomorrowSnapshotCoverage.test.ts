import { describe, expect, it } from 'vitest';
import { verifyMikaTomorrowCoverage, type MikaInventoryRoom } from './mikaTomorrowSnapshotCoverage';
import type { DailyOverviewWorkRow } from './nextDayHousekeepingSnapshot';

const TODAY = '2026-09-20';
const TOMORROW = '2026-09-21';
const CAPTURED = '2026-09-20T14:00:05.017Z';
const inventory: MikaInventoryRoom[] = [
  { id: '104', room_number: '104' },
  { id: 'suite-1-8', room_number: '2B, SUITE - 1/8' },
  ...Array.from({ length: 31 }, (_, index) => ({ id: String(200 + index), room_number: String(200 + index) })),
];

function snapshot(room: MikaInventoryRoom, date: string, departure: string): DailyOverviewWorkRow {
  return {
    room_label: room.id === '104' ? 'TRP - 104' : room.room_number,
    room_number: room.id === 'suite-1-8' ? '1/8' : room.room_number,
    arrival_date: '2026-09-18',
    departure_date: departure,
    status: departure === date ? 'departing' : 'ongoing',
    housekeeping_dep: departure === date ? 'DEP' : null,
    housekeeping_stay: departure === date ? null : 'STAY',
    captured_at: CAPTURED,
  };
}
const today = inventory.map((room, i) => snapshot(room, TODAY, i < 2 ? TODAY : '2026-09-23'));
const tomorrow = inventory.slice(2).map(room => snapshot(room, TOMORROW, '2026-09-23'));
const valid = (previous = today, next = tomorrow, rooms = inventory) =>
  verifyMikaTomorrowCoverage(rooms, previous, next, TODAY, TOMORROW);

describe('Mika next-day PMS snapshot coverage', () => {
  it('accepts 31 of 33 rows only when both omitted rooms explicitly departed yesterday', () => {
    expect(valid()).toBe(true);
  });

  it('accepts all 33 rooms and a newly booked turnover in the exact tomorrow snapshot', () => {
    const turnover = { ...snapshot(inventory[0], TOMORROW, '2026-09-22'), arrival_date: TOMORROW };
    expect(valid(today, [...tomorrow, turnover])).toBe(true);
  });

  it('rejects a missing stayover or an incomplete previous-day roster', () => {
    expect(valid(today.map((row, i) => i === 0 ? { ...row, departure_date: '2026-09-23' } : row))).toBe(false);
    expect(valid(today.slice(1))).toBe(false);
  });

  it('rejects duplicate, unknown and invalid-dated rows rather than silently omitting bookings', () => {
    expect(valid(today, [...tomorrow, tomorrow[0]])).toBe(false);
    expect(valid(today, [...tomorrow, { ...tomorrow[0], room_label: 'UNMAPPED', room_number: '9999' }])).toBe(false);
    expect(valid(today, tomorrow.map((row, index) => index === 0 ? { ...row, departure_date: TODAY } : row))).toBe(false);
  });

  it('rejects missing timestamps or duplicate inventory mappings', () => {
    expect(valid(today.map((row, index) => index === 0 ? { ...row, captured_at: null } : row))).toBe(false);
    expect(valid(today, tomorrow.map((row, index) => index === 0 ? { ...row, captured_at: null } : row))).toBe(false);
    expect(valid(today, tomorrow, [...inventory.slice(0, -1), { id: '104', room_number: '230' }])).toBe(false);
  });

  it('distinguishes suites with slash identifiers from numeric room identifiers', () => {
    const rooms = [{ id: 'suite', room_number: 'SUITE - 1/2' }, { id: 'triple', room_number: 'TRP - 2/1' }];
    const previous = rooms.map(room => snapshot(room, TODAY, '2026-09-23'));
    const next = rooms.map(room => snapshot(room, TOMORROW, '2026-09-23'));
    expect(valid(previous, next, rooms)).toBe(true);
    expect(valid(previous, [next[0]], rooms)).toBe(false);
  });
});
