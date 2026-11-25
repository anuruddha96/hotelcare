import { describe, expect, it } from 'vitest';
import { canonicalGozsduOverviewName, groupGozsduOverviewByBuilding } from './gozsduRoomOverviewDisplay';

const rooms = [
  { id: 'c13', room_number: '13' },
  { id: 'c33', room_number: '33' },
  { id: 'b25', room_number: '25' },
  { id: 'inactive6', room_number: '6' },
];
const registry = new Map([
  ['c13', { pms_room_name: '1B-C13' }],
  ['c33', { pms_room_name: '1B-C33' }],
  ['b25', { pms_room_name: '2B-B25' }],
  ['inactive6', { pms_room_name: '2B-3/T/6' }],
]);
const name = (room: typeof rooms[number]) => canonicalGozsduOverviewName(room, registry);

describe('Gozsdu overview canonical PMS labels', () => {
  it('uses complete names for shortened numeric aliases including unavailable room 6', () => {
    expect(rooms.map(name)).toEqual(['1B-C13', '1B-C33', '2B-B25', '2B-3/T/6']);
  });
  it('does not mislabel an unknown record with an ambiguous number', () => {
    expect(canonicalGozsduOverviewName({ id: 'missing', room_number: '13' }, registry))
      .toBe('Unverified PMS room');
  });
});

describe('Gozsdu overview uses real mapped buildings rather than floor or PMS prefixes', () => {
  const buildings = [
    { id: 'building1', name: 'Building I', sort_order: 1 },
    { id: 'kazC', name: 'Kazinczy C', sort_order: 30 },
    { id: 'kazB', name: 'Kazinczy B', sort_order: 20 },
  ];
  const mapping = [
    { room_id: 'c13', section_id: 'kazC' },
    { room_id: 'c33', section_id: 'kazC' },
    { room_id: 'b25', section_id: 'kazB' },
  ];
  it('groups 1B-C13 and 1B-C33 under Kazinczy C, 2B-B25 under Kazinczy B', () => {
    const groups = groupGozsduOverviewByBuilding(rooms.slice(0, 3), mapping, buildings, name);
    expect(groups.map(group => [group.label, group.rooms.map(name)])).toEqual([
      ['Kazinczy B', ['2B-B25']],
      ['Kazinczy C', ['1B-C13', '1B-C33']],
    ]);
  });
  it('makes a missing mapping explicit and does not infer physical building from 2B', () => {
    const groups = groupGozsduOverviewByBuilding(rooms, mapping, buildings, name);
    expect(groups.at(-1)?.label).toBe('Unmapped building');
    expect(groups.at(-1)?.rooms.map(name)).toEqual(['2B-3/T/6']);
  });
  it('is read-only: preserves database room numbers and stable IDs', () => {
    groupGozsduOverviewByBuilding(rooms, mapping, buildings, name);
    expect(rooms[0]).toEqual({ id: 'c13', room_number: '13' });
  });
});
