import { describe, expect, it } from 'vitest';
import {
  getAutoAssignWorkStatus,
  resolveAutoAssignStaffDefaults,
  scheduleDurationMinutes,
  type AutoAssignScheduleRow,
} from './autoAssignScheduleRoster';

const eligible = new Set(['a', 'b', 'c', 'd', 'e']);

function row(overrides: Partial<AutoAssignScheduleRow> = {}): AutoAssignScheduleRow {
  return {
    id: 'schedule-1',
    user_id: 'a',
    work_date: '2026-09-30',
    shift_start: '09:00',
    shift_end: '17:00',
    status: 'published',
    work_status: 'working',
    ...overrides,
  };
}

describe('Auto Assign published staff schedule bridge', () => {
  it('uses published working staff before checked-in attendance', () => {
    const result = resolveAutoAssignStaffDefaults([
      row({ user_id: 'a' }),
      row({ user_id: 'b', work_status: 'off', shift_start: null, shift_end: null }),
      row({ user_id: 'c', work_status: 'leave', shift_start: null, shift_end: null }),
      row({ user_id: 'd', work_status: 'sick', shift_start: null, shift_end: null }),
      row({ user_id: 'e', work_status: 'training' }),
    ], ['b', 'c', 'd'], eligible);

    expect(result.source).toBe('published_schedule');
    expect(result.hasPublishedRoster).toBe(true);
    expect([...result.selectedStaffIds]).toEqual(['a']);
  });

  it('does not silently fall back to attendance when the published roster has zero cleaners', () => {
    const result = resolveAutoAssignStaffDefaults([
      row({ user_id: 'a', work_status: 'off', shift_start: null, shift_end: null }),
      row({ user_id: 'b', work_status: 'leave', shift_start: null, shift_end: null }),
    ], ['c'], eligible);

    expect(result.source).toBe('published_schedule');
    expect(result.selectedStaffIds.size).toBe(0);
  });

  it('falls back to checked-in attendance only when no published roster exists', () => {
    const result = resolveAutoAssignStaffDefaults([
      row({ user_id: 'a', status: 'draft' }),
    ], ['b', 'c', 'unknown'], eligible);

    expect(result.source).toBe('attendance_fallback');
    expect([...result.selectedStaffIds]).toEqual(['b', 'c']);
  });

  it('supports legacy pre-migration published and off rows', () => {
    const legacyWorking = row({ user_id: 'a', work_status: undefined, status: 'published' });
    const legacyOff = row({ user_id: 'b', work_status: undefined, status: 'off', shift_start: null, shift_end: null });
    const result = resolveAutoAssignStaffDefaults([legacyWorking, legacyOff], ['c'], eligible);

    expect(getAutoAssignWorkStatus(legacyWorking)).toBe('working');
    expect(getAutoAssignWorkStatus(legacyOff)).toBe('off');
    expect(result.source).toBe('published_schedule');
    expect([...result.selectedStaffIds]).toEqual(['a']);
  });

  it('uses published shift length and handles overnight schedules', () => {
    expect(scheduleDurationMinutes(row({ shift_start: '09:00', shift_end: '17:30' }))).toBe(510);
    expect(scheduleDurationMinutes(row({ shift_start: '22:00', shift_end: '06:00' }))).toBe(480);
    expect(scheduleDurationMinutes(row({ status: 'draft' }))).toBeNull();
    expect(scheduleDurationMinutes(row({ work_status: 'training' }))).toBeNull();
  });
});
