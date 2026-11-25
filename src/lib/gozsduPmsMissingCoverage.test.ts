import { describe, expect, it } from 'vitest';
import { missingGozsduPmsRooms, reconcileGozsduPmsRoster, type GozsduPmsRow } from './gozsduPmsRoster';

const captured_at = '2026-09-21T13:15:00Z';
const names = ['1BBALC-B16', '1B-C43', 'ST-603', 'OTHER'];
const rooms = names.map((name, index) => ({ id: String(index), room_number: name, pms_metadata: { is_checkout_room: true } }));
const registry = names.map((name, index) => ({ room_id: String(index), pms_room_name: name, service_status: 'operating' }));
const snapshot: GozsduPmsRow[] = [{
  room_label: 'OTHER', room_number: 'other', arrival_date: '2026-09-20', departure_date: '2026-09-22',
  status: 'ongoing', housekeeping_dep: null, captured_at,
}];

describe('Gozsdu sparse PMS snapshot regression (21 September)', () => {
  it('identifies the exact omitted operating rooms without changing their registry', () => {
    expect(missingGozsduPmsRooms(registry, snapshot)).toEqual(['1BBALC-B16', '1B-C43', 'ST-603']);
    expect(registry.every(room => room.service_status === 'operating')).toBe(true);
  });

  it('fails closed with an explicit missing-room and UNKNOWN-occupancy warning', () => {
    expect(() => reconcileGozsduPmsRoster(rooms, registry, snapshot, '2026-09-21', Date.parse('2026-09-21T13:20:00Z')))
      .toThrow(/Missing from selected-day PMS: 1BBALC-B16, 1B-C43, ST-603.*booking and occupancy are UNKNOWN/);
  });

  it('matches room labels regardless of case or surrounding whitespace', () => {
    expect(missingGozsduPmsRooms(registry, [
      ...snapshot,
      { ...snapshot[0], room_label: ' 1bbalc-b16 ' },
      { ...snapshot[0], room_label: '1B-C43' },
    ])).toEqual(['ST-603']);
  });
});
