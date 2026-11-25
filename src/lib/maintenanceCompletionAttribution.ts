/**
 * The assigned maintenance technician is not necessarily the person who submitted a repair.
 * The work_maintenance_ticket RPC writes an authenticated, ticket-scoped audit comment for
 * each "submit" action. Use its latest actor as the attribution on supervisor approval.
 */
export const MAINTENANCE_SUBMISSION_AUDIT_PREFIX = '[Maintenance team action: submit]';

export type MaintenanceSubmissionAudit = {
  ticket_id: string;
  content: string;
  created_at: string;
  submitter_profile: { full_name: string | null; nickname: string | null } | null;
};

export function latestMaintenanceSubmitters(
  audits: MaintenanceSubmissionAudit[],
): Record<string, string | null> {
  const newest = new Map<string, { timestamp: number; name: string | null }>();

  for (const audit of audits) {
    if (!audit.content.startsWith(MAINTENANCE_SUBMISSION_AUDIT_PREFIX)) continue;
    const timestamp = Date.parse(audit.created_at);
    if (!audit.ticket_id || !Number.isFinite(timestamp)) continue;
    const name = audit.submitter_profile?.full_name?.trim()
      || audit.submitter_profile?.nickname?.trim()
      || null;
    const previous = newest.get(audit.ticket_id);
    // Keep the latest submission even if that actor's profile is no longer readable:
    // falling back to a prior submitter would incorrectly credit the wrong person.
    if (!previous || timestamp > previous.timestamp) {
      newest.set(audit.ticket_id, { timestamp, name });
    }
  }

  return Object.fromEntries(
    [...newest].map(([ticketId, { name }]) => [ticketId, name]),
  );
}
