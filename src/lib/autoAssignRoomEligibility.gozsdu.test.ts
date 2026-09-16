import { describe, expect, it } from 'vitest';
import { isRoomEligibleForAutoAssign } from './autoAssignRoomEligibility';

const baseRoom = {
  status: 'clean',
  hotel: 'gozsdu-court',
  is_checkout_room: false,
  pms_metadata: {},
};

describe('Gozsdu Auto Assign eligibility', () => {
  it('includes checkout rooms', () => {
    expect(isRoomEligibleForAutoAssign({ ...baseRoom, is_checkout_room: true })).toBe(true);
  });

  it('includes second-night towel service', () => {
    expect(isRoomEligibleForAutoAssign({
      ...baseRoom,
      pms_metadata: { currentNight: 2, totalNights: 3 },
    })).toBe(true);
  });

  it('includes fourth-night Change Room when the stay continues long enough', () => {
    expect(isRoomEligibleForAutoAssign({
      ...baseRoom,
      pms_metadata: { currentNight: 4, totalNights: 6 },
    })).toBe(true);
  });

  it('keeps odd-night and arrival-only rooms out of Auto Assign', () => {
    expect(isRoomEligibleForAutoAssign({
      ...baseRoom,
      pms_metadata: { currentNight: 3, totalNights: 6 },
    })).toBe(false);
    expect(isRoomEligibleForAutoAssign({
      ...baseRoom,
      pms_metadata: { currentNight: 1, totalNights: 4, arrivalToday: true },
    })).toBe(false);
  });

  it('keeps no-shows out of Auto Assign', () => {
    expect(isRoomEligibleForAutoAssign({
      ...baseRoom,
      pms_metadata: { isNoShow: true, currentNight: 2, totalNights: 3 },
    })).toBe(false);
  });

  it('does not change eligibility for other hotels', () => {
    expect(isRoomEligibleForAutoAssign({
      ...baseRoom,
      hotel: 'Hotel Memories Budapest',
      pms_metadata: { currentNight: 3, totalNights: 6 },
    })).toBe(true);
  });
});
