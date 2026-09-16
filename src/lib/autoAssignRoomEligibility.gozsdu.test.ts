import { describe, expect, it } from 'vitest';
import { isRoomEligibleForAutoAssign } from './autoAssignRoomEligibility';

const baseRoom = {
  status: 'clean',
  hotel: 'gozsdu-court',
  is_checkout_room: false,
  pms_metadata: { gozsduAvailability: { status: 'operating' } },
};

describe('Gozsdu Auto Assign eligibility', () => {
  it('includes operating checkout rooms', () => {
    expect(isRoomEligibleForAutoAssign({ ...baseRoom, is_checkout_room: true })).toBe(true);
  });

  it('includes operating second-night towel service', () => {
    expect(isRoomEligibleForAutoAssign({
      ...baseRoom,
      pms_metadata: { ...baseRoom.pms_metadata, currentNight: 2, totalNights: 3 },
    })).toBe(true);
  });

  it('includes operating fourth-night Change Room when the stay continues long enough', () => {
    expect(isRoomEligibleForAutoAssign({
      ...baseRoom,
      pms_metadata: { ...baseRoom.pms_metadata, currentNight: 4, totalNights: 6 },
    })).toBe(true);
  });

  it('keeps odd-night and arrival-only rooms out of Auto Assign', () => {
    expect(isRoomEligibleForAutoAssign({
      ...baseRoom,
      pms_metadata: { ...baseRoom.pms_metadata, currentNight: 3, totalNights: 6 },
    })).toBe(false);
    expect(isRoomEligibleForAutoAssign({
      ...baseRoom,
      pms_metadata: { ...baseRoom.pms_metadata, currentNight: 1, totalNights: 4, arrivalToday: true },
    })).toBe(false);
  });

  it('keeps no-shows out of Auto Assign', () => {
    expect(isRoomEligibleForAutoAssign({
      ...baseRoom,
      pms_metadata: { ...baseRoom.pms_metadata, isNoShow: true, currentNight: 2, totalNights: 3 },
    })).toBe(false);
  });

  it('excludes unavailable, non-guest and not-yet-mapped Gozsdu rooms, even on checkout', () => {
    for (const status of ['unavailable', 'non_guest', 'unmapped']) {
      expect(isRoomEligibleForAutoAssign({
        ...baseRoom,
        is_checkout_room: true,
        pms_metadata: { gozsduAvailability: { status } },
      })).toBe(false);
    }
    expect(isRoomEligibleForAutoAssign({ ...baseRoom, is_checkout_room: true, pms_metadata: {} })).toBe(false);
  });

  it('does not change eligibility for other hotels', () => {
    expect(isRoomEligibleForAutoAssign({
      ...baseRoom,
      hotel: 'Hotel Memories Budapest',
      pms_metadata: { currentNight: 3, totalNights: 6 },
    })).toBe(true);
  });
});
