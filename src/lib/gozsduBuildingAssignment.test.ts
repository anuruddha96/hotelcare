import { describe, expect, it } from 'vitest';
import { autoAssignRooms, moveRoom, type RoomForAssignment, type StaffForAssignment } from './roomAssignmentAlgorithm';
import { gozsduAllocationRespectsBuildings, gozsduRoomsCanShare } from './gozsduBuildingAssignment';

const staff: StaffForAssignment[] = Array.from({ length: 7 }, (_, i) => ({
  id: `worker-${i + 1}`, full_name: `Worker ${i + 1}`, nickname: null,
}));
const buildingIds = new Map<string, string>();
function room(section: string, index: number, extra: Partial<RoomForAssignment> = {}): RoomForAssignment {
  if (!buildingIds.has(section)) buildingIds.set(section, `mapped-section-${section}`);
  const large = index % 5 === 0;
  return {
    id: `${section}-${index}`, hotel: 'gozsdu-court', room_number: `${section}-${index}`,
    floor_number: null, room_size_sqm: null, room_capacity: large ? 6 : 3,
    is_checkout_room: index % 4 === 0, status: 'dirty',
    housekeeping_section_id: buildingIds.get(section)!, housekeeping_section_name: section,
    pms_metadata: {
      gozsduAvailability: { status: 'operating', buildingCode: '1B' },
      gozsduAutoAssign: {
        cleaningSize: large ? 'large' : 'medium', verifiedBedCount: large ? 6 : 3,
        checkoutMinutes: large ? 60 : 50, serviceMinutes: large ? 30 : 25,
      },
    },
    ...extra,
  };
}

const inventory = [
  ['Building I', 5], ['Building II', 3], ['Building III', 3],
  ['Building IV', 5], ['Building V', 1], ['Holló 12', 24],
  ['Holló 10', 5], ['Kazinczy A', 5], ['Kazinczy B', 8], ['Kazinczy C', 7],
] as const;
const rooms = inventory.flatMap(([section, count]) => Array.from({ length: count }, (_, index) => room(section, index + 1)));

describe('Gozsdu manager building-sharing policy', () => {
  it('enforces the user sketch as HARD pairwise constraints, not soft walking scores', () => {
    const allowed = [
      ['Building I', 'Building II'], ['Building I', 'Holló 12'],
      ['Building III', 'Building IV'], ['Building IV', 'Building V'],
      ['Building III', 'Holló 10'], ['Building V', 'Kazinczy A'],
      ['Kazinczy A', 'Kazinczy B'], ['Kazinczy B', 'Kazinczy C'],
      ['Kazinczy A', 'Holló 12'], ['Kazinczy C', 'Holló 10'],
    ] as const;
    const denied = [
      ['Building I', 'Kazinczy A'], ['Building II', 'Kazinczy B'],
      ['Building I', 'Building III'], ['Building II', 'Holló 10'],
      ['Building IV', 'Holló 12'], ['Holló 12', 'Holló 10'],
    ] as const;
    for (const [a, b] of allowed) expect(gozsduRoomsCanShare([room(a, 100), room(b, 101)])).toBe(true);
    for (const [a, b] of denied) expect(gozsduRoomsCanShare([room(a, 100), room(b, 101)])).toBe(false);
    // Room type buildingCode cannot override the manager's named section.
    expect(gozsduRoomsCanShare([room('Building I', 1), room('Kazinczy C', 1)])).toBe(false);
  });

  it('allocates every one of the 66 mapped operating units exactly once with fair effort', () => {
    expect(rooms).toHaveLength(66);
    const result = autoAssignRooms(rooms, staff, undefined, undefined,
      { hotelName: 'Gozsdu Court Budapest', randomSeed: 19 });
    const allocated = result.flatMap(person => person.rooms);
    expect(allocated).toHaveLength(66);
    expect(new Set(allocated.map(room => room.id)).size).toBe(66);
    expect(gozsduAllocationRespectsBuildings(result)).toBe(true);
    const active = result.filter(person => person.rooms.length > 0);
    expect(active.length).toBe(7);
    expect(Math.max(...active.map(person => person.estimatedMinutes)) - Math.min(...active.map(person => person.estimatedMinutes)))
      .toBeLessThanOrEqual(150);
    expect(result.flatMap(person => person.rooms).some(room => room.pms_metadata?.gozsduAvailability?.status !== 'operating'))
      .toBe(false);
  });

  it('keeps the settings-based bed/size effort and prevents a forbidden manual drag', () => {
    const west = room('Building II', 6);
    const east = room('Kazinczy A', 5);
    const original = autoAssignRooms([west, east], staff.slice(0, 2), undefined, undefined,
      { hotelName: 'Gozsdu Court Budapest', randomSeed: 1 });
    const westOwner = original.find(person => person.rooms.some(item => item.id === west.id))!;
    const eastOwner = original.find(person => person.rooms.some(item => item.id === east.id))!;
    expect(westOwner.staffId).not.toBe(eastOwner.staffId);
    expect(moveRoom(original, east.id, eastOwner.staffId, westOwner.staffId)).toBe(original);
    expect(original.flatMap(person => person.rooms).find(item => item.id === east.id)?.pms_metadata?.gozsduAutoAssign?.verifiedBedCount).toBe(6);
  });

  it('fails closed rather than combining incompatible buildings for one employee', () => {
    const impossible = autoAssignRooms([room('Building I', 1), room('Building IV', 1)], staff.slice(0, 1),
      undefined, undefined, { hotelName: 'Gozsdu Court Budapest' });
    expect(impossible).toEqual([]);
    expect(autoAssignRooms([room('Unknown', 1)], staff.slice(0, 1),
      undefined, undefined, { hotelName: 'Gozsdu Court Budapest' })).toEqual([]);
  });

  it('never includes inactive rooms or changes another hotel algorithm', () => {
    const inactive = room('Not available', 1, {
      pms_metadata: { gozsduAvailability: { status: 'unavailable' } },
    });
    const result = autoAssignRooms([...rooms, inactive], staff, undefined, undefined,
      { hotelName: 'Gozsdu Court Budapest' });
    expect(result.flatMap(person => person.rooms).some(item => item.id === inactive.id)).toBe(false);
    const mika = { ...room('Building I', 1), hotel: 'mika-downtown' };
    expect(autoAssignRooms([mika], staff.slice(0, 1))).toHaveLength(1);
  });
});
