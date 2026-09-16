import { describe, expect, it } from 'vitest';
import { freshApplicationUrl, isLazyModuleCrash } from '../lazyModuleRecovery';

describe('lazy module crash recovery', () => {
  const lazyStack = '\nLazy\nSuspense\nAuthenticatedShell';

  it('identifies the iOS Safari fulfilled-but-undefined default module', () => {
    expect(isLazyModuleCrash(
      new TypeError("undefined is not an object (evaluating 'e._result.default')"),
      lazyStack,
    )).toBe(true);
  });

  it('identifies broken lazy named-export modules and missing dynamic chunks', () => {
    expect(isLazyModuleCrash(
      new TypeError("undefined is not an object (evaluating 'e.GuidedTourProvider')"),
      lazyStack,
    )).toBe(true);
    expect(isLazyModuleCrash(new Error('Failed to fetch dynamically imported module'), lazyStack)).toBe(true);
  });

  it('does not mistake unrelated component errors for lazy-module failures', () => {
    expect(isLazyModuleCrash(new Error('undefined is not an object'), '\nRoomCard\nSuspense')).toBe(false);
    expect(isLazyModuleCrash(new Error('Room record unavailable'), lazyStack)).toBe(false);
    expect(isLazyModuleCrash(null, lazyStack)).toBe(false);
  });

  it('keeps the tenant, hotel, query and anchor and replaces an existing stale nonce', () => {
    const href = 'https://my.hotelcare.app/rdhotels/revenue/gozsdu-court?tab=grid&chunk-recovery=123#rates';
    const next = new URL(freshApplicationUrl(href, 1789582083737));
    expect(next.pathname).toBe('/rdhotels/revenue/gozsdu-court');
    expect(next.searchParams.get('tab')).toBe('grid');
    expect(next.searchParams.getAll('chunk-recovery')).toEqual(['1789582083737']);
    expect(next.hash).toBe('#rates');
  });
});
