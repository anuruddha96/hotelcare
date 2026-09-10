import { describe, expect, it } from 'vitest';
import { isBudapestNoonOrLater, todayBudapest, tomorrowBudapest } from './budapestTime';

describe('Budapest housekeeping business time', () => {
  it('opens exactly at 12:00 Budapest time during summer time', () => {
    expect(isBudapestNoonOrLater(new Date('2026-09-09T09:59:59Z'))).toBe(false);
    expect(isBudapestNoonOrLater(new Date('2026-09-09T10:00:00Z'))).toBe(true);
  });

  it('uses Budapest timezone during winter time as well', () => {
    expect(isBudapestNoonOrLater(new Date('2026-01-15T10:59:59Z'))).toBe(false);
    expect(isBudapestNoonOrLater(new Date('2026-01-15T11:00:00Z'))).toBe(true);
  });

  it('derives tomorrow from Budapest even when UTC is still on the previous date', () => {
    const at = new Date('2026-09-09T22:30:00Z'); // Sep 10 00:30 in Budapest
    expect(todayBudapest(at)).toBe('2026-09-10');
    expect(tomorrowBudapest(at)).toBe('2026-09-11');
  });

  it('rolls tomorrow across month and year boundaries safely', () => {
    expect(tomorrowBudapest(new Date('2026-12-31T12:00:00Z'))).toBe('2027-01-01');
  });
});
