import { describe, expect, it } from 'vitest';
import { isBudapestNoonOrLater } from './budapestTime';

describe('isBudapestNoonOrLater', () => {
  it('opens exactly at 12:00 Budapest time during summer time', () => {
    expect(isBudapestNoonOrLater(new Date('2026-09-09T09:59:59Z'))).toBe(false);
    expect(isBudapestNoonOrLater(new Date('2026-09-09T10:00:00Z'))).toBe(true);
  });

  it('uses Budapest timezone during winter time as well', () => {
    expect(isBudapestNoonOrLater(new Date('2026-01-15T10:59:59Z'))).toBe(false);
    expect(isBudapestNoonOrLater(new Date('2026-01-15T11:00:00Z'))).toBe(true);
  });
});
