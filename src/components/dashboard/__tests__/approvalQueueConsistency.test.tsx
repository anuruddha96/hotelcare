import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const dashboard = resolve(here, '..');
const readDashboard = (name: string) => readFileSync(resolve(dashboard, name), 'utf8');
const readHook = () => readFileSync(resolve(dashboard, '../../hooks/usePendingApprovals.tsx'), 'utf8');

describe('unified approval queue', () => {
  it('puts actionable approvals before non-actionable maintenance visibility', () => {
    const source = readDashboard('SupervisorApprovalView.tsx');
    expect(source.indexOf("summaryStats.totalCount === 0")).toBeLessThan(
      source.indexOf('<ForwardedMaintenanceApprovals hideWhenEmpty />'),
    );
    expect(source).not.toContain('<ForwardedMaintenanceApprovals />');
  });

  it('scopes the room queue to the same hotel aliases used by the count', () => {
    const source = readDashboard('SupervisorApprovalView.tsx');
    expect(source).toContain("select('organization_slug, assigned_hotel')");
    expect(source).toContain("assignmentQuery.in('rooms.hotel', hotelKeys)");
    expect(source).toContain("format(selectedDate, 'yyyy-MM-dd')");
    expect(source).toContain("supervisor_approved.is.null");
  });

  it('counts every actionable approval source and refreshes them in real time', () => {
    const source = readHook();
    expect(source).toContain('roomCount + earlySignoutCount + breakRequestCount');
    expect(source).toContain('pendingCount + maintenanceTicketCount + lateMinibarCount');
    expect(source).toContain("table: 'early_signout_requests'");
    expect(source).toContain("table: 'break_requests'");
    expect(source).toContain("table: 'room_minibar_usage'");
  });
});
