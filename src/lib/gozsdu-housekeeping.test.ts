import { describe, expect, it } from 'vitest';
import { getGozsduHousekeepingCycle, isGozsduCourtHotel } from './gozsdu-housekeeping';

describe('Gozsdu Court Budapest housekeeping cycle', () => {
  it('is gated only to the Gozsdu property aliases', () => {
    expect(isGozsduCourtHotel('gozsdu-court')).toBe(true);
    expect(isGozsduCourtHotel('Gozsdu Court Budapest')).toBe(true);
    expect(isGozsduCourtHotel('Hotel Memories Budapest')).toBe(false);
    expect(isGozsduCourtHotel('Mika Downtown')).toBe(false);
  });

  it('does not schedule service on odd stay nights', () => {
    expect(getGozsduHousekeepingCycle({ currentNight: 1, totalNights: 6 }).service).toBe('none');
    expect(getGozsduHousekeepingCycle({ currentNight: 3, totalNights: 6 }).service).toBe('none');
  });

  it('schedules towel change every second night', () => {
    expect(getGozsduHousekeepingCycle({ currentNight: 2, totalNights: 3 }).service).toBe('towel_change');
    expect(getGozsduHousekeepingCycle({ currentNight: 6, totalNights: 8 }).service).toBe('towel_change');
  });

  it('schedules Change Room on the fourth night when the guest stays long enough', () => {
    const cycle = getGozsduHousekeepingCycle({ currentNight: 4, totalNights: 6 });
    expect(cycle.service).toBe('change_room');
    expect(cycle.remainingNightsAfterToday).toBe(2);
  });

  it('downgrades fourth-night Change Room to towel-only when checkout is next day', () => {
    const cycle = getGozsduHousekeepingCycle({ currentNight: 4, totalNights: 5 });
    expect(cycle.service).toBe('towel_change');
    expect(cycle.remainingNightsAfterToday).toBe(1);
  });

  it('never schedules stay-over service for a checkout room', () => {
    expect(getGozsduHousekeepingCycle({ currentNight: 4, totalNights: 8, isCheckout: true }).service).toBe('none');
  });
});
