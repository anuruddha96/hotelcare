import { describe, expect, it } from 'vitest';
import { latestMaintenanceSubmitters, type MaintenanceSubmissionAudit } from './maintenanceCompletionAttribution';

const entry = (
  ticket_id: string, name: string | null, created_at: string,
  content = '[Maintenance team action: submit] Completion submitted for supervisor approval: Done',
): MaintenanceSubmissionAudit => ({
  ticket_id, created_at, content,
  submitter_profile: name ? { full_name: name, nickname: null } : null,
});

describe('maintenance completion attribution', () => {
  it('credits the logged-in submitter from the audit, not the unassigned ticket', () => {
    expect(latestMaintenanceSubmitters([
      entry('shower-faucet', 'Krisztián Ponyori', '2026-11-16T07:52:47Z'),
    ])).toEqual({ 'shower-faucet': 'Krisztián Ponyori' });
  });

  it('uses the latest submission after a rejection and resubmission', () => {
    expect(latestMaintenanceSubmitters([
      entry('ticket-1', 'Second Technician', '2026-11-16T10:00:00Z'),
      entry('ticket-1', 'First Technician', '2026-11-15T10:00:00Z'),
      entry('ticket-2', 'Separate Technician', '2026-11-16T09:00:00Z'),
    ])).toEqual({ 'ticket-1': 'Second Technician', 'ticket-2': 'Separate Technician' });
  });

  it('does not invent a submitter or credit an older actor if the latest profile is unavailable', () => {
    expect(latestMaintenanceSubmitters([
      entry('ticket-1', 'Earlier Technician', '2026-11-15T10:00:00Z'),
      entry('ticket-1', null, '2026-11-16T10:00:00Z'),
      entry('ticket-2', 'Assigned Technician', '2026-11-16T10:00:00Z', '[Maintenance team action: start] Work started'),
    ])).toEqual({ 'ticket-1': null });
  });

  it('prefers a nickname when a full name is empty', () => {
    expect(latestMaintenanceSubmitters([{
      ...entry('ticket-3', null, '2026-11-16T11:00:00Z'),
      submitter_profile: { full_name: ' ', nickname: 'Pat' },
    }])).toEqual({ 'ticket-3': 'Pat' });
  });
});
