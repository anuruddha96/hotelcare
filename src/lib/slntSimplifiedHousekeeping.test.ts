import { describe, expect, it } from 'vitest';
import { isSlntOrganization, summarizeTeamBProgress, workingTeamAStaff } from './slntSimplifiedHousekeeping';

describe('SLNT simplified housekeeping tenant safety', () => {
  it('limits configuration to SLNT and never RD Hotels', () => {
    expect(isSlntOrganization('slnt')).toBe(true);
    expect(isSlntOrganization('slnt-group')).toBe(true);
    expect(isSlntOrganization('rdhotels')).toBe(false);
    expect(isSlntOrganization('ottofiori')).toBe(false);
  });
  it('defaults Team A cleaners to working and excludes explicit days off', () => {
    const staff = [{ id: 'timi' }, { id: 'iren' }, { id: 'attilla' }];
    expect(workingTeamAStaff(staff, new Set())).toHaveLength(3);
    expect(workingTeamAStaff(staff, new Set(['iren'])).map(x => x.id)).toEqual(['timi','attilla']);
  });
  it('never calls unapproved completion a PMS-approved room', () => {
    expect(summarizeTeamBProgress([
      { assignment_status: null, supervisor_approved: false },
      { assignment_status: 'in_progress', supervisor_approved: false },
      { assignment_status: 'completed', supervisor_approved: false },
      { assignment_status: 'completed', supervisor_approved: true },
    ])).toEqual({ remaining: 2, pendingApproval: 1, approved: 1 });
  });
});
