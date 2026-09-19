import { describe, expect, it } from 'vitest';
import { approvedOperationalCheckoutForLinen, laundryAccess, type LaundryAssignment } from './gozsduLaundryReadiness';
import type { LaundryRoom } from './gozsduLaundryner';

const date = '2026-09-19';
const room: LaundryRoom = {
  id: 'room-4005', hotel: 'gozsdu-court', room_number: '4005', status: 'clean',
  is_checkout_room: true, is_dnd: false,
  pms_metadata: { gozsduAvailability: { status: 'operating' },
    lastPmsRefreshDate: date, scheduledDepartureToday: true,
    checkedOutToday: false, readyToClean: null,
    gozsduVerifiedDepartureDate: date, gozsduIncomingGuestNotArrived: true,
    occupiedToday: false, stayThroughToday: false },
};
const assignment: LaundryAssignment = {
  id: 'assignment-4005', room_id: room.id, assigned_to: 'hk',
  assignment_type: 'checkout_cleaning', status: 'completed',
  ready_to_clean: true, supervisor_approved: true, is_dnd: false, pms_hold: false,
};
const withRoom = (patch: Partial<LaundryRoom>): LaundryRoom => ({ ...room, ...patch });
const withMeta = (patch: Record<string, unknown>): LaundryRoom =>
  withRoom({ pms_metadata: { ...room.pms_metadata, ...patch } });
const withAssignment = (patch: Partial<LaundryAssignment>): LaundryAssignment => ({ ...assignment, ...patch });

describe('Gozsdu supervisor-approved RTC linen-only release', () => {
  it('allows completed approved checkout when Previo switches to unarrived incoming booking', () => {
    expect(approvedOperationalCheckoutForLinen(room, [assignment], date)).toBe(true);
    expect(laundryAccess(room, [assignment], date)).toBe('ready');
  });
  it('does not use a checkout overview chip or premature RTC alone as checkout confirmation', () => {
    expect(laundryAccess(room, [withAssignment({ status: 'in_progress' })], date)).toBe('guest_inside');
    expect(laundryAccess(room, [withAssignment({ supervisor_approved: false })], date)).toBe('guest_inside');
    expect(laundryAccess(room, [withAssignment({ ready_to_clean: false })], date)).toBe('guest_inside');
    expect(laundryAccess(room, [withAssignment({ pms_hold: true })], date)).toBe('guest_inside');
    expect(laundryAccess(room, [assignment, withAssignment({ id: 'second' })], date)).toBe('guest_inside');
    expect(laundryAccess(withMeta({ gozsduVerifiedDepartureDate: undefined }), [assignment], date)).toBe('guest_inside');
  });
  it('blocks guest arrivals, active occupancy, stale dates, DND and other hotels', () => {
    expect(laundryAccess(withMeta({ gozsduIncomingGuestNotArrived: false }), [assignment], date)).toBe('guest_inside');
    expect(laundryAccess(withMeta({ occupiedToday: true }), [assignment], date)).toBe('guest_inside');
    expect(laundryAccess(withMeta({ stayThroughToday: true }), [assignment], date)).toBe('guest_inside');
    expect(laundryAccess(withMeta({ lastPmsRefreshDate: '2026-09-18' }), [assignment], date)).toBe('guest_inside');
    expect(laundryAccess(withMeta({ gozsduVerifiedDepartureDate: '2026-09-18' }), [assignment], date)).toBe('guest_inside');
    expect(laundryAccess(withRoom({ is_dnd: true }), [assignment], date)).toBe('dnd');
    expect(laundryAccess(withRoom({ hotel: 'Hotel Mika Downtown' }), [assignment], date)).toBe('unavailable');
  });
});
