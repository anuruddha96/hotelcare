import { describe, expect, it } from 'vitest';
import { housekeeperVisibleAssignmentNote } from './housekeeperVisibleAssignmentNote';

describe('SLNT housekeeper note visibility', () => {
  it('hides stale planner warning but leaves the stored note untouched', () => {
    const note = 'Unbooked at planning sync — revalidate before cleaning.';
    expect(housekeeperVisibleAssignmentNote(note, 'slnt-group')).toBe('');
    expect(note).toContain('revalidate');
  });

  it('hides routine automatic PMS distribution notes', () => {
    expect(housekeeperVisibleAssignmentNote('Auto-distributed after full SLNT PMS sync.', 'slnt-group')).toBe('');
  });

  it('keeps human instructions even when mixed with system metadata', () => {
    expect(housekeeperVisibleAssignmentNote(
      'Auto-distributed after full SLNT PMS sync.\nPlease replace the baby cot.\nUnbooked at planning sync — revalidate before cleaning.',
      'slnt-group',
    )).toBe('Please replace the baby cot.');
  });

  it('hides Hotel Memories automatic green-board notices without deleting audit data', () => {
    const notice = '[GREEN_BOARD_CLEAN_REQUEST] Green Clean My Room card seen at the door — cleaning requested.';
    expect(housekeeperVisibleAssignmentNote(notice, 'Hotel Memories Budapest')).toBe('');
    expect(housekeeperVisibleAssignmentNote(
      notice + '\nPlease leave a baby cot in the room.', 'Hotel Memories Budapest',
    )).toBe('Please leave a baby cot in the room.');
    expect(housekeeperVisibleAssignmentNote(notice, 'Hotel Ottofiori')).toBe(notice);
  });

  it('hides Hotel Memories no-board system text but preserves a real note', () => {
    const notice = '[NO_BOARD_NO_CLEANING] Door checked — no green Clean My Room card / no cleaning request.';
    expect(housekeeperVisibleAssignmentNote(
      notice + '\nManager: Check extra bed.', 'memories-budapest',
    )).toBe('Manager: Check extra bed.');
  });

  it('does not interfere with any other hotels or supervisor notes', () => {
    const note = 'Auto-distributed after full SLNT PMS sync.';
    expect(housekeeperVisibleAssignmentNote(note, 'Hotel Memories Budapest')).toBe(note);
    expect(housekeeperVisibleAssignmentNote('[SUPERVISOR_RECHECK] Please clean again.', 'slnt-group'))
      .toBe('[SUPERVISOR_RECHECK] Please clean again.');
  });
});
