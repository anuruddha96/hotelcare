import { describe, expect, it } from 'vitest';
import type { AssignmentPreview, RoomForAssignment, StaffForAssignment } from './roomAssignmentAlgorithmCore';
import { calculateRoomTime, calculateRoomWeight, calculateTimeEstimation } from './roomAssignmentAlgorithmCore';
import { autoAssignMemoriesSpatially, setMemoriesSpatialConfig } from './memoriesSpatialAssignment';

const staff = (id: string): StaffForAssignment => ({ id, full_name: id, nickname: null });

function room(number: string, section: string, checkout = false): RoomForAssignment {
  return {
    id: `${section}-${number}`,
    room_number: number,
    hotel: 'Hotel Memories Budapest',
    floor_number: section === 'Ground Floor' ? 0 : 1,
    room_size_sqm: 20,
    room_capacity: 2,
    is_checkout_room: checkout,
    status: 'dirty',
    housekeeping_section_id: section,
    housekeeping_section_name: section,
  };
}

function preview(person: StaffForAssignment, rooms: RoomForAssignment[]): AssignmentPreview {
  return {
    staffId: person.id,
    staffName: person.full_name,
    rooms,
    totalWeight: rooms.reduce((sum, value) => sum + calculateRoomWeight(value), 0),
    checkoutCount: rooms.filter(value => value.is_checkout_room).length,
    dailyCount: rooms.filter(value => !value.is_checkout_room).length,
    ...calculateTimeEstimation(rooms),
  };
}

const recordingBase = (seen: string[][]) => (
  rooms: RoomForAssignment[],
  candidates: StaffForAssignment[],
): AssignmentPreview[] => {
  seen.push(candidates.map(person => person.id));
  return candidates.map((person, index) => preview(person, index === 0 ? rooms : []));
};

describe('Hotel Memories spatial planner', () => {
  it('lets a light Ground Floor worker help 100 Side but never in the reverse direction', () => {
    setMemoriesSpatialConfig({ sectionLinks: [], roomLinks: [] });
    const seen: string[][] = [];
    const base = recordingBase(seen);

    autoAssignMemoriesSpatially(base, [room('002', 'Ground Floor')], [staff('ground')], undefined, undefined, { hotelName: 'Hotel Memories Budapest' });
    autoAssignMemoriesSpatially(base, Array.from({ length: 8 }, (_, index) => room(String(102 + index), '100 Side', true)), [staff('upper')], undefined, undefined, { hotelName: 'Hotel Memories Budapest' });

    expect(seen[0]).toEqual(['ground']);
    expect(seen[1]).toContain('upper');
    expect(seen[1]).toContain('ground');
  });

  it('allows Near the elevator to share a candidate with 100 Side', () => {
    setMemoriesSpatialConfig({ sectionLinks: [], roomLinks: [] });
    const seen: string[][] = [];
    const base = recordingBase(seen);

    autoAssignMemoriesSpatially(base, [room('102', '100 Side')], [staff('side')], undefined, undefined, { hotelName: 'Hotel Memories Budapest' });
    autoAssignMemoriesSpatially(base, [room('101', 'Near the elevator')], [staff('elevator')], undefined, undefined, { hotelName: 'Hotel Memories Budapest' });

    expect(seen[1]).toContain('elevator');
    expect(seen[1]).toContain('side');
  });

  it('uses mapped room effort through the existing workload functions', () => {
    const doubleRoom = room('101', 'Near the elevator', true);
    const quadRoom = { ...room('103', 'Near the elevator', true), room_capacity: 4 };
    expect(calculateRoomTime(quadRoom)).toBeGreaterThan(calculateRoomTime(doubleRoom));
    expect(calculateRoomWeight(quadRoom)).toBeGreaterThan(calculateRoomWeight(doubleRoom));
  });
});
