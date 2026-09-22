import { describe, expect, it } from 'vitest';
import {
  diversifyHousekeepingCandidate,
  sameHousekeepingRoomGroups,
} from './housekeepingCandidateDiversification';
import {
  autoAssignRooms,
  calculateRoomWeight,
  calculateTimeEstimation,
  type AssignmentPreview,
  type RoomForAssignment,
} from './roomAssignmentAlgorithm';
import { gozsduAllocationRespectsBuildings } from './gozsduBuildingAssignment';

function room(id: string, section = 'Building I', extra: Partial<RoomForAssignment> = {}): RoomForAssignment {
  return {
    id, hotel: 'gozsdu-court', room_number: id,
    floor_number: 1, room_size_sqm: 23, room_capacity: 2, is_checkout_room: true,
    status: 'dirty', housekeeping_section_id: `section-${section}`,
    housekeeping_section_name: section,
    pms_metadata: {
      gozsduAvailability: { status: 'operating' },
      gozsduAutoAssign: { checkoutMinutes: 45, verifiedBedCount: 2 },
    },
    ...extra,
  };
}

function person(id: string, rooms: RoomForAssignment[]): AssignmentPreview {
  return {
    staffId: id, staffName: id, rooms,
    totalWeight: rooms.reduce((sum, item) => sum + calculateRoomWeight(item), 0),
    checkoutCount: rooms.filter(item => item.is_checkout_room).length,
    dailyCount: rooms.filter(item => !item.is_checkout_room).length,
    ...calculateTimeEstimation(rooms),
  };
}

const allocated = (previews: AssignmentPreview[]) =>
  previews.flatMap(preview => preview.rooms.map(item => item.id)).sort();

describe('shared housekeeping candidate diversification', () => {
  it('reassigns actual rooms rather than swapping names and preserves one-room-one-owner coverage', () => {
    const baseline = [
      person('a', [room('101'), room('102'), room('103')]),
      person('b', [room('104'), room('105'), room('106')]),
    ];
    const result = diversifyHousekeepingCandidate(baseline, { randomSeed: 112, enforceGozsduRoutes: true });
    expect(allocated(result)).toEqual(allocated(baseline));
    expect(new Set(allocated(result)).size).toBe(6);
    expect(sameHousekeepingRoomGroups(result, baseline)).toBe(false);
    expect(gozsduAllocationRespectsBuildings(result)).toBe(true);
    expect(result.map(item => item.staffId)).toEqual(['a', 'b']);
    expect(result.every(item => !item.exceedsShift)).toBe(true);
  });

  it('creates more than one room-based layout across seeds if comparable choices exist', () => {
    const baseline = [
      person('a', [room('201'), room('202'), room('203')]),
      person('b', [room('204'), room('205'), room('206')]),
    ];
    const keys = new Set(Array.from({ length: 12 }, (_, seed) => {
      const next = diversifyHousekeepingCandidate(baseline, { randomSeed: seed * 7919 + 1, enforceGozsduRoutes: true });
      return next[0].rooms.map(item => item.id).sort().join(',');
    }));
    expect(keys.size).toBeGreaterThan(1);
  });

  it('does not relax the incompatible Gozsdu building policy to invent variety', () => {
    const baseline = [
      person('west', [room('W1', 'Building I'), room('W2', 'Building II')]),
      person('east', [room('E1', 'Building IV'), room('E2', 'Building V')]),
    ];
    const result = diversifyHousekeepingCandidate(baseline, { randomSeed: 100, enforceGozsduRoutes: true });
    expect(result).toBe(baseline);
    expect(gozsduAllocationRespectsBuildings(result)).toBe(true);
  });

  it('never introduces overtime merely to produce a different preview', () => {
    const heavy = (id: string, minutes: number) => room(id, 'Building I', {
      pms_metadata: {
        gozsduAvailability: { status: 'operating' },
        gozsduAutoAssign: { checkoutMinutes: minutes, verifiedBedCount: 2 },
      },
    });
    const baseline = [
      person('a', [heavy('A1', 400), heavy('A2', 45)]),
      person('b', [heavy('B1', 10), heavy('B2', 10)]),
    ];
    const result = diversifyHousekeepingCandidate(baseline, { randomSeed: 3, enforceGozsduRoutes: true });
    expect(result.every(item => item.estimatedMinutes <= 450)).toBe(true);
    expect(allocated(result)).toEqual(allocated(baseline));
  });

  it('keeps independently configured hotels separate when called with their own inventory', () => {
    const staff = [
      { id: 'hotel-a-one', full_name: 'One', nickname: null },
      { id: 'hotel-a-two', full_name: 'Two', nickname: null },
    ];
    const rooms = [room('A1', 'Building I', { hotel: 'Hotel Memories Budapest' }),
      room('A2', 'Building I', { hotel: 'Hotel Memories Budapest' })];
    const result = autoAssignRooms(rooms, staff, undefined, undefined,
      { hotelName: 'Hotel Memories Budapest', randomSeed: 19 });
    expect(allocated(result)).toEqual(['A1', 'A2']);
    expect(result.every(item => staff.some(worker => worker.id === item.staffId))).toBe(true);
    expect(result.flatMap(item => item.rooms).every(item => item.hotel === 'Hotel Memories Budapest')).toBe(true);
  });
});
