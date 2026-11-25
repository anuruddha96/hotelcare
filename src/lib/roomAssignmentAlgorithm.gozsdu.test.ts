import { describe, expect, it } from 'vitest';
import {
  autoAssignRooms, calculateRoomTime, calculateRoomWeight,
  calculateTimeEstimation, computeFairnessMetrics, moveRoom,
  type RoomForAssignment, type StaffForAssignment,
} from './roomAssignmentAlgorithm';
import * as legacy from './roomAssignmentAlgorithmCore';

const staff: StaffForAssignment[] = [
  { id: 'anna', full_name: 'Anna', nickname: null },
  { id: 'bea', full_name: 'Bea', nickname: null },
];
function room(id: string, building: string, extras: Partial<RoomForAssignment> = {}): RoomForAssignment {
  return {
    id, hotel: 'gozsdu-court', room_number: id, floor_number: null,
    room_size_sqm: null, room_capacity: 3, is_checkout_room: true, status: 'dirty',
    housekeeping_section_id: building, housekeeping_section_name: building,
    pms_metadata: {
      gozsduAvailability: { status: 'operating', buildingCode: '1B', pmsRoomName: `1B-${id}` },
      gozsduAutoAssign: {},
    },
    ...extras,
  };
}

describe('Gozsdu building-aware Auto Assign (no other hotel changes)', () => {
  it('keeps two manager-mapped buildings together when shifts permit', () => {
    const rooms = [
      room('101', 'Holló 12'), room('102', 'Holló 12'), room('103', 'Holló 12'),
      room('201', 'Kazinczy C'), room('202', 'Kazinczy C'), room('203', 'Kazinczy C'),
    ];
    const previews = autoAssignRooms(rooms, staff, undefined, undefined,
      { hotelName: 'Gozsdu Court Budapest', randomSeed: 42 });
    expect(previews.flatMap(p => p.rooms)).toHaveLength(6);
    const owners = (building: string) => previews.filter(p => p.rooms.some(r => r.housekeeping_section_id === building));
    expect(owners('Holló 12')).toHaveLength(1);
    expect(owners('Kazinczy C')).toHaveLength(1);
    expect(computeFairnessMetrics(previews).splitFloorCount).toBe(0);
    expect(previews.map(p => p.estimatedMinutes).sort((a,b) => a-b)).toEqual([165,165]);
  });

  it('uses manager targets exactly and only once a room size is mapped', () => {
    const large = room('large', 'Holló 12', {
      pms_metadata: { gozsduAvailability: { status: 'operating' },
        gozsduAutoAssign: { cleaningSize: 'large', verifiedBedCount: 4, checkoutMinutes: 90 } },
    });
    const unclassified = room('unmapped', 'Holló 12');
    expect(calculateRoomTime(large)).toBe(90);
    expect(calculateRoomTime(unclassified)).toBe(55);
    expect(calculateRoomWeight(large)).toBeGreaterThan(calculateRoomWeight(unclassified));
    expect(calculateTimeEstimation([large]).estimatedMinutes).toBe(90);
    expect(calculateTimeEstimation([large]).totalWithBreak).toBe(120);
  });

  it('never treats guest capacity as verified number of beds', () => {
    const withoutVerification = room('one', 'Building I', { room_capacity: 7 });
    const verified = room('two', 'Building I', { room_capacity: 7,
      pms_metadata: { gozsduAvailability: { status: 'operating' },
        gozsduAutoAssign: { verifiedBedCount: 4 } } });
    expect(calculateRoomWeight(verified)).toBeGreaterThan(calculateRoomWeight(withoutVerification));
  });

  it('keeps towels lightweight but accounts for verified beds on Change Room', () => {
    const towel = room('towel', 'Building II', {
      is_checkout_room: false, towel_change_required: true,
      pms_metadata: { gozsduAvailability: { status: 'operating' }, gozsduAutoAssign: { verifiedBedCount: 4 } },
    });
    const change = { ...towel, id: 'change', towel_change_required: false, linen_change_required: true };
    expect(calculateRoomTime(towel)).toBe(10);
    expect(calculateRoomTime(change)).toBe(30);
    expect(calculateRoomWeight(change)).toBeGreaterThan(calculateRoomWeight(towel));
  });

  it('omits unavailable and non-guest PMS units even when callers pass them', () => {
    const operating = room('open', 'Building IV');
    const inactive = room('closed', 'Building IV', {
      pms_metadata: { gozsduAvailability: { status: 'unavailable' } },
    });
    const privateSpace = room('private', 'Building IV', {
      pms_metadata: { gozsduAvailability: { status: 'non_guest' } },
    });
    expect(autoAssignRooms([operating,inactive,privateSpace],staff).flatMap(p => p.rooms.map(r => r.id)))
      .toEqual(['open']);
  });

  it('recalculates manager-target durations and effort on a manual move', () => {
    const big = room('big', 'Holló 10', {
      pms_metadata: { gozsduAvailability: { status: 'operating' },
        gozsduAutoAssign: { cleaningSize: 'extra_large', checkoutMinutes: 105, verifiedBedCount: 4 } },
    });
    const previews = autoAssignRooms([big],staff);
    const owner = previews.find(p => p.rooms.length === 1)!;
    const other = previews.find(p => p.staffId !== owner.staffId)!;
    const moved = moveRoom(previews,big.id,owner.staffId,other.staffId);
    expect(moved.find(p => p.staffId === owner.staffId)?.estimatedMinutes).toBe(0);
    expect(moved.find(p => p.staffId === other.staffId)?.estimatedMinutes).toBe(105);
  });

  it('delegates unchanged for other hotels and mixed-property input', () => {
    const mika = { ...room('101','Floor 1'), hotel: 'mika-downtown' };
    const config = { hotelName: 'Hotel Mika Downtown', randomSeed: 31 };
    expect(calculateRoomTime(mika)).toBe(legacy.calculateRoomTime(mika));
    expect(calculateRoomWeight(mika)).toBe(legacy.calculateRoomWeight(mika));
    expect(autoAssignRooms([mika],staff,undefined,undefined,config))
      .toEqual(legacy.autoAssignRooms([mika],staff,undefined,undefined,config));
    const mixed = [mika, room('201','Building I')];
    expect(autoAssignRooms(mixed,staff,undefined,undefined,config))
      .toEqual(legacy.autoAssignRooms(mixed,staff,undefined,undefined,config));
  });
});
