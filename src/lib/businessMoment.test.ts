import { describe, expect, it } from 'vitest';
import { budapestDateTime, budapestToday, budapestWallToIso, earliestBusinessDay } from './businessMoment';

describe('Budapest business moment', () => {
  it('converts the winter time without relying on browser timezone', () => {
    expect(budapestWallToIso('2026-11-18T14:30')).toBe('2026-11-18T13:30:00.000Z');
    expect(budapestDateTime(new Date('2026-11-18T13:30:00Z'))).toBe('2026-11-18T14:30');
    expect(budapestToday(new Date('2026-11-18T23:30:00Z'))).toBe('2026-11-19');
  });
  it('converts summer time at UTC+2', () => {
    expect(budapestWallToIso('2026-07-10T14:30')).toBe('2026-07-10T12:30:00.000Z');
  });
  it('rejects spring-forward gaps rather than silently misdating payments', () => {
    expect(() => budapestWallToIso('2026-03-29T02:30')).toThrow('INVALID_BUSINESS_TIME');
  });
  it('chooses first 02:30 on fall-back day deterministically', () => {
    expect(budapestWallToIso('2026-10-25T02:30')).toBe('2026-10-25T00:30:00.000Z');
  });
  it('applies the more restrictive date of first closure or manager minimum', () => {
    expect(earliestBusinessDay('2026-11-05', '2026-11-12')).toBe('2026-11-12');
    expect(earliestBusinessDay('2026-11-15', '2026-11-12')).toBe('2026-11-15');
  });
});
