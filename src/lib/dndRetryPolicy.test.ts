import { describe, expect, it } from 'vitest';
import { getDndRetryWindow, dndRetryTimeLabel } from './dndRetryPolicy';

describe('DND second door visit', () => {
  it('does not permit two photographs eight seconds apart', () => {
    const first = '2026-10-26T08:31:25Z'; // 09:31 Budapest
    const state = getDndRetryWindow(first, new Date('2026-10-26T08:31:33Z'));
    expect(state.allowed).toBe(false);
    expect(dndRetryTimeLabel(state.availableAt!)).toBe('13:31');
  });
  it('unlocks four hours later when earlier than 14:00', () => {
    expect(getDndRetryWindow('2026-10-26T08:31:25Z', new Date('2026-10-26T12:31:25Z')).allowed).toBe(true);
  });
  it('unlocks at 14:00 when the first attempt was later in the morning', () => {
    const first = '2026-10-26T10:30:00Z'; // 11:30 Budapest
    const state = getDndRetryWindow(first, new Date('2026-10-26T12:59:59Z'));
    expect(state.allowed).toBe(false);
    expect(dndRetryTimeLabel(state.availableAt!)).toBe('14:00');
    expect(getDndRetryWindow(first, new Date('2026-10-26T13:00:00Z')).allowed).toBe(true);
  });
  it('allows a new late-afternoon second check immediately', () => {
    expect(getDndRetryWindow('2026-10-26T14:01:00Z', new Date('2026-10-26T14:01:00Z')).allowed).toBe(true);
  });
  it('uses Budapest local time, not the housekeeper device time, across summer DST', () => {
    const state = getDndRetryWindow('2026-07-15T08:30:00Z', new Date('2026-07-15T11:59:00Z'));
    expect(state.allowed).toBe(false);
    expect(dndRetryTimeLabel(state.availableAt!)).toBe('14:00');
    expect(getDndRetryWindow('2026-07-15T08:30:00Z', new Date('2026-07-15T12:00:00Z')).allowed).toBe(true);
  });
  it('does not allow a stale previous-day DND state or missing first attempt', () => {
    expect(getDndRetryWindow(null).allowed).toBe(false);
    expect(getDndRetryWindow('2026-10-25T08:00:00Z', new Date('2026-10-26T08:00:00Z')).reason).toBe('different_day');
  });
});
