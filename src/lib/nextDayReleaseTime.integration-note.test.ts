import { describe, expect, it } from 'vitest';
import { NEXT_DAY_RELEASE_TIMES } from './nextDayReleaseTime';

describe('next-day release schedule invariant', () => {
  it('does not allow a slot later than 08:30', () => {
    expect(NEXT_DAY_RELEASE_TIMES.at(-1)).toBe('08:30');
  });
});
