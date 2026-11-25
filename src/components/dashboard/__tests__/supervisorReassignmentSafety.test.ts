import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canSubmitRecheck } from '@/lib/recheckEvidence';

const manager = readFileSync(resolve(process.cwd(), 'src/components/dashboard/SupervisorApprovalView.tsx'), 'utf8');
const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20261021110000_supervisor_recheck_atomic_reassignment.sql'),
  'utf8',
);

describe('manager returns a completed room for correction', () => {
  it('allows a written reason without any manager photos', () => {
    expect(canSubmitRecheck('housekeeper-1', 'Please do again', [])).toBe(true);
    expect(canSubmitRecheck('housekeeper-1', '', [])).toBe(false);
    expect(canSubmitRecheck('', 'Please do again', [])).toBe(false);
  });

  it('never marks another active cleaning completed to resolve reassignment', () => {
    const start = manager.indexOf('const handleReassignment = async () =>');
    const end = manager.indexOf('const getAssignmentTypeLabel', start);
    const action = manager.slice(start, end);
    expect(action).toContain("rpc('return_housekeeping_room_for_recheck'");
    expect(action).not.toContain("status: 'completed'");
    expect(action).not.toContain("supervisor_approved: true");
    expect(action).toContain("action === 'already_reassigned'");
  });

  it('excludes returned and superseded submissions from the approval queue', () => {
    expect(manager).toContain(".is('supervisor_review_outcome', null)");
    expect(sql).toContain("supervisor_review_outcome = 'superseded'");
    expect(sql).toContain("supervisor_review_outcome = 'returned_for_correction'");
  });

  it('checks the correct room and worker permission before opening a replacement', () => {
    expect(sql).toContain('public.user_can_access_hotel(v_user, v_room.hotel)');
    expect(sql).toContain('public.user_can_access_hotel(p_assigned_to, v_room.hotel)');
    expect(sql).toContain('v_worker.organization_slug IS DISTINCT FROM v_room.organization_slug');
    expect(sql).toContain('FOR UPDATE');
  });

  it('does not disable housekeeper completion photo validation or alter the PMS', () => {
    expect(sql).not.toContain('DROP TRIGGER enforce_daily_cleaning_photos');
    expect(sql).not.toContain('manager_clean_override_assignment');
    expect(sql).not.toContain('UPDATE public.rooms SET');
    expect(sql).toContain('recheck_photos');
    expect(sql).toContain("'assigned', false");
  });
});
