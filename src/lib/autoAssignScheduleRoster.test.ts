import { describe, expect, it } from 'vitest';
import {
  autoAssignScheduleAppliesToHotel,
  filterAutoAssignScheduleRowsForHotel,
  getAutoAssignWorkStatus,
  resolveAutoAssignHotelRosterScope,
  resolveAutoAssignStaffDefaults,
  scheduleDurationMinutes,
  type AutoAssignScheduleRow,
} from './autoAssignScheduleRoster';

const eligible = new Set(['a', 'b', 'c', 'd', 'e']);

function row(overrides: Partial<AutoAssignScheduleRow> = {}): AutoAssignScheduleRow {
  return {
    id: 'schedule-1',
    hotel_id: 'hotel-a',
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

  it('keeps a published roster authoritative even when its working person is outside the eligible hotel staff pool', () => {
    const result = resolveAutoAssignStaffDefaults([
      row({ user_id: 'other-hotel-user' }),
    ], ['a'], eligible);

    expect(result.source).toBe('published_schedule');
    expect(result.hasPublishedRoster).toBe(true);
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

  it('matches a local base-hotel schedule to that hotel when no working venue is specified', () => {
    expect(autoAssignScheduleAppliesToHotel(
      row({ hotel_id: 'hotel-a', staff_schedule_venues: [] }),
      new Set(['hotel-a']),
      new Map(),
    )).toBe(true);
  });

  it('matches a borrowed employee when HR schedules them at a venue belonging to the current hotel', () => {
    expect(autoAssignScheduleAppliesToHotel(
      row({ hotel_id: 'hotel-a', user_id: 'borrowed', staff_schedule_venues: [{ venue_id: 'venue-b' }] }),
      new Set(['hotel-b']),
      new Map([['venue-b', 'hotel-b']]),
    )).toBe(true);
  });

  it('does not also expose a borrowed employee at the base hotel when an explicit working venue exists', () => {
    expect(autoAssignScheduleAppliesToHotel(
      row({ hotel_id: 'hotel-a', user_id: 'borrowed', staff_schedule_venues: [{ venue_id: 'venue-b' }] }),
      new Set(['hotel-a']),
      new Map([['venue-b', 'hotel-b']]),
    )).toBe(false);
  });

  it('does not leak a schedule into an unrelated property', () => {
    expect(autoAssignScheduleAppliesToHotel(
      row({ hotel_id: 'hotel-a', staff_schedule_venues: [{ venue_id: 'venue-b' }] }),
      new Set(['hotel-c']),
      new Map([['venue-b', 'hotel-b']]),
    )).toBe(false);
  });

  it('filters a mixed organization roster to local and explicitly borrowed staff only', () => {
    const rows = [
      row({ id: 'local', hotel_id: 'hotel-b', user_id: 'local' }),
      row({ id: 'borrowed', hotel_id: 'hotel-a', user_id: 'borrowed', staff_schedule_venues: [{ venue_id: 'venue-b' }] }),
      row({ id: 'other', hotel_id: 'hotel-a', user_id: 'other', staff_schedule_venues: [{ venue_id: 'venue-c' }] }),
    ];

    const result = filterAutoAssignScheduleRowsForHotel(
      rows,
      new Set(['hotel-b']),
      new Map([
        ['venue-b', 'hotel-b'],
        ['venue-c', 'hotel-c'],
      ]),
    );

    expect(result.map(item => item.id)).toEqual(['local', 'borrowed']);
  });

  it('keeps the home roster authoritative while excluding a published transfer and admitting the destination worker', () => {
    const rows = [
      row({ id: 'moved-away', hotel_id: 'hotel-a', user_id: 'a', staff_schedule_venues: [{ venue_id: 'venue-b' }] }),
      row({ id: 'incoming', hotel_id: 'hotel-c', user_id: 'borrowed', staff_schedule_venues: [{ venue_id: 'venue-a' }] }),
    ];
    const venues = new Map([
      ['venue-a', 'hotel-a'],
      ['venue-b', 'hotel-b'],
    ]);

    const home = resolveAutoAssignHotelRosterScope(rows, new Set(['hotel-a']), venues, new Set(['a']));
    expect([...home.excludedLocalStaffIds]).toEqual(['a']);
    expect([...home.incomingStaffIds]).toEqual(['borrowed']);
    expect(home.scheduleRows.map(item => item.id)).toEqual(['moved-away', 'incoming']);

    const defaults = resolveAutoAssignStaffDefaults(home.scheduleRows, ['a'], new Set(['borrowed']));
    expect(defaults.hasPublishedRoster).toBe(true);
    expect([...defaults.selectedStaffIds]).toEqual(['borrowed']);
  });

  it('does not let a draft cross-property assignment change the active staff pool', () => {
    const draftTransfer = row({
      id: 'draft-transfer',
      hotel_id: 'hotel-a',
      user_id: 'a',
      status: 'draft',
      published_at: null,
      staff_schedule_venues: [{ venue_id: 'venue-b' }],
    });
    const scope = resolveAutoAssignHotelRosterScope(
      [draftTransfer],
      new Set(['hotel-a']),
      new Map([['venue-b', 'hotel-b']]),
      new Set(['a']),
    );

    expect(scope.excludedLocalStaffIds.size).toBe(0);
    expect(scope.incomingStaffIds.size).toBe(0);
    expect(scope.scheduleRows).toEqual([]);
  });
});
