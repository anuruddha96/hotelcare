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

  it('does not interfere with any other hotels or supervisor notes', () => {
    const note = 'Auto-distributed after full SLNT PMS sync.';
    expect(housekeeperVisibleAssignmentNote(note, 'Hotel Memories Budapest')).toBe(note);
    expect(housekeeperVisibleAssignmentNote('[SUPERVISOR_RECHECK] Please clean again.', 'slnt-group'))
      .toBe('[SUPERVISOR_RECHECK] Please clean again.');
  });
});
