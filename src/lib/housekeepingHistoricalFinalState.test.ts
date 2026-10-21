import { describe, expect, it } from 'vitest';
import { resolveHistoricalHousekeepingState } from './housekeepingHistoricalFinalState';

describe('historical housekeeping final-state resolver', () => {
  it('uses the assignment instruction instead of an earlier transient T marker', () => {
    const state = resolveHistoricalHousekeepingState({
      towel_change_required: true,
      final_state: {
        towel_change_required_at_close: true,
        towel_change_required_for_assignment: false,
      },
    });
    expect(state.towel).toBe(false);
  });

  it('does not infer historical T/C from cumulative had_* flags', () => {
    const state = resolveHistoricalHousekeepingState({
      towel_change_required: false,
      linen_change_required: false,
      // legacy callers may have these fields; they are deliberately ignored
      ...( { had_towel_change: true, had_linen_change: true } as any ),
    });
    expect(state.towel).toBe(false);
    expect(state.changeRoom).toBe(false);
  });

  it('preserves DND and No Service as encounter evidence', () => {
    const state = resolveHistoricalHousekeepingState({
      final_state: { had_dnd: true, had_no_service: true },
    });
    expect(state.hadDnd).toBe(true);
    expect(state.hadNoService).toBe(true);
  });

  it('returns frozen notes and manager instructions when available', () => {
    const state = resolveHistoricalHousekeepingState({
      room_notes: 'mutable live note',
      final_state: {
        room_notes_at_close: 'saved 23 Sep note',
        assignment_notes: '[NO_SERVICE] guest declined',
        manager_instruction_text: '2 towels and 2 pillows',
      },
    });
    expect(state.roomNotes).toBe('saved 23 Sep note');
    expect(state.assignmentNotes).toContain('[NO_SERVICE]');
    expect(state.managerInstruction).toBe('2 towels and 2 pillows');
    expect(state.finalized).toBe(true);
  });

  it('remembers a scheduled towel change when an approved clean later clears live T', () => {
    const state = resolveHistoricalHousekeepingState({
      towel_change_required: false,
      final_state: {
        towel_change_required_for_assignment: false,
        towel_change_required_at_close: false,
        service_result: 'cleaned',
      },
      scheduled_service_due: { towel: true, change_room: false, first_observed_at: '2026-10-21T06:00:00Z' },
    });
    expect(state.towel).toBe(false); // immutable end-of-day instruction
    expect(state.scheduledTowel).toBe(true); // independent original duty evidence
    expect(state.scheduledChangeRoom).toBe(false);
  });

  it('does not fabricate scheduled duties for snapshots lacking evidence', () => {
    const state = resolveHistoricalHousekeepingState({
      final_state: { towel_change_required_for_assignment: false },
    });
    expect(state.scheduledTowel).toBe(false);
    expect(state.scheduledChangeRoom).toBe(false);
  });
});
