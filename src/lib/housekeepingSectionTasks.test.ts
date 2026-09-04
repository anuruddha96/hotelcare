import { describe, expect, it } from 'vitest';
import type { AssignmentPreview, RoomForAssignment } from './roomAssignmentAlgorithm';
import {
  assignSectionTasksToStaff,
  sectionTaskMinutesForStaff,
  type HousekeepingSectionTaskTemplate,
} from './housekeepingSectionTasks';

const room = (id: string, sectionId: string, size = 20): RoomForAssignment => ({
  id,
  room_number: id,
  hotel: 'Hotel Memories Budapest',
  floor_number: 1,
  room_size_sqm: size,
  room_capacity: 2,
  is_checkout_room: true,
  status: 'dirty',
  housekeeping_section_id: sectionId,
  housekeeping_section_name: sectionId,
});

const preview = (staffId: string, rooms: RoomForAssignment[], minutes: number): AssignmentPreview => ({
  staffId,
  staffName: staffId.toUpperCase(),
  rooms,
  totalWeight: 0,
  checkoutCount: rooms.length,
  dailyCount: 0,
  estimatedMinutes: minutes,
  totalWithBreak: minutes + 30,
  exceedsShift: false,
  overageMinutes: 0,
});

const task = (
  id: string,
  sectionId: string,
  overrides: Partial<HousekeepingSectionTaskTemplate> = {},
): HousekeepingSectionTaskTemplate => ({
  id,
  section_id: sectionId,
  section_name: sectionId,
  floor_number: 1,
  task_name: id,
  icon: '🧹',
  estimated_duration: 15,
  auto_assign: true,
  is_active: true,
  sort_order: 0,
  ...overrides,
});

describe('assignSectionTasksToStaff', () => {
  it('assigns all area work to the dominant room owner in that section', () => {
    const result = assignSectionTasksToStaff(
      [
        preview('anu', [room('101', 'middle'), room('102', 'middle', 40)], 105),
        preview('bea', [room('103', 'middle')], 45),
      ],
      [task('sauna', 'middle'), task('gym', 'middle')],
    );

    expect(result.map(item => item.staff_id)).toEqual(['anu', 'anu']);
    expect(sectionTaskMinutesForStaff(result, 'anu')).toBe(30);
  });

  it('uses the least-loaded selected cleaner when a section has no dirty room', () => {
    const result = assignSectionTasksToStaff(
      [preview('anu', [], 180), preview('bea', [], 60)],
      [task('staircase', '300-side')],
    );

    expect(result[0].staff_id).toBe('bea');
  });

  it('balances multiple roomless sections using their area minutes', () => {
    const result = assignSectionTasksToStaff(
      [preview('anu', [], 60), preview('bea', [], 60)],
      [
        task('ground-storage', 'ground', { estimated_duration: 45 }),
        task('upper-stairs', 'upper', { estimated_duration: 45 }),
      ],
    );

    expect(new Set(result.map(item => item.staff_id))).toEqual(new Set(['anu', 'bea']));
  });

  it('ignores disabled and manually assigned templates', () => {
    const result = assignSectionTasksToStaff(
      [preview('anu', [room('112', 'middle')], 45)],
      [
        task('active', 'middle'),
        task('inactive', 'middle', { is_active: false }),
        task('manual', 'middle', { auto_assign: false }),
      ],
    );

    expect(result.map(item => item.id)).toEqual(['active']);
  });
});
