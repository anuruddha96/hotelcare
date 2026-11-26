import { describe, expect, it } from 'vitest';
import {
  accessRoleFromPermission,
  accessRolesForPermission,
  capabilitiesFor,
  defaultDashboardTabFor,
  effectiveAccessRole,
  landingPathFor,
  hrNavigationFor,
  miraScopesFor,
} from '@/lib/accessPolicy';
import { canUseAssistant } from '@/lib/assistantAccess';
import { suggestedAccessRole } from '@/components/admin/AccessRolesDialog';

const ctx = { organizationSlug: 'rdhotels', invoicesAvailable: false, nativePms: false };

describe('access roles', () => {
  it('derives a role from the permission level when none is set', () => {
    expect(effectiveAccessRole({ role: 'top_management_manager' })).toBe('top_management');
    expect(effectiveAccessRole({ role: 'manager' })).toBe('manager');
    expect(effectiveAccessRole({ role: 'supervisor' })).toBe('housekeeping_supervisor');
    expect(accessRoleFromPermission('control_finance')).toBe('controlling');
  });

  it('accepts a role only when it fits the permission level', () => {
    expect(effectiveAccessRole({ role: 'manager', access_role: 'housekeeping_manager' })).toBe('housekeeping_manager');
    expect(effectiveAccessRole({ role: 'manager', access_role: 'reception' })).toBe('reception');
    expect(effectiveAccessRole({ role: 'top_management_manager', access_role: 'controlling' })).toBe('controlling');
    // A housekeeper cannot be made top management by a stray value.
    expect(effectiveAccessRole({ role: 'housekeeping', access_role: 'top_management' })).toBe('housekeeping');
    expect(effectiveAccessRole({ role: 'manager', access_role: 'nonsense' })).toBe('manager');
  });

  it('offers only fitting roles for a permission level', () => {
    expect(accessRolesForPermission('manager')).toEqual(['manager', 'housekeeping_manager', 'housekeeping_supervisor', 'reception']);
    expect(accessRolesForPermission('top_management_manager')).toEqual(['top_management', 'controlling', 'hr']);
    expect(accessRolesForPermission('housekeeping')).toEqual(['housekeeping']);
  });
});

describe('what each role may do', () => {
  it('keeps Mira away from housekeepers and maintenance', () => {
    expect(capabilitiesFor({ role: 'housekeeping' }).mira).toBe(false);
    expect(capabilitiesFor({ role: 'maintenance' }).mira).toBe(false);
    expect(canUseAssistant({ role: 'housekeeping' })).toBe(false);
    expect(canUseAssistant({ role: 'manager', access_role: 'housekeeping_manager' })).toBe(true);
  });

  it('gives reception everything except revenue', () => {
    const reception = capabilitiesFor({ role: 'manager', access_role: 'reception' });
    expect(reception.mira).toBe(true);
    expect(reception.revenueRead).toBe(false);
    expect(reception.revenueWrite).toBe(false);
    expect(reception.reviews).toBe(true);
    expect(miraScopesFor({ role: 'manager', access_role: 'reception' })).not.toContain('revenue');
  });

  it('keeps housekeeping managers and supervisors on their own hotel, without reviews or revenue', () => {
    for (const accessRole of ['housekeeping_manager', 'housekeeping_supervisor']) {
      const caps = capabilitiesFor({ role: 'manager', access_role: accessRole });
      expect(caps.scheduleScope).toBe('home_hotel');
      expect(caps.reviews).toBe(false);
      expect(caps.revenueRead).toBe(false);
      expect(caps.scheduleBuilder).toBe(true);
      expect(miraScopesFor({ role: 'manager', access_role: accessRole })).toEqual(['housekeeping', 'maintenance']);
    }
  });

  it('gives named managers every hotel and a price list, but no revenue figures', () => {
    const manager = capabilitiesFor({ role: 'manager', access_role: 'manager' });
    expect(manager.scheduleScope).toBe('org');
    expect(manager.priceList).toBe(true);
    expect(manager.reviews).toBe(true);
    expect(manager.scheduleBuilder).toBe(true);
    expect(manager.revenueRead).toBe(false);
    expect(manager.revenueWrite).toBe(false);
    expect(manager.salesGoal).toBe(false);
    expect(manager.scheduleGoLive).toBe(false);
    expect(miraScopesFor({ role: 'manager', access_role: 'manager' })).not.toContain('revenue');
  });

  it('keeps accounts without a role on one hotel and without a price list', () => {
    const unclassified = capabilitiesFor({ role: 'manager' });
    expect(unclassified.accessRole).toBe('manager');
    expect(unclassified.scheduleScope).toBe('property');
    expect(unclassified.priceList).toBe(false);
    expect(unclassified.revenueRead).toBe(false);
    expect(miraScopesFor({ role: 'manager' })).not.toContain('revenue');
  });

  it('gives controlling and HR top-management access', () => {
    for (const accessRole of ['controlling', 'hr', 'top_management']) {
      const caps = capabilitiesFor({ role: 'top_management_manager', access_role: accessRole });
      expect(caps.revenueWrite).toBe(true);
      expect(caps.revenueRead).toBe(true);
      expect(caps.scheduleScope).toBe('org');
      expect(caps.scheduleGoLive).toBe(true);
      expect(caps.reviews).toBe(true);
    }
  });

  it("shows Today's Sales & ADR Goal to top management, admins and Controlling only", () => {
    expect(capabilitiesFor({ role: 'top_management_manager' }).salesGoal).toBe(true);
    expect(capabilitiesFor({ role: 'top_management_manager', access_role: 'controlling' }).salesGoal).toBe(true);
    expect(capabilitiesFor({ role: 'admin' }).salesGoal).toBe(true);
    expect(capabilitiesFor({ role: 'manager', is_super_admin: true }).salesGoal).toBe(true);
    expect(capabilitiesFor({ role: 'top_management_manager', access_role: 'hr' }).salesGoal).toBe(false);
    expect(capabilitiesFor({ role: 'hr' }).salesGoal).toBe(false);
    expect(capabilitiesFor({ role: 'manager', access_role: 'manager' }).salesGoal).toBe(false);
  });
});

describe('first screen', () => {
  it('sends controlling to purchase invoices only when the module is open to them', () => {
    expect(landingPathFor({ role: 'top_management_manager', access_role: 'controlling' }, { ...ctx, invoicesAvailable: true })).toBe('/rdhotels/purchase-invoices');
    expect(landingPathFor({ role: 'top_management_manager', access_role: 'controlling' }, ctx)).toBeNull();
  });

  it('sends HR to the staff schedule and limits navigation', () => {
    expect(landingPathFor({ role: 'hr' }, ctx)).toBe('/rdhotels?view=staff-schedule');
    expect(defaultDashboardTabFor({ role: 'hr' })).toBe('people');
    expect(hrNavigationFor({ role: 'hr' })).toEqual(['staff-schedule','people','attendance','training']);
    expect(hrNavigationFor({ role: 'housekeeping' })).toEqual([]);
    expect(capabilitiesFor({ role: 'housekeeping' }).peopleManage).toBe(false);
    expect(capabilitiesFor({ role: 'hr' }).peopleManage).toBe(true);
  });

  it('opens reception for all reception access roles regardless of PMS provider', () => {
    for (const subject of [{ role: 'manager', access_role: 'reception' }, { role: 'reception' }, { role: 'front_office' }, { role: 'reception_manager' }]) {
      expect(landingPathFor(subject, ctx)).toBe('/rdhotels/reception');
      expect(landingPathFor(subject, { ...ctx, nativePms: true })).toBe('/rdhotels/reception');
    }
    // Explicit navigation to the operational dashboard retains its existing tab.
    expect(defaultDashboardTabFor({ role: 'manager', access_role: 'reception' })).toBe('housekeeping');
  });

  it('leaves top management and everyone else on their existing start screen', () => {
    expect(landingPathFor({ role: 'top_management_manager' }, ctx)).toBeNull();
    expect(landingPathFor({ role: 'manager', access_role: 'housekeeping_manager' }, ctx)).toBeNull();
    expect(defaultDashboardTabFor({ role: 'manager' })).toBeNull();
  });
});

describe('roles from the work schedule', () => {
  it('suggests the role of the work-schedule job', () => {
    expect(suggestedAccessRole('Housekeeping manager', 'Housekeeping')).toBe('housekeeping_manager');
    expect(suggestedAccessRole('Supervisor', 'Housekeeping')).toBe('housekeeping_supervisor');
    expect(suggestedAccessRole('Front office manager', 'Reception')).toBe('manager');
    expect(suggestedAccessRole('Reception lead', 'Reception')).toBe('manager');
    expect(suggestedAccessRole('Receptionist', 'Reception')).toBe('reception');
    expect(suggestedAccessRole(null, null)).toBeNull();
  });
});
