import { describe, expect, it } from 'vitest';
import { maintenanceManagerActions } from './MaintenanceManagerControls';

const ticket = (status: 'open' | 'in_progress' | 'completed', pending = false, onHold = false) => ({
  status, pending_supervisor_approval: pending, on_hold: onHold,
});

describe('manager maintenance review action visibility', () => {
  it('never exposes new approval RPC before the database migration is enabled', () => {
    expect(maintenanceManagerActions(ticket('in_progress', true), false)).toEqual(['resolve']);
  });

  it('offers distinct approve and reject only while waiting for a supervisor', () => {
    expect(maintenanceManagerActions(ticket('in_progress', true), true)).toEqual(['approve', 'reject']);
    expect(maintenanceManagerActions(ticket('open'), true)).not.toContain('approve');
    expect(maintenanceManagerActions(ticket('in_progress'), true)).not.toContain('reject');
  });

  it('preserves preexisting manager start/hold/resume/manual-resolution and reopen routes', () => {
    expect(maintenanceManagerActions(ticket('open'), true)).toEqual(['start', 'resolve']);
    expect(maintenanceManagerActions(ticket('in_progress'), true)).toEqual(['hold', 'resolve']);
    expect(maintenanceManagerActions(ticket('in_progress', false, true), true)).toEqual(['resume', 'resolve']);
    expect(maintenanceManagerActions(ticket('completed', false, false), true)).toEqual(['reopen']);
  });
});
