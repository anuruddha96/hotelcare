import { describe, expect, it } from 'vitest';
import { summarizeMaintenanceIssues, type MaintenanceMetricRow } from './maintenanceIssueMetrics';

const base = (overrides: Partial<MaintenanceMetricRow> = {}): MaintenanceMetricRow => ({
  id: crypto.randomUUID(),
  status: 'open',
  pending_supervisor_approval: false,
  supervisor_approved: false,
  on_hold: false,
  room_number: '101',
  created_at: '2026-09-01T00:00:00Z',
  closed_at: null,
  sla_due_date: null,
  attachment_urls: [],
  completion_photos: [],
  ...overrides,
});

describe('maintenance issue analytics', () => {
  it('reports average, median and p90 from completed issue durations only', () => {
    const rows = [
      base({ id: 'a', status: 'completed', room_number: '101', closed_at: '2026-09-01T01:00:00Z' }),
      base({ id: 'b', status: 'completed', room_number: '102', closed_at: '2026-09-01T02:00:00Z' }),
      base({ id: 'c', status: 'completed', room_number: '103', closed_at: '2026-09-01T03:00:00Z' }),
      base({ id: 'd', status: 'completed', room_number: '104', closed_at: '2026-09-01T10:00:00Z' }),
      base({ id: 'e', status: 'open', room_number: '105' }),
    ];
    const metrics = summarizeMaintenanceIssues(rows);
    expect(metrics.averageHours).toBe(4);
    expect(metrics.medianHours).toBe(2.5);
    expect(metrics.p90Hours).toBeCloseTo(7.9, 5);
  });

  it('separates active overdue work from completed history', () => {
    const now = Date.parse('2026-09-26T12:00:00Z');
    const rows = [
      base({ id: 'open-overdue', status: 'open', sla_due_date: '2026-09-26T10:00:00Z' }),
      base({ id: 'progress-overdue', status: 'in_progress', sla_due_date: '2026-09-26T11:00:00Z' }),
      base({ id: 'done-old', status: 'completed', closed_at: '2026-09-02T00:00:00Z', sla_due_date: '2026-09-01T05:00:00Z' }),
    ];
    const metrics = summarizeMaintenanceIssues(rows, now);
    expect(metrics.overdue).toBe(2);
    expect(metrics.completed).toBe(1);
  });

  it('counts repeated real rooms but excludes generic/common-area placeholders', () => {
    const rows = [
      base({ id: '1', room_number: '205' }),
      base({ id: '2', room_number: '205' }),
      base({ id: '3', room_number: 'N/A' }),
      base({ id: '4', room_number: 'N/A' }),
      base({ id: '5', room_number: 'General' }),
      base({ id: '6', room_number: 'General' }),
    ];
    expect(summarizeMaintenanceIssues(rows).repeatedRooms).toEqual([['205', 2]]);
  });

  it('keeps work completion and supervisor approval as separate counts', () => {
    const rows = [
      base({ id: 'done-unapproved', status: 'completed', closed_at: '2026-09-01T04:00:00Z' }),
      base({ id: 'done-approved', status: 'completed', closed_at: '2026-09-01T05:00:00Z', supervisor_approved: true }),
      base({ id: 'awaiting', status: 'in_progress', pending_supervisor_approval: true }),
    ];
    const metrics = summarizeMaintenanceIssues(rows);
    expect(metrics.completed).toBe(2);
    expect(metrics.approved).toBe(1);
    expect(metrics.awaitingApproval).toBe(1);
  });
});
