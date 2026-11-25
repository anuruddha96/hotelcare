import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '..', 'SupervisorApprovalView.tsx'), 'utf8');
const approvalHandler = source.split('const handleApproveTicket =')[1]?.split('const handleReassignTicket =')[0] ?? '';

describe('cross-property supervisor maintenance approvals', () => {
  it('uses server-side review authorization instead of a direct table update', () => {
    expect(approvalHandler).toContain("rpc('review_maintenance_completion'");
    expect(approvalHandler).toContain("p_decision: 'approve'");
    expect(approvalHandler).toContain('p_expected_updated_at: ticket.updated_at');
    expect(approvalHandler).not.toContain(".from('tickets')");
    expect(approvalHandler).not.toContain('setPendingMaintenanceTickets(prev => prev.filter(t => t.id !== ticketId));\n    try');
  });
  it('only removes the ticket after success and shows the actual error on failure', () => {
    expect(approvalHandler.indexOf('if (error) throw error;')).toBeLessThan(
      approvalHandler.indexOf('setPendingMaintenanceTickets(prev => prev.filter('));
    expect(approvalHandler).toContain('Failed to approve ticket:');
    expect(source).toContain('disabled={approvingMaintenanceTicketId !== null}');
  });
});
