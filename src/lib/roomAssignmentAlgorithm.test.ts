import { describe, expect, it } from 'vitest';
import {
  autoAssignRooms,
  computeFairnessMetrics,
  moveRoom,
  type RoomForAssignment,
  type StaffForAssignment,
} from './roomAssignmentAlgorithm';

const staff: StaffForAssignment[] = [
  { id: 'a', full_name: 'A', nickname: null },
  { id: 'b', full_name: 'B', nickname: null },
  { id: 'c', full_name: 'C', nickname: null },
  { id: 'd', full_name: 'D', nickname: null },
];

function room(
  id: string,
  room_number: string,
  capacity = 2,
  extras: Partial<RoomForAssignment> = {}
): RoomForAssignment {
  return {
    id,
    room_number,
    hotel: 'mika-downtown',
    floor_number: null,
    room_size_sqm: null,
    room_capacity: capacity,
    is_checkout_room: false,
    status: 'dirty',
    ...extras,
  };
}

describe('autoAssignRooms locality + fairness', () => {
  it('keeps Mika-like same-floor rooms clustered while using all four selected staff fairly', () => {
    const rooms: RoomForAssignment[] = [
      room('107', '107', 3, { towel_change_required: true }),
      room('301', '301'),
      room('304', '304', 2, { towel_change_required: true }),
      room('305', '305', 2, { towel_change_required: true }),
      room('suite', 'SUITE - 2/3 (DB+Sofa)', 4, { room_category: 'Superior Suite' }),
      room('trp', 'TRP - 2/1', 3, { room_category: 'Deluxe Triple Room' }),
    ];

    const previews = autoAssignRooms(rooms, staff, undefined, undefined, {
      hotelName: 'Hotel Mika Downtown',
      // Mirrors Mika's hotel_autoassign_profiles tuning. Mika's apartment-style
      // F0 units and numbered floors benefit from a deliberately strong route
      // continuity preference; overload/fairness guards still cap clustering.
      floorPenaltyMultiplier: 9,
      randomSeed: 42,
    });

    const counts = previews.map(p => p.rooms.length).sort((a, b) => b - a);
    expect(counts).toEqual([2, 2, 1, 1]);

    const ownersOfFloor3 = previews.filter(p =>
      p.rooms.some(r => ['301', '304', '305'].includes(r.room_number))
    );
    expect(ownersOfFloor3.length).toBeLessThanOrEqual(2);

    const floor0Composite = previews.filter(p =>
      p.rooms.some(r => ['SUITE - 2/3 (DB+Sofa)', 'TRP - 2/1'].includes(r.room_number))
    );
    expect(floor0Composite.length).toBe(1);

    const metrics = computeFairnessMetrics(previews);
    expect(metrics.dailyDiff).toBeLessThanOrEqual(1);
    expect(metrics.totalDiff).toBeLessThanOrEqual(1);
    expect(metrics.splitFloorCount).toBeLessThanOrEqual(1);
  });

  it('spreads heavy checkout rooms instead of stacking them on one housekeeper', () => {
    const rooms: RoomForAssignment[] = [
      room('q1', '101', 4, { is_checkout_room: true, room_size_sqm: 42 }),
      room('q2', '102', 4, { is_checkout_room: true, room_size_sqm: 40 }),
      room('t1', '201', 3, { is_checkout_room: true }),
      room('t2', '202', 3, { is_checkout_room: true }),
      room('d1', '301', 2, { is_checkout_room: true }),
      room('d2', '302', 2, { is_checkout_room: true }),
      room('d3', '303', 2, { is_checkout_room: true }),
      room('d4', '304', 2, { is_checkout_room: true }),
    ];

    const previews = autoAssignRooms(rooms, staff, undefined, undefined, { randomSeed: 7 });
    const metrics = computeFairnessMetrics(previews);

    expect(metrics.checkoutDiff).toBeLessThanOrEqual(1);
    expect(metrics.heavyRoomDiff).toBeLessThanOrEqual(1);
  });

  it('never lets later heavy/locality rebalancing undo checkout fairness', () => {
    // This mix previously exposed a 3-vs-1 checkout result after checkout
    // fairness had already been achieved, because a later heavy-room move could
    // move a checkout again. Keep it as a regression case.
    const rooms: RoomForAssignment[] = [
      room('312d', '312', 2, { room_size_sqm: 30 }),
      room('107co', '107', 4, { is_checkout_room: true }),
      room('214co', '214', 2, { is_checkout_room: true }),
      room('310co', '310', 2, { is_checkout_room: true }),
      room('113co', '113', 4, { is_checkout_room: true }),
      room('120d', '120', 2, { room_size_sqm: 20 }),
      room('307co', '307', 2, { is_checkout_room: true, room_size_sqm: 20 }),
      room('409co', '409', 2, { is_checkout_room: true }),
      room('410d', '410', 4),
      room('410co', '410', 2, { is_checkout_room: true, room_size_sqm: 30 }),
      room('210co', '210', 2, { is_checkout_room: true }),
      room('118d', '118', 3, { room_size_sqm: 30 }),
    ];

    const previews = autoAssignRooms(rooms, staff, undefined, undefined, { randomSeed: 1 });
    expect(computeFairnessMetrics(previews).checkoutDiff).toBeLessThanOrEqual(1);
  });

  it('recomputes workload correctly after a manual move', () => {
    const rooms = [room('301', '301'), room('302', '302')];
    const previews = autoAssignRooms(rooms, staff.slice(0, 2), undefined, undefined, { randomSeed: 3 });
    const source = previews.find(p => p.rooms.length > 0)!;
    const target = previews.find(p => p.staffId !== source.staffId)!;
    const movedRoom = source.rooms[0];

    const result = moveRoom(previews, movedRoom.id, source.staffId, target.staffId);
    const updatedSource = result.find(p => p.staffId === source.staffId)!;
    const updatedTarget = result.find(p => p.staffId === target.staffId)!;

    expect(updatedSource.rooms.some(r => r.id === movedRoom.id)).toBe(false);
    expect(updatedTarget.rooms.some(r => r.id === movedRoom.id)).toBe(true);
    expect(updatedTarget.totalWeight).toBeGreaterThanOrEqual(0);
    expect(updatedTarget.estimatedMinutes).toBeGreaterThanOrEqual(15);
  });
});
