import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(path, 'utf8');

describe('maintenance launch readiness wiring', () => {
  it('uses alias-safe hotel scoping and secure maintenance staff lookup in supervisor approvals', () => {
    const source = read('src/components/dashboard/SupervisorApprovalView.tsx');
    expect(source).toContain("resolveHotelKeys(profile.assigned_hotel)");
    expect(source).toContain("query = query.in('hotel', hotelKeys)");
    expect(source).toContain("rpc('get_maintenance_staff_for_hotel'");
    expect(source).toContain("table: 'tickets'");
    expect(source).toContain('<ForwardedMaintenanceApprovals />');
  });

  it('keeps maintenance notifications scoped by organization and hotel aliases', () => {
    const source = read('src/components/dashboard/NotificationPermissionBanner.tsx');
    expect(source).toContain("row.department !== 'maintenance'");
    expect(source).toContain('row.organization_slug !== profile.organization_slug');
    expect(source).toContain('resolveHotelKeys(profile.assigned_hotel)');
    expect(source).toContain('assignedSeen');
    expect(source).toContain('pendingSeen');
  });

  it('keeps worker completion behind supervisor approval', () => {
    const source = read('src/components/dashboard/MaintenanceStaffView.tsx');
    expect(source).toContain('pending_supervisor_approval: true');
    expect(source).toContain("status: 'in_progress'");
    expect(source).toContain("completion_photos: [path]");
  });
});
