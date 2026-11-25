import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NEXT_DAY_RELEASE_TIME,
  NEXT_DAY_RELEASE_TIMES,
  normalizeNextDayReleaseTime,
} from './nextDayReleaseTime';

describe('next-day release time choices', () => {
  it('offers half-hour choices from 06:00 through 08:30', () => {
    expect(NEXT_DAY_RELEASE_TIMES).toEqual(['06:00', '06:30', '07:00', '07:30', '08:00', '08:30']);
  });

  it('keeps 08:00 as the default and normalizes database time strings', () => {
    expect(DEFAULT_NEXT_DAY_RELEASE_TIME).toBe('08:00');
    expect(normalizeNextDayReleaseTime('07:30:00')).toBe('07:30');
    expect(normalizeNextDayReleaseTime('08:00:00')).toBe('08:00');
    expect(normalizeNextDayReleaseTime('09:00:00')).toBe('08:00');
  });
});
