import { describe, expect, it } from 'vitest';
import { approvedEarlyCheckoutForLinen, groupCurrentLaundryRooms, laundryAccess, laundryService, type LaundryAssignment } from './gozsduLaundryReadiness';
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
const approvedEarlyCheckout = (extra: Partial<LaundryAssignment> = {}): LaundryAssignment => assignment({
  assignment_type: 'daily_cleaning', status: 'completed', supervisor_approved: true,
  ready_to_clean: true, pms_hold: true,
  pms_hold_reason: 'Guest checked out — assignment type may need to change',
  pms_hold_event_id: 'linked-pms-event', ...extra,
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
    expect(laundryAccess(room(), [completed], date)).toBe('ready');
    expect(laundryAccess(cleanApproved, [assignment({ status: 'completed', ready_to_clean: false })], date)).toBe('guest_inside');
    expect(laundryAccess(cleanApproved, [assignment({ status: 'completed', pms_hold: true })], date)).toBe('guest_inside');
    expect(laundryAccess(cleanApproved, [completed, assignment({ id: 'other-type', assignment_type: 'daily_cleaning' })], date)).toBe('guest_inside');
  });

  it('handles room 410: verified departure, cleaned and approved, daily assignment with linked automatic checkout conflict', () => {
    const cleaned = room({ room_number: '410', status: 'clean' });
    const early = approvedEarlyCheckout();
    expect(approvedEarlyCheckoutForLinen(cleaned, [early])).toBe(true);
    expect(laundryAccess(cleaned, [early], date)).toBe('ready');
    expect(laundryAccess(cleaned, [approvedEarlyCheckout({ pms_hold_reason: 'manager manual hold' })], date)).toBe('guest_inside');
    expect(laundryAccess(cleaned, [approvedEarlyCheckout({ pms_hold_event_id: null })], date)).toBe('guest_inside');
    expect(laundryAccess(cleaned, [approvedEarlyCheckout({ supervisor_approved: false })], date)).toBe('guest_inside');
    expect(laundryAccess(cleaned, [approvedEarlyCheckout({ status: 'in_progress' })], date)).toBe('guest_inside');
    expect(laundryAccess(cleaned, [approvedEarlyCheckout({ ready_to_clean: false })], date)).toBe('guest_inside');
    expect(laundryAccess(cleaned, [approvedEarlyCheckout({ is_dnd: true })], date)).toBe('dnd');
    expect(laundryAccess(cleaned, [early, assignment({ id: 'conflicting-live' })], date)).toBe('guest_inside');
    expect(laundryAccess(room(), [early], date)).toBe('guest_inside');
  });

  it('handles room 4005: an RTC assignment and active cleaner alone never override absent PMS departure', () => {
    const mismatched = room({ room_number: '4005', pms_metadata: {
      ...room().pms_metadata, scheduledDepartureToday: true,
      checkedOutToday: false, readyToClean: null, occupiedToday: false,
    } });
    const cleaning = assignment({ status: 'in_progress', ready_to_clean: true });
    expect(laundryAccess(mismatched, [cleaning], date)).toBe('guest_inside');
    expect(laundryAccess(room({ ...mismatched, pms_metadata: {
      ...mismatched.pms_metadata, checkedOutToday: true, readyToClean: true,
    } }), [cleaning], date)).toBe('ready');
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
