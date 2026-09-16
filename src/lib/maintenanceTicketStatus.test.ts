import { describe, expect, it } from 'vitest';
import { maintenanceTicketStatusClass, maintenanceTicketStatusLabel } from './maintenanceTicketStatus';

describe('maintenance ticket lifecycle status presentation', () => {
  it('makes held tickets explicit instead of falling back to a generic status', () => {
    expect(maintenanceTicketStatusLabel('on_hold')).toBe('On hold');
    expect(maintenanceTicketStatusClass('on_hold')).toContain('orange');
  });

  it('makes supervisor approval state explicit', () => {
    expect(maintenanceTicketStatusLabel('pending_supervisor_approval')).toBe('Awaiting approval');
    expect(maintenanceTicketStatusClass('pending_supervisor_approval')).toContain('violet');
  });

  it('preserves the existing core lifecycle labels', () => {
    expect(maintenanceTicketStatusLabel('open')).toBe('Open');
    expect(maintenanceTicketStatusLabel('in_progress')).toBe('In progress');
    expect(maintenanceTicketStatusLabel('completed')).toBe('Completed');
  });

  it('renders unknown future states readably and safely', () => {
    expect(maintenanceTicketStatusLabel('waiting_for_part')).toBe('Waiting For Part');
    expect(maintenanceTicketStatusClass('waiting_for_part')).toContain('gray');
  });
});
