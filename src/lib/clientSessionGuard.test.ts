import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CLIENT_VERSION_CHECK_MS,
  checkHotelCareInactivity,
  getSessionSuspension,
  observeSessionSuspension,
  recordHotelCareInteraction,
  resetHotelCareSession,
  SESSION_INACTIVITY_MS,
  suspendHotelCareSession,
} from './clientSessionGuard';

afterEach(() => { resetHotelCareSession(Date.now()); vi.restoreAllMocks(); });

describe('HotelCare global idle protection', () => {
  it('does not suspend before exactly 30 minutes of no user interaction', () => {
    resetHotelCareSession(1_000);
    expect(SESSION_INACTIVITY_MS).toBe(1_800_000);
    expect(checkHotelCareInactivity(1_000 + 29 * 60_000)).toBe(false);
    recordHotelCareInteraction(1_000 + 29 * 60_000);
    expect(checkHotelCareInactivity(1_000 + 58 * 60_000)).toBe(false);
    expect(getSessionSuspension()).toBeNull();
    expect(checkHotelCareInactivity(1_000 + 59 * 60_000)).toBe(true);
    expect(getSessionSuspension()).toBe('idle');
  });

  it('stays suspended when a keyboard or mouse interaction occurs after expiry', () => {
    resetHotelCareSession(500);
    checkHotelCareInactivity(500 + SESSION_INACTIVITY_MS);
    recordHotelCareInteraction(500 + SESSION_INACTIVITY_MS + 1);
    expect(getSessionSuspension()).toBe('idle');
  });

  it('subscribers are notified and reset allows a fresh document session', () => {
    const handler = vi.fn();
    const off = observeSessionSuspension(handler);
    resetHotelCareSession(0);
    suspendHotelCareSession('update');
    suspendHotelCareSession('idle');
    expect(getSessionSuspension()).toBe('update');
    expect(handler).toHaveBeenCalledTimes(2);
    off();
    resetHotelCareSession(25);
    expect(handler).toHaveBeenCalledTimes(2);
    expect(CLIENT_VERSION_CHECK_MS).toBe(300_000);
  });
});
