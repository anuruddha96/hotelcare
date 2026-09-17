import { afterEach, describe, expect, it } from 'vitest';
import { autoAssignRooms, moveRoom, type RoomForAssignment, type StaffForAssignment } from './roomAssignmentAlgorithm';
import { gozsduAllocationRespectsBuildings } from './gozsduBuildingAssignment';
import { clearGozsduLaundryDutySession, setGozsduLaundryDutySession } from './gozsduLaundryDutySession';

const staff: StaffForAssignment[] = [
  { id: 'cleaner-west', full_name: 'West cleaner', nickname: null },
  { id: 'cleaner-east', full_name: 'East cleaner', nickname: null },
];
const date = '2026-09-17';
afterEach(() => clearGozsduLaundryDutySession(date));

function room(id: string, section: string, hotel = 'Gozsdu Court Budapest'): RoomForAssignment {
  return {
    id, room_number: id, hotel, floor_number: null, room_size_sqm: null,
    room_capacity: 4, is_checkout_room: true, status: 'dirty',
    housekeeping_section_id: `section-${section}`,
    housekeeping_section_name: section,
    pms_metadata: {
      gozsduAvailability: { status: 'operating', buildingCode: '1B' },
      gozsduAutoAssign: { cleaningSize: 'medium', verifiedBedCount: 4, checkoutMinutes: 50, serviceMinutes: 25 },
    },
  };
}

function fixture() {
  const west = room('west-room', 'Building I');
  const east = room('east-room', 'Kazinczy A');
  const plan = autoAssignRooms([west, east], staff, undefined, undefined,
    { hotelName: 'Gozsdu Court Budapest', randomSeed: 7 });
  const from = plan.find(person => person.rooms.some(item => item.id === east.id))!;
  const to = plan.find(person => person.rooms.some(item => item.id === west.id))!;
  return { west, east, plan, from, to };
}

describe('Gozsdu manager manual reassignment', () => {
  it('keeps auto-generated routes compatible and rejects normal cross-building moves', () => {
    const { east, plan, from, to } = fixture();
    expect(gozsduAllocationRespectsBuildings(plan)).toBe(true);
    expect(from.staffId).not.toBe(to.staffId);
    expect(moveRoom(plan, east.id, from.staffId, to.staffId)).toBe(plan);
    expect(moveRoom(plan, east.id, from.staffId, to.staffId, false)).toBe(plan);
  });

  it('allows an explicitly authorized manager move without losing rooms or changing the input plan', () => {
    const { east, plan, from, to } = fixture();
    const moved = moveRoom(plan, east.id, from.staffId, to.staffId, true);
    expect(moved).not.toBe(plan);
    expect(moved.find(person => person.staffId === to.staffId)?.rooms.map(item => item.id).sort())
      .toEqual(['east-room', 'west-room']);
    expect(moved.find(person => person.staffId === from.staffId)?.rooms).toHaveLength(0);
    expect(new Set(moved.flatMap(person => person.rooms.map(item => item.id))).size).toBe(2);
    expect(gozsduAllocationRespectsBuildings(moved)).toBe(false);
    expect(gozsduAllocationRespectsBuildings(plan)).toBe(true);
    expect(autoAssignRooms([room('another-west', 'Building I'), room('another-east', 'Kazinczy C')], staff,
      undefined, undefined, { hotelName: 'Gozsdu Court Budapest' })).toSatisfy?.toBeUndefined;
  });

  it('never permits moving a cleaning room to a Laundryner even with manager override', () => {
    const { east, plan, from, to } = fixture();
    setGozsduLaundryDutySession(date, [to.staffId]);
    expect(moveRoom(plan, east.id, from.staffId, to.staffId, true)).toBe(plan);
  });

  it('does not impose Gozsdu building rules on another hotel', () => {
    const first = room('mika-1', 'Building I', 'Hotel Mika Downtown');
    const second = room('mika-2', 'Kazinczy A', 'Hotel Mika Downtown');
    const previews = [
      { staffId: staff[0].id, staffName: staff[0].full_name, rooms: [first], totalWeight: 1, checkoutCount: 1, dailyCount: 0, estimatedMinutes: 45, totalWithBreak: 75, exceedsShift: false, overageMinutes: 0 },
      { staffId: staff[1].id, staffName: staff[1].full_name, rooms: [second], totalWeight: 1, checkoutCount: 1, dailyCount: 0, estimatedMinutes: 45, totalWithBreak: 75, exceedsShift: false, overageMinutes: 0 },
    ];
    expect(moveRoom(previews, second.id, staff[1].id, staff[0].id)).not.toBe(previews);
  });
});
