import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const dashboard = resolve(here, '..');
const read = (name: string) => readFileSync(resolve(dashboard, name), 'utf8');

describe('maintenance launch readiness wiring', () => {
  it('uses alias-safe hotel scoping and secure maintenance staff lookup in supervisor approvals', () => {
    const source = read('SupervisorApprovalView.tsx');
    expect(source).toContain("resolveHotelKeys(profile.assigned_hotel)");
    expect(source).toContain("query = query.in('hotel', hotelKeys)");
    expect(source).toContain("rpc('get_maintenance_staff_for_hotel'");
    expect(source).toContain("table: 'tickets'");
    expect(source).toContain('<ForwardedMaintenanceApprovals hideWhenEmpty />');
  });

  it('keeps maintenance notifications scoped by organization and hotel aliases', () => {
    const source = read('NotificationPermissionBanner.tsx');
    expect(source).toContain("row.department !== 'maintenance'");
    expect(source).toContain('row.organization_slug !== profile.organization_slug');
    expect(source).toContain('resolveHotelKeys(profile.assigned_hotel)');
    expect(source).toContain('assignedSeen');
    expect(source).toContain('pendingSeen');
  });

  it('keeps worker completion behind supervisor approval', () => {
    const source = read('MaintenanceStaffView.tsx');
    expect(source).toContain('pending_supervisor_approval: true');
    expect(source).toContain("status: 'in_progress'");
    expect(source).toContain("completion_photos: [path]");
  });
});
