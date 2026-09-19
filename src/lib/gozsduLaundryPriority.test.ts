import { describe, expect, it } from 'vitest';
import { activeCleaningHousekeeperIds, groupCurrentLaundryRooms, laundryBucket, type LaundryAssignment } from './gozsduLaundryReadiness';
import type { LaundryRoom } from './gozsduLaundryner';
import { gozsduLaundryActiveCopy } from './gozsduLaundryActiveI18n';

const date = '2026-09-19';
const room = (number: string, overrides: Partial<LaundryRoom> = {}): LaundryRoom => ({
  id: number, room_number: number, hotel: 'Gozsdu Court Budapest',
  status: 'dirty', is_checkout_room: false, is_dnd: false,
  pms_metadata: { gozsduAvailability: { status: 'operating' },
    gozsduHousekeeping: { serviceDue: false, serviceType: 'none' } },
  ...overrides,
});
const assignment = (roomId: string, overrides: Partial<LaundryAssignment> = {}): LaundryAssignment => ({
  id: `a-${roomId}`, room_id: roomId, assigned_to: 'hk-1', assignment_type: 'daily_cleaning',
  status: 'assigned', ready_to_clean: true, is_dnd: false, pms_hold: false,
  ...overrides,
});

 describe('Gozsdu laundry: active cleaning priority without mixing room categories', () => {
  it('recognizes only genuinely in-progress housekeeping with a named assignee', () => {
    const rows = [assignment('1'), assignment('1', { id: 'live', status: 'in_progress', assigned_to: 'hk-2' }),
      assignment('1', { id: 'maintenance', status: 'in_progress', assignment_type: 'maintenance', assigned_to: 'm-1' }),
      assignment('1', { id: 'unknown', status: 'in_progress', assigned_to: null }),
      assignment('1', { id: 'completed', status: 'completed', assigned_to: 'hk-3' })];
    expect(activeCleaningHousekeeperIds(rows)).toEqual(['hk-2']);
  });

  it('keeps second-day stayovers separate and sorts active housekeeper rooms first INSIDE each list', () => {
    const due = { gozsduAvailability: { status: 'operating' }, gozsduHousekeeping: { serviceDue: true, serviceType: 'towel_change' } };
    const rooms = [room('101', { is_checkout_room: true }), room('102', { is_checkout_room: true }),
      room('201', { pms_metadata: due }), room('202', { pms_metadata: due }), room('301'), room('302')];
    const rows = [assignment('101'), assignment('102', { status: 'in_progress' }),
      assignment('201'), assignment('202', { status: 'in_progress' }),
      assignment('301'), assignment('302', { status: 'in_progress' })];
    const grouped = groupCurrentLaundryRooms(rooms, rows, date);
    expect(grouped.checkout.map(value => value.id)).toEqual(['102', '101']);
    expect(grouped.second_day.map(value => value.id)).toEqual(['202', '201']);
    expect(grouped.other.map(value => value.id)).toEqual(['302', '301']);
    expect(new Set(Object.values(grouped).flat().map(value => value.id)).size).toBe(6);
  });

  it('honours date-specific manager service and other overrides before stale PMS cycle', () => {
    const meta = { gozsduAvailability: { status: 'operating' }, gozsduHousekeeping: { serviceDue: true, serviceType: 'change_room' },
      hotelcareHousekeepingOverrides: { [date]: { date, bucket: 'other', service: 'none',
        reason: 'manager', changedAt: '2026-09-19T07:00:00Z', changedBy: 'manager' } } };
    expect(laundryBucket(room('A', { pms_metadata: meta }), [], date)).toBe('other');
    expect(laundryBucket(room('A', { pms_metadata: meta }), [], '2026-09-20')).toBe('second_day');
    const manuallyDue = { ...meta, hotelcareHousekeepingOverrides: { [date]: { ...meta.hotelcareHousekeepingOverrides[date], bucket: 'service', service: 'towel_change' } },
      gozsduHousekeeping: { serviceDue: false, serviceType: 'none' } };
    expect(laundryBucket(room('B', { pms_metadata: manuallyDue }), [], date)).toBe('second_day');
  });

  it('does not treat an ordinary daily assignment or even-numbered night as second-day service', () => {
    const noService = room('22', { pms_metadata: { gozsduAvailability: { status: 'operating' }, currentNight: 4,
      gozsduHousekeeping: { serviceDue: false, serviceType: 'none' } } });
    expect(laundryBucket(noService, [assignment('22', { status: 'in_progress' })], date)).toBe('other');
    expect(laundryBucket(room('23', { pms_metadata: { gozsduAvailability: { status: 'operating' }, currentNight: 4 } }), [], date)).toBe('other');
    const groups = groupCurrentLaundryRooms([room('mika', { hotel: 'Hotel Mika Downtown' }), noService], [], date);
    expect(groups.other.map(value => value.id)).toEqual(['22']);
  });

  it('provides cleaning badges and distinct-list copy across all existing languages', () => {
    for (const lang of ['en', 'hu', 'es', 'vi', 'mn', 'az', 'tl', 'uk', 'ru']) {
      expect(gozsduLaundryActiveCopy(lang).cleaningNow.length).toBeGreaterThan(0);
      expect(gozsduLaundryActiveCopy(lang).separateQueues.length).toBeGreaterThan(0);
    }
  });
});
