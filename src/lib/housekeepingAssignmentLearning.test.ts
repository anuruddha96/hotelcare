import { describe, expect, it } from 'vitest';
import {
  EMPTY_HOUSEKEEPING_ASSIGNMENT_SIGNALS,
  generateLearnedHousekeepingPreview,
  sanitizeStaffPreferences,
} from './housekeepingAssignmentLearning';
import type { RoomForAssignment, StaffForAssignment } from './roomAssignmentAlgorithm';

const staff: StaffForAssignment[] = [
  { id: 'staff-a', full_name: 'A', nickname: null },
  { id: 'staff-b', full_name: 'B', nickname: null },
];

function room(overrides: Partial<RoomForAssignment> = {}): RoomForAssignment {
  return {
    id: 'room-101',
    room_number: '101',
    hotel: 'Test Hotel',
    floor_number: 1,
    room_size_sqm: 20,
    room_capacity: 2,
    is_checkout_room: false,
    status: 'dirty',
    ...overrides,
  };
}

describe('housekeeping assignment learning', () => {
  it('sanitizes learned staff preferences without trusting malformed profile data', () => {
    const result = sanitizeStaffPreferences({
      'staff-a': ['1', '1', ' section-zone ', null, 5, '', ...Array.from({ length: 20 }, (_, i) => `x-${i}`)],
      'staff-b': 'not-an-array',
    });

    expect(result['staff-a']).toEqual([
      '1', 'section-zone', 'x-0', 'x-1', 'x-2', 'x-3', 'x-4', 'x-5', 'x-6', 'x-7',
    ]);
    expect(result['staff-b']).toBeUndefined();
  });

  it('uses an explicit learned section preference as a soft assignment signal', () => {
    const target = room({
      housekeeping_section_id: 'section-id',
      housekeeping_section_name: '100 side',
    });
    const previews = generateLearnedHousekeepingPreview(
      [target],
      staff,
      'Test Hotel',
      {
        ...EMPTY_HOUSEKEEPING_ASSIGNMENT_SIGNALS,
        staffPreferences: { 'staff-b': ['section-section-id'] },
        learningConfidence: 0.7,
        correctionCount: 6,
        sampleCount: 20,
        modelVersion: 'manager-correction-v1',
      },
    );

    expect(previews.find(preview => preview.staffId === 'staff-b')?.rooms.map(item => item.id)).toContain(target.id);
    expect(previews.flatMap(preview => preview.rooms)).toHaveLength(1);
  });

  it('keeps every room assigned once when no learned evidence exists', () => {
    const rooms = [
      room({ id: '101', room_number: '101' }),
      room({ id: '102', room_number: '102', is_checkout_room: true }),
      room({ id: '201', room_number: '201', floor_number: 2 }),
      room({ id: '202', room_number: '202', floor_number: 2, is_checkout_room: true }),
    ];

    const previews = generateLearnedHousekeepingPreview(
      rooms,
      staff,
      'Test Hotel',
      EMPTY_HOUSEKEEPING_ASSIGNMENT_SIGNALS,
    );
    const assignedIds = previews.flatMap(preview => preview.rooms.map(item => item.id));

    expect(assignedIds).toHaveLength(rooms.length);
    expect(new Set(assignedIds)).toEqual(new Set(rooms.map(item => item.id)));
  });
});
