import { describe, expect, it } from 'vitest';
import { canAccessChannelManager, canAccessLegacyModules } from './roleAccess';

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


describe('canAccessChannelManager', () => {
  it('allows all admin accounts and the anu_000 account', () => {
    expect(canAccessChannelManager('admin', null, 'other-org')).toBe(true);
    expect(canAccessChannelManager('manager', 'Anu_000', 'rdhotels')).toBe(true);
    expect(canAccessChannelManager('housekeeping', ' anu_000 ', 'rdhotels')).toBe(true);
  });

  it('hides the module from regular managers, top managers and all other roles', () => {
    for (const role of ['manager', 'top_management', 'top_management_manager', 'housekeeping_manager', 'reception_manager', 'reception', 'hr', 'supervisor']) {
      expect(canAccessChannelManager(role, 'other_user', 'rdhotels')).toBe(false);
    }
    expect(canAccessChannelManager(undefined, undefined, undefined)).toBe(false);
    // The nickname is unique per organization, not globally: a namesake in another tenant is not Anu.
    expect(canAccessChannelManager('manager', 'Anu_000', 'other-org')).toBe(false);
  });
});
