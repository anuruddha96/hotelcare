import { describe, expect, it } from 'vitest';
import { canAccessLegacyModules } from './roleAccess';

describe('canAccessLegacyModules', () => {
  it('allows Anu_000 regardless of case or surrounding whitespace', () => {
    expect(canAccessLegacyModules('Anu_000')).toBe(true);
    expect(canAccessLegacyModules(' anu_000 ')).toBe(true);
  });

  it('rejects every other nickname and missing profiles', () => {
    expect(canAccessLegacyModules('top_manager')).toBe(false);
    expect(canAccessLegacyModules('Anu_001')).toBe(false);
    expect(canAccessLegacyModules(undefined)).toBe(false);
    expect(canAccessLegacyModules(null)).toBe(false);
  });
});
