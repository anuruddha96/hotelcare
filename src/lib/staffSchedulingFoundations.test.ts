import { describe, expect, it } from 'vitest';
import {
  canProfileWorkHousekeeping,
  departmentForRole,
  getCanonicalScheduleUserId,
} from './staffSchedulingFoundations';

describe('staff scheduling foundations', () => {
  it('uses profiles.id as the canonical staff schedule identity', () => {
    expect(getCanonicalScheduleUserId({ id: '  profile-123  ' })).toBe('profile-123');
  });

  it('fails closed when a profile identity is missing', () => {
    expect(getCanonicalScheduleUserId({ id: '' })).toBeNull();
    expect(getCanonicalScheduleUserId({ id: null })).toBeNull();
    expect(getCanonicalScheduleUserId({})).toBeNull();
  });

  it('keeps primary HR department role-based', () => {
    expect(departmentForRole('housekeeping_manager')).toBe('Housekeeping');
    expect(departmentForRole('front_office')).toBe('Reception');
    expect(departmentForRole('top_management_manager')).toBe('Management');
    expect(departmentForRole(null)).toBe('Other');
  });

  it('allows an explicitly mapped secondary housekeeper without rewriting their primary department', () => {
    const profile = {
      id: 'manager-1',
      role: 'manager',
      actsAsHousekeeper: true,
    };

    expect(departmentForRole(profile.role)).toBe('Management');
    expect(canProfileWorkHousekeeping(profile)).toBe(true);
  });

  it('recognizes housekeeping roles without requiring a secondary mapping flag', () => {
    expect(canProfileWorkHousekeeping({ role: 'housekeeping' })).toBe(true);
    expect(canProfileWorkHousekeeping({ role: 'reception', actsAsHousekeeper: false })).toBe(false);
  });
});
