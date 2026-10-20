import { isSlntOrganization } from './slnt14DayHousekeeping';

export { isSlntOrganization };

/** Availability is opt-out, not an expensive published roster requirement. */
export function workingTeamAStaff<T extends { id: string }>(staff: T[], daysOff: ReadonlySet<string>): T[] {
  return staff.filter(person => !daysOff.has(person.id));
}

export type TeamBProgressItem = {
  assignment_status: string | null;
  supervisor_approved: boolean;
};

/** Completed work stays pending until a manager explicitly approves it. */
export function summarizeTeamBProgress(items: TeamBProgressItem[]) {
  const pendingApproval = items.filter(item => item.assignment_status === 'completed' && !item.supervisor_approved).length;
  const approved = items.filter(item => item.assignment_status === 'completed' && item.supervisor_approved).length;
  return { remaining: items.length - pendingApproval - approved, pendingApproval, approved };
}
