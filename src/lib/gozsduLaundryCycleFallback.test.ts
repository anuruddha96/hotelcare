import { describe, expect, it } from 'vitest';
import { groupCurrentLaundryRooms, laundryBucket, laundryService, type LaundryAssignment } from './gozsduLaundryReadiness';
import type { LaundryRoom } from './gozsduLaundryner';

const date = '2026-09-19';
const room = (number: string, metadata: Record<string, unknown>, other: Partial<LaundryRoom> = {}): LaundryRoom => ({
  id: number, hotel: 'Gozsdu Court Budapest', room_number: number,
  status: 'dirty', is_checkout_room: false, is_dnd: false,
  pms_metadata: { gozsduAvailability: { status: 'operating' }, ...metadata }, ...other,
});
const cleaning = (number: string): LaundryAssignment => ({
  id: `assignment-${number}`, room_id: number, assigned_to: 'ruby-116',
  assignment_type: 'daily_cleaning', status: 'in_progress', ready_to_clean: true,
  is_dnd: false, pms_hold: false,
});

 describe('Gozsdu Laundryner second-day cycle fallback', () => {
  it('places an in-progress 2B-1/T/2 second-day room with Ruby into Second-day, not Other, when the optional snapshot is absent', () => {
    const due = room('2B-1/T/2', { currentNight: 3, totalNights: 7 });
    const other = room('other-room', { currentNight: 2, totalNights: 7 });
    const grouped = groupCurrentLaundryRooms([other, due], [cleaning(due.id)], date);
    expect(grouped.second_day.map(value => value.room_number)).toEqual(['2B-1/T/2']);
    expect(grouped.other.map(value => value.room_number)).toEqual(['other-room']);
    expect(laundryService(due, [cleaning(due.id)], date)).toBe('towel');
  });

  it('reuses the actual Gozsdu 3/N, 5/N, 7/N service policy for missing snapshots', () => {
    for (const [night, total, expected] of [
      [3, 7, 'towel'], [5, 7, 'textile'], [5, 6, 'towel'], [7, 11, 'towel'],
    ] as const) {
      const candidate = room(String(night), { currentNight: night, totalNights: total });
      expect(laundryBucket(candidate, [], date)).toBe('second_day');
      expect(laundryService(candidate, [], date)).toBe(expected);
    }
    for (const [night, total] of [[1, 7], [2, 7], [4, 7], [0, 7], [3, 2]]) {
      const candidate = room(String(night), { currentNight: night, totalNights: total });
      expect(laundryBucket(candidate, [], date)).toBe('other');
    }
  });

  it('never invents a service from an active cleaner, incomplete PMS nights or a non-Gozsdu room', () => {
    const unknown = room('unknown', { currentNight: 3 });
    expect(laundryBucket(unknown, [cleaning(unknown.id)], date)).toBe('other');
    expect(laundryService(unknown, [cleaning(unknown.id)], date)).toBe('daily');
    const mika = room('mika', { currentNight: 3, totalNights: 7 }, { hotel: 'Hotel Mika Downtown' });
    expect(groupCurrentLaundryRooms([mika], [], date).second_day).toHaveLength(0);
    expect(groupCurrentLaundryRooms([mika], [], date).other).toHaveLength(0);
  });

  it('respects explicit no-service snapshot and manager Other override above computed PMS cycle', () => {
    const base = { currentNight: 3, totalNights: 7 };
    const noService = room('plan', { ...base, gozsduHousekeeping: { serviceDue: false, serviceType: 'none' } });
    expect(laundryBucket(noService, [cleaning(noService.id)], date)).toBe('other');
    expect(laundryService(noService, [cleaning(noService.id)], date)).toBe('daily');
    const moved = room('manual', { ...base,
      hotelcareHousekeepingOverrides: { [date]: { date, bucket: 'other', service: 'none',
        reason: 'manager', changedAt: '2026-09-19T08:00:00Z', changedBy: 'manager' } },
    });
    expect(laundryBucket(moved, [], date)).toBe('other');
    expect(laundryService(moved, [], date)).toBe('none');
    expect(laundryBucket(moved, [], '2026-09-20')).toBe('second_day');
  });

  it('honours a manager second-day override above no-service plan and keeps active cleaners at the top within each group', () => {
    const override = { date, bucket: 'service', service: 'change_room',
      reason: 'manager', changedAt: '2026-09-19T08:00:00Z', changedBy: 'manager' };
    const explicit = room('explicit', { currentNight: 2, totalNights: 7,
      gozsduHousekeeping: { serviceDue: false, serviceType: 'none' },
      hotelcareHousekeepingOverrides: { [date]: override } });
    const due = room('2B-1/T/2', { currentNight: 3, totalNights: 7 });
    const grouped = groupCurrentLaundryRooms([explicit, due], [cleaning(due.id)], date);
    expect(grouped.second_day.map(value => value.id)).toEqual(['2B-1/T/2', 'explicit']);
    expect(laundryService(explicit, [], date)).toBe('textile');
    expect(grouped.other).toHaveLength(0);
  });
});
