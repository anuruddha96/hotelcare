import { describe, expect, it } from 'vitest';
import { summarizeMaintenanceIssues, type MaintenanceMetricRow } from '../maintenanceIssueMetrics';

const baseline = (id: string, overrides: Partial<MaintenanceMetricRow> = {}): MaintenanceMetricRow => ({
  id, status: 'completed', pending_supervisor_approval: false, supervisor_approved: true, on_hold: false,
  room_number: id, created_at: '2026-09-09T08:00:00Z', closed_at: '2026-09-09T10:00:00Z',
  sla_due_date: null, attachment_urls: [], completion_photos: [], ...overrides,
});

describe('shared maintenance issue reporting', () => {
  it('includes all six completed records while separating unapproved repairs', () => {
    const rows = Array.from({ length: 6 }, (_, index) => baseline(String(index), index < 2 ? { pending_supervisor_approval: true, supervisor_approved: false } : {}));
    const result = summarizeMaintenanceIssues(rows);
    expect(result.total).toBe(6);
    expect(result.completed).toBe(6);
    expect(result.awaitingApproval).toBe(2);
    expect(result.approved).toBe(4);
    expect(result.averageHours).toBe(2);
  });
  it('does not mistake manual closure for a supervisor-approved repair', () => {
    const report = summarizeMaintenanceIssues([baseline('manual', { supervisor_approved: false }), baseline('approved')]);
    expect(report.completed).toBe(2);
    expect(report.approved).toBe(1);
  });
  it('detects overdue and repeat rooms without counting approved work as overdue', () => {
    const rows = [baseline('1', { status: 'open', closed_at: null, room_number: '101', sla_due_date: '2026-09-08T00:00:00Z' }), baseline('2', { room_number: '101', completion_photos: ['path.jpg'] })];
    const report = summarizeMaintenanceIssues(rows, Date.parse('2026-09-09T00:00:00Z'));
    expect(report.overdue).toBe(1);
    expect(report.repeatedRooms).toEqual([['101', 2]]);
    expect(report.missingEvidence).toBe(1);
  });
});
