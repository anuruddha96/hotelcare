import { describe, expect, it } from 'vitest';
import { groupCurrentLaundryRooms, laundryAccess, laundryService, type LaundryAssignment } from './gozsduLaundryReadiness';
import type { LaundryRoom } from './gozsduLaundryner';

const date = '2026-09-19';
const room = (extra: Partial<LaundryRoom> = {}): LaundryRoom => ({
  id: 'room-1', hotel: 'Gozsdu Court Budapest', room_number: '101', status: 'dirty',
  is_checkout_room: true, is_dnd: false,
  pms_metadata: { gozsduAvailability: { status: 'operating' }, lastPmsRefreshDate: date,
    checkedOutToday: true, readyToClean: true, scheduledDepartureToday: true }, ...extra,
});
const assignment = (extra: Partial<LaundryAssignment> = {}): LaundryAssignment => ({
  id: 'assignment-1', room_id: 'room-1', assigned_to: 'staff-1', assignment_type: 'checkout_cleaning',
  status: 'assigned', ready_to_clean: true, is_dnd: false, pms_hold: false, ...extra,
});

describe('Gozsdu laundry room access', () => {
  it('requires confirmed same-day checkout and a released checkout assignment', () => {
    expect(laundryAccess(room(), [assignment()], date)).toBe('ready');
    expect(laundryAccess(room({ pms_metadata: { ...room().pms_metadata, checkedOutToday: false } }), [assignment()], date)).toBe('guest_inside');
    expect(laundryAccess(room({ pms_metadata: { ...room().pms_metadata, lastPmsRefreshDate: '2026-09-18' } }), [assignment()], date)).toBe('guest_inside');
    expect(laundryAccess(room({ pms_metadata: { ...room().pms_metadata, readyToClean: false } }), [assignment()], date)).toBe('guest_inside');
    expect(laundryAccess(room({ pms_metadata: { ...room().pms_metadata, readyToCleanDate: '2026-09-18' } }), [assignment()], date)).toBe('guest_inside');
    expect(laundryAccess(room(), [assignment({ ready_to_clean: false })], date)).toBe('guest_inside');
    expect(laundryAccess(room(), [assignment({ pms_hold: true })], date)).toBe('guest_inside');
    expect(laundryAccess(room(), [], date)).toBe('guest_inside');
    expect(laundryAccess(room(), [assignment(), assignment({ id: 'other', ready_to_clean: false })], date)).toBe('guest_inside');
  });

  it('permits recording after housekeeping completion and supervisor approval without reopening cleaning', () => {
    const cleanApproved = room({ status: 'clean' });
    const completed = assignment({ status: 'completed' });
    expect(laundryAccess(cleanApproved, [completed], date)).toBe('ready');
    expect(laundryAccess(cleanApproved, [completed, assignment({ id: 'old-cancelled', status: 'cancelled' })], date)).toBe('ready');
    expect(laundryAccess(room(), [completed], date)).toBe('ready'); // Cleaning may be completed before supervisor approval.
    expect(laundryAccess(cleanApproved, [assignment({ status: 'completed', ready_to_clean: false })], date)).toBe('guest_inside');
    expect(laundryAccess(cleanApproved, [assignment({ status: 'completed', pms_hold: true })], date)).toBe('guest_inside');
    expect(laundryAccess(cleanApproved, [completed, assignment({ id: 'other-type', assignment_type: 'daily_cleaning' })], date)).toBe('guest_inside');
  });

  it('never substitutes cleaning approval for actual departure or an active release', () => {
    const completed = assignment({ status: 'completed' });
    expect(laundryAccess(room({ status: 'clean', pms_metadata: { ...room().pms_metadata, checkedOutToday: false } }), [completed], date)).toBe('guest_inside');
    expect(laundryAccess(room({ status: 'clean', pms_metadata: { ...room().pms_metadata, readyToClean: false } }), [completed], date)).toBe('guest_inside');
    expect(laundryAccess(room({ status: 'clean', pms_metadata: { ...room().pms_metadata, lastPmsRefreshDate: '2026-09-18' } }), [completed], date)).toBe('guest_inside');
    expect(laundryAccess(room({ status: 'clean' }), [], date)).toBe('guest_inside');
  });

  it('never permits DND, other properties or non-operating rooms', () => {
    expect(laundryAccess(room({ is_dnd: true }), [assignment()], date)).toBe('dnd');
    expect(laundryAccess(room(), [assignment({ is_dnd: true })], date)).toBe('dnd');
    expect(laundryAccess(room({ hotel: 'Hotel Mika Downtown' }), [assignment()], date)).toBe('unavailable');
    expect(laundryAccess(room({ status: 'out_of_order' }), [assignment()], date)).toBe('unavailable');
  });

  it('does not claim guest consent for an occupied stayover', () => {
    expect(laundryAccess(room({ is_checkout_room: false,
      pms_metadata: { gozsduAvailability: { status: 'operating' }, scheduledDepartureToday: false } }), [], date)).toBe('guest_permission');
  });
});

describe('Service information mirrors Gozsdu metadata', () => {
  it('respects checkout, towel change, textile change and validated manual overrides for today', () => {
    expect(laundryService(room(), [assignment()], date)).toBe('full');
    const stayover = room({ is_checkout_room: false,
      pms_metadata: { gozsduAvailability: { status: 'operating' }, scheduledDepartureToday: false,
        gozsduHousekeeping: { serviceType: 'change_room', serviceDue: true } } });
    expect(laundryService(stayover, [], date)).toBe('textile');
    const override = { date, service: 'towel_change', bucket: 'service',
      reason: 'manager requested towel change', changedAt: '2026-09-19T07:00:00Z', changedBy: 'manager' };
    const overridden = { ...stayover, pms_metadata: { ...stayover.pms_metadata,
      hotelcareHousekeepingOverrides: { [date]: override } } };
    expect(laundryService(overridden, [], date)).toBe('towel');
    expect(groupCurrentLaundryRooms([overridden], [], date).second_day).toHaveLength(1);
    expect(laundryService(overridden, [], '2026-09-20')).toBe('textile');
  });

  it('does not reclassify no-service odd or even nights as due when overview says none', () => {
    const noService = room({ is_checkout_room: false,
      pms_metadata: { gozsduAvailability: { status: 'operating' }, currentNight: 4,
        scheduledDepartureToday: false, gozsduHousekeeping: { serviceType: 'none', serviceDue: false } } });
    expect(groupCurrentLaundryRooms([noService], [], date).other).toHaveLength(1);
  });
});
