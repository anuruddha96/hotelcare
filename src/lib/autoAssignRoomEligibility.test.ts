import { describe, expect, it } from 'vitest';
import { isRoomEligibleForAutoAssign } from './autoAssignRoomEligibility';

describe('isRoomEligibleForAutoAssign', () => {
  it('includes clean rooms because they can still be scheduled daily or checkout work', () => {
    expect(isRoomEligibleForAutoAssign({ status: 'clean', hotel: 'Hotel Mika Downtown', is_checkout_room: false })).toBe(true);
  });

  it('includes dirty and in-progress rooms for other hotels', () => {
    expect(isRoomEligibleForAutoAssign({ status: 'dirty', hotel: 'Hotel Mika Downtown', is_checkout_room: false })).toBe(true);
    expect(isRoomEligibleForAutoAssign({ status: 'in_progress', hotel: 'Hotel Mika Downtown', is_checkout_room: false })).toBe(true);
  });

  it('excludes rooms already completed today', () => {
    expect(isRoomEligibleForAutoAssign(
      { status: 'clean', hotel: 'Hotel Mika Downtown', is_checkout_room: false },
      { hasCompletedAssignment: true },
    )).toBe(false);
  });

  it('excludes out-of-order rooms elsewhere unless an active assignment must remain editable', () => {
    const room = { status: 'out_of_order', hotel: 'Hotel Mika Downtown', is_checkout_room: false };
    expect(isRoomEligibleForAutoAssign(room)).toBe(false);
    expect(isRoomEligibleForAutoAssign(room, { hasActiveAssignment: true })).toBe(true);
  });

  it.each(['unavailable', 'non_guest', 'unmapped', undefined])(
    'excludes Gozsdu %s rooms even if flagged checkout or already assigned', status => {
      const room = { status: 'dirty', hotel: 'gozsdu-court', is_checkout_room: true,
        pms_metadata: { gozsduAvailability: { status }, scheduledDepartureToday: true } };
      expect(isRoomEligibleForAutoAssign(room, { hasActiveAssignment: true })).toBe(false);
    },
  );

  it('accepts operating Gozsdu checkouts and due towel services only', () => {
    const room = { status: 'dirty', hotel: 'gozsdu-court', is_checkout_room: false,
      pms_metadata: { gozsduAvailability: { status: 'operating' }, gozsduHousekeeping: { serviceType: 'towel_change' } } };
    expect(isRoomEligibleForAutoAssign(room)).toBe(true);
    expect(isRoomEligibleForAutoAssign({ ...room, pms_metadata: { ...room.pms_metadata, gozsduHousekeeping: { serviceType: 'none' } } })).toBe(false);
    expect(isRoomEligibleForAutoAssign({ ...room, is_checkout_room: true })).toBe(true);
  });
});
