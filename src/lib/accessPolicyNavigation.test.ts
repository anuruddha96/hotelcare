import { describe, expect, it } from 'vitest';
import {
  capabilitiesFor,
  defaultDashboardTabFor,
  effectiveAccessRole,
  landingPathFor,
} from './accessPolicy';

const context = { organizationSlug: 'rdhotels', invoicesAvailable: true, nativePms: false };

describe('role-aware navigation and finance boundary', () => {
  it('keeps a top manager on Revenue even when assigned to a hotel', () => {
    expect(effectiveAccessRole({ role: 'top_management_manager' })).toBe('top_management');
    expect(capabilitiesFor({ role: 'top_management_manager' }).revenueRead).toBe(true);
  });

  it('does not grant HR executive data access despite the underlying permission level', () => {
    const hr = { role: 'top_management_manager', access_role: 'hr' };
    expect(capabilitiesFor(hr)).toMatchObject({
      accessRole: 'hr', revenueRead: false, revenueWrite: false,
      reviews: false, finance: false, scheduleScope: 'org',
    });
    expect(landingPathFor(hr, context)).toBe('/rdhotels?tab=attendance');
    expect(defaultDashboardTabFor(hr)).toBe('attendance');
  });

  it('starts front-office managers on housekeeping but reception staff on maintenance', () => {
    const manager = { role: 'manager', access_role: 'reception' };
    const receptionManager = { role: 'reception_manager' };
    const receptionist = { role: 'reception' };
    expect(defaultDashboardTabFor(manager)).toBe('housekeeping');
    expect(defaultDashboardTabFor(receptionManager)).toBe('housekeeping');
    expect(landingPathFor(manager, context)).toBeNull();
    expect(landingPathFor(receptionManager, context)).toBeNull();
    expect(landingPathFor(receptionist, context)).toBe('/rdhotels?tab=tickets');
  });

  it('allows controlling finance while excluding ordinary managers', () => {
    const controlling = { role: 'top_management_manager', access_role: 'controlling' };
    expect(capabilitiesFor(controlling).finance).toBe(true);
    expect(landingPathFor(controlling, context)).toBe('/rdhotels/purchase-invoices');
    expect(capabilitiesFor({ role: 'manager', access_role: 'manager' }).finance).toBe(false);
  });

  it('keeps housekeeping and maintenance staff restricted to their own work', () => {
    expect(capabilitiesFor({ role: 'housekeeping' })).toMatchObject({
      mira: false, revenueRead: false, finance: false, scheduleScope: 'self',
    });
    expect(capabilitiesFor({ role: 'maintenance' })).toMatchObject({
      mira: false, revenueRead: false, finance: false, scheduleScope: 'self',
    });
  });
});
