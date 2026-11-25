import { describe, expect, it } from 'vitest';
import {
  maintenanceHoldReasonLabel,
  maintenanceMissingHoldReasonLabel,
  maintenanceTicketStatusClass,
  maintenanceTicketStatusLabel,
} from './maintenanceTicketStatus';

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

  it('localizes operational lifecycle details for Hungarian maintenance staff', () => {
    expect(maintenanceTicketStatusLabel('open', 'hu')).toBe('Nyitott');
    expect(maintenanceTicketStatusLabel('in_progress', 'hu')).toBe('Folyamatban');
    expect(maintenanceTicketStatusLabel('on_hold', 'hu')).toBe('Felfüggesztve');
    expect(maintenanceTicketStatusLabel('pending_supervisor_approval', 'hu')).toBe('Jóváhagyásra vár');
    expect(maintenanceTicketStatusLabel('completed', 'hu')).toBe('Befejezve');
    expect(maintenanceHoldReasonLabel('hu')).toBe('Felfüggesztés oka:');
    expect(maintenanceMissingHoldReasonLabel('hu')).toBe('Nincs rögzített ok');
  });

  it('keeps English as the safe fallback for hold details', () => {
    expect(maintenanceHoldReasonLabel('vi')).toBe('Hold reason:');
    expect(maintenanceMissingHoldReasonLabel('vi')).toBe('Reason not recorded');
  });

  it('renders unknown future states readably and safely', () => {
    expect(maintenanceTicketStatusLabel('waiting_for_part')).toBe('Waiting For Part');
    expect(maintenanceTicketStatusClass('waiting_for_part')).toContain('gray');
  });
});
