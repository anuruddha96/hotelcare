import { describe, expect, it } from 'vitest';
import {
  autoAssignRooms,
  type RoomForAssignment,
  type StaffForAssignment,
} from '../roomAssignmentAlgorithmMapped';
import { assignSectionTasksToStaff } from '../housekeepingSectionTasks';

function makeRoom(
  roomNumber: string,
  sectionId: string | null,
  options: { checkout?: boolean; floor?: number } = {},
): RoomForAssignment {
  return {
    id: `room-${roomNumber}`,
    room_number: roomNumber,
    hotel: 'Hotel Memories Budapest',
    floor_number: options.floor ?? Number(roomNumber[0] || 0),
    room_size_sqm: 20,
    room_capacity: 2,
    is_checkout_room: options.checkout ?? false,
    pms_metadata: options.checkout ? { scheduledDepartureToday: true } : {},
    status: 'dirty',
    housekeeping_section_id: sectionId,
    housekeeping_section_name: sectionId,
  };
}

const staff: StaffForAssignment[] = Array.from({ length: 6 }, (_, index) => ({
  id: `staff-${index + 1}`,
  full_name: `Housekeeper ${index + 1}`,
  nickname: null,
}));

describe('Hotel Memories mapped-section auto assignment', () => {
  it('keeps mapped sections coherent and gives one cleaner most rooms in a split section', () => {
    const rooms: RoomForAssignment[] = [
      ...Array.from({ length: 12 }, (_, index) => makeRoom(String(index * 2 + 2).padStart(3, '0'), 'ground')),
      ...Array.from({ length: 21 }, (_, index) => makeRoom(String(101 + index), '100-side', { checkout: index < 7, floor: 1 })),
      ...Array.from({ length: 9 }, (_, index) => makeRoom(String(202 + index * 2), '202-308-middle', { checkout: index < 2, floor: index > 4 ? 3 : 2 })),
      ...Array.from({ length: 17 }, (_, index) => makeRoom(String(130 + index), '130-140-side', { checkout: index < 5, floor: 1 })),
      ...Array.from({ length: 12 }, (_, index) => makeRoom(String(201 + index), '200-side', { checkout: index < 4, floor: 2 })),
    ];

    const previews = autoAssignRooms(rooms, staff, undefined, undefined, {
      hotelName: 'Hotel Memories Budapest',
      randomSeed: 20260908,
    });

    const sectionIds = ['ground', '100-side', '202-308-middle', '130-140-side', '200-side'];
    for (const sectionId of sectionIds) {
      const sectionRooms = rooms.filter(room => room.housekeeping_section_id === sectionId);
      const counts = previews
        .map(preview => preview.rooms.filter(room => room.housekeeping_section_id === sectionId).length)
        .filter(count => count > 0)
        .sort((a, b) => b - a);

      expect(counts.length).toBeLessThanOrEqual(2);
      expect(counts[0]).toBeGreaterThanOrEqual(Math.ceil(sectionRooms.length * (counts.length === 1 ? 1 : 0.56)));
    }

    expect(previews.filter(preview => preview.rooms.length > 0)).toHaveLength(6);
  });

  it('honors the configured section even when room numbers look like different floors', () => {
    const mappedRooms = [
      makeRoom('202', 'middle', { floor: 2 }),
      makeRoom('204', 'middle', { floor: 2 }),
      makeRoom('302', 'middle', { floor: 3 }),
      makeRoom('304', 'middle', { floor: 3 }),
      makeRoom('201', '200-side', { floor: 2 }),
      makeRoom('203', '200-side', { floor: 2 }),
      makeRoom('205', '200-side', { floor: 2 }),
      makeRoom('207', '200-side', { floor: 2 }),
    ];
    const twoStaff = staff.slice(0, 2);

    const previews = autoAssignRooms(mappedRooms, twoStaff, undefined, undefined, {
      hotelName: 'Hotel Memories Budapest',
      randomSeed: 77,
    });

    for (const sectionId of ['middle', '200-side']) {
      const owners = previews.filter(preview =>
        preview.rooms.some(room => room.housekeeping_section_id === sectionId)
      );
      expect(owners).toHaveLength(1);
      expect(owners[0].rooms.filter(room => room.housekeeping_section_id === sectionId)).toHaveLength(4);
    }
  });

  it('assigns mapped public-area work to the cleaner who owns the most rooms in that section', () => {
    const rooms = Array.from({ length: 21 }, (_, index) =>
      makeRoom(String(101 + index), '100-side', { checkout: index < 8, floor: 1 })
    );
    const previews = autoAssignRooms(rooms, staff.slice(0, 2), undefined, undefined, {
      hotelName: 'Hotel Memories Budapest',
      randomSeed: 901,
    });

    const roomOwner = [...previews].sort((a, b) =>
      b.rooms.filter(room => room.housekeeping_section_id === '100-side').length
      - a.rooms.filter(room => room.housekeeping_section_id === '100-side').length
    )[0];

    const tasks = assignSectionTasksToStaff(previews, [{
      id: 'task-100-lobby',
      section_id: '100-side',
      section_name: '100 Side',
      floor_number: 1,
      task_name: 'Lobby',
      icon: '🏨',
      estimated_duration: 10,
      auto_assign: true,
      is_active: true,
      sort_order: 1,
    }]);

    expect(tasks).toHaveLength(1);
    expect(tasks[0].staff_id).toBe(roomOwner.staffId);
  });

  it('keeps the generic allocator unchanged for other hotels', () => {
    const rooms = [
      makeRoom('101', 'section-a'),
      makeRoom('102', 'section-a'),
      makeRoom('201', 'section-b'),
      makeRoom('202', 'section-b'),
    ].map(room => ({ ...room, hotel: 'Another Hotel' }));

    const previews = autoAssignRooms(rooms, staff.slice(0, 2), undefined, undefined, {
      hotelName: 'Another Hotel',
      randomSeed: 1,
    });

    expect(previews.flatMap(preview => preview.rooms)).toHaveLength(4);
  });
});
