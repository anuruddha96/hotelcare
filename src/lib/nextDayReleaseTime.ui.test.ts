import { describe, expect, it } from 'vitest';
import { normalizeNextDayReleaseTime } from './nextDayReleaseTime';

describe('tomorrow release time UI', () => {
  it('keeps approved database values stable for the dropdown', () => {
    expect(normalizeNextDayReleaseTime('06:00:00')).toBe('06:00');
    expect(normalizeNextDayReleaseTime('06:30:00')).toBe('06:30');
    expect(normalizeNextDayReleaseTime('07:00:00')).toBe('07:00');
    expect(normalizeNextDayReleaseTime('07:30:00')).toBe('07:30');
    expect(normalizeNextDayReleaseTime('08:30:00')).toBe('08:30');
  });
});
