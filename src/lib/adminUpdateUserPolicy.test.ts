import { describe, expect, it } from 'vitest';
import { canEditTarget, canAssignRole, canChangeStaffAccess } from '../../supabase/functions/admin-update-user/policy';

const staff = { role: 'housekeeping', organization_slug: 'one' };
const top = { role: 'top_management', organization_slug: 'one' };
describe('organization-scoped user management', () => {
  it.each(['top_management', 'top_management_manager'])('allows %s to edit ordinary staff only in their organization', role => {
    const caller = { ...top, role };
    expect(canEditTarget(caller, staff)).toBe(true);
    expect(canEditTarget(caller, { ...staff, organization_slug: 'two' })).toBe(false);
    expect(canEditTarget(caller, { ...staff, role: 'admin' })).toBe(false);
    expect(canEditTarget(caller, { ...staff, is_super_admin: true })).toBe(false);
    expect(canEditTarget(caller, top)).toBe(false);
    expect(canEditTarget(caller, { ...staff, deleted_at: '2026-11-25' })).toBe(false);
    expect(canAssignRole(caller, 'reception_manager')).toBe(true);
    expect(canAssignRole(caller, 'admin')).toBe(false);
    expect(canAssignRole(caller, 'top_management')).toBe(false);
    expect(canAssignRole(caller, 'top_management_manager')).toBe(false);
    expect(canChangeStaffAccess(caller)).toBe(true);
  });
  it('preserves global super-admin access but scopes ordinary admins', () => {
    const admin = { ...top, role: 'admin' };
    expect(canEditTarget(admin, { ...staff, organization_slug: 'two' })).toBe(false);
    expect(canEditTarget({ ...admin, is_super_admin: true }, { ...staff, organization_slug: 'two' })).toBe(true);
    expect(canAssignRole({ ...admin, is_super_admin: true }, 'admin')).toBe(true);
  });
  it('does not give staff managers role elevation or archived callers access', () => {
    expect(canAssignRole({ ...top, role: 'housekeeping_manager' }, 'manager')).toBe(false);
    expect(canEditTarget({ ...top, deleted_at: '2026-11-25' }, staff)).toBe(false);
    expect(canEditTarget(staff, top)).toBe(false);
  });
});
