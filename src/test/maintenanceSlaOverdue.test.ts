import { describe, expect, it } from 'vitest';
import { formatMaintenanceOverdue, maintenanceHoursPastDue } from '../../supabase/functions/_shared/maintenanceSla';

describe('maintenance repair deadline escalation', () => {
  it('measures L2 overdue time from original repair deadline, not second escalation threshold', () => {
    // Mika ticket created 04 Nov 08:47 Budapest, configured medium SLA 48h.
    // L2 email on 10 Nov must say 4 days overdue, not 1 hour.
    const hours = maintenanceHoursPastDue(
      new Date('2026-11-10T07:48:00Z'),
      '2026-11-06T07:47:21Z',
    );
    expect(hours).toBeGreaterThan(96);
    expect(formatMaintenanceOverdue(hours)).toBe('4 days past repair deadline');
  });

  it('uses the same repair deadline on first and second reminders', () => {
    const due = '2026-11-06T07:47:21Z';
    expect(formatMaintenanceOverdue(maintenanceHoursPastDue(new Date('2026-11-06T07:50:00Z'), due)))
      .toBe('3 minutes past repair deadline');
    expect(formatMaintenanceOverdue(maintenanceHoursPastDue(new Date('2026-11-08T08:47:21Z'), due)))
      .toBe('2 days 1 hour past repair deadline');
  });

  it('does not report negative overdue time or invent hours for minute-old deadlines', () => {
    const due = '2026-11-06T07:47:21Z';
    expect(maintenanceHoursPastDue(new Date('2026-11-06T07:00:00Z'), due)).toBe(0);
    expect(formatMaintenanceOverdue(0)).toBe('1 minute past repair deadline');
    expect(formatMaintenanceOverdue(0.5)).toBe('30 minutes past repair deadline');
    expect(formatMaintenanceOverdue(24)).toBe('1 day past repair deadline');
  });
});
