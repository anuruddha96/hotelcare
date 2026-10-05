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

  it('routes shared worker actions through secure property-scoped RPCs', () => {
    const source = read('MaintenanceStaffView.tsx');
    expect(source).toContain("rpc('work_maintenance_ticket'");
    expect(source).toContain("runTeamAction(selected, 'submit'");
    expect(source).toContain('p_completion_photo: completionPhoto');
    expect(source).toContain("rpc('get_maintenance_property_teammates'");
    expect(source).not.toContain('assigned_to_profile:profiles!tickets_assigned_to_fkey');
  });

  it('keeps completion photos optional and non-blocking', () => {
    const source = read('MaintenanceStaffView.tsx');
    expect(source).toContain("if (completionFile) {");
    expect(source).toContain("toast.warning(c.photoSkipped)");
    expect(source).toContain("runTeamAction(selected, 'submit', resolution.trim(), null, uploadedPath)");
    expect(source).toContain("disabled={isSubmittingCompletion || !signedIn || !resolution.trim()}");
    expect(source).not.toContain("!resolution.trim() || !completionFile");
    expect(source).not.toContain("A completion photo is required");
  });

  it('prevents stale maintenance resolution dialogs from overwriting completed work', () => {
    const source = read('MaintenanceResolutionDialog.tsx');
    expect(source).toContain(".neq('status', 'resolved')");
    expect(source).toContain(".is('resolved_at', null)");
    expect(source).toContain(".select('id')");
    expect(source).toContain("if (!data?.length)");
    expect(source).toContain("if (isSubmitting) return");
    expect(source).toContain("language === 'hu'");
  });

  it('prevents stale maintenance translations from leaking across tickets or languages', () => {
    const source = read('MaintenanceTicketTranslation.tsx');
    expect(source).toContain('const requestSequence = useRef(0)');
    expect(source).toContain('requestSequence.current += 1');
    expect(source).toContain('const requestedLanguage = targetLanguage');
    expect(source).toContain('targetLanguage: requestedLanguage');
    expect(source).toContain('if (requestId !== requestSequence.current) return');
    expect(source).toContain('onValueChange={changeTargetLanguage}');
  });
});
