import { describe, expect, it } from 'vitest';
import { getGozsduHousekeepingCycle, gozsduServiceLabel, isGozsduCourtHotel } from './gozsdu-housekeeping';

describe('Gozsdu Court Budapest PMS stay-night service cycle', () => {
  it('is gated only to the Gozsdu property aliases', () => {
    expect(isGozsduCourtHotel('gozsdu-court')).toBe(true);
    expect(isGozsduCourtHotel('Gozsdu Court Budapest')).toBe(true);
    expect(isGozsduCourtHotel('Hotel Memories Budapest')).toBe(false);
    expect(isGozsduCourtHotel('Mika Downtown')).toBe(false);
  });

  it.each([2, 4, 6, 8, 10])('never treats PMS %i/N as a service day', (night) => {
    expect(getGozsduHousekeepingCycle({ currentNight: night, totalNights: 12 }).service).toBe('none');
  });

  it.each([3, 7, 11])('schedules towel service at PMS %i/N after two, six, ten nights', (night) => {
    expect(getGozsduHousekeepingCycle({ currentNight: night, totalNights: 12 }).service).toBe('towel_change');
  });

  it.each([3, 4, 5])('schedules towel service at 3/%i (including the final night)', (totalNights) => {
    const result = getGozsduHousekeepingCycle({ currentNight: 3, totalNights });
    expect(result.service).toBe('towel_change');
    expect(result.serviceDue).toBe(true);
  });

  it.each([7, 8, 10])('schedules Complete Textile Change at PMS 5/%i', (totalNights) => {
    const result = getGozsduHousekeepingCycle({ currentNight: 5, totalNights });
    expect(result.service).toBe('change_room');
    expect(result.remainingNightsAfterToday).toBe(totalNights - 5);
    expect(gozsduServiceLabel(result.service)).toBe('Complete Textile Change');
  });

  it('downgrades Complete Textile Change to towel-only when checkout is the next day', () => {
    const result = getGozsduHousekeepingCycle({ currentNight: 5, totalNights: 6 });
    expect(result.service).toBe('towel_change');
    expect(result.remainingNightsAfterToday).toBe(1);
  });

  it('never schedules stay-over service on a checkout or with unusable counters', () => {
    expect(getGozsduHousekeepingCycle({ currentNight: 5, totalNights: 8, isCheckout: true }).service).toBe('none');
    expect(getGozsduHousekeepingCycle({ currentNight: 3, totalNights: null }).service).toBe('none');
    expect(getGozsduHousekeepingCycle({ currentNight: 5, totalNights: 4 }).service).toBe('none');
    expect(getGozsduHousekeepingCycle({ currentNight: 1, totalNights: 5 }).service).toBe('none');
  });
});
