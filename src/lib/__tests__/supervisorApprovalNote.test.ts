import { describe, expect, it } from 'vitest';
import {
  getSupervisorApprovalNote,
  isNoServiceApproval,
} from '../supervisorApprovalNote';

describe('supervisor approval note formatting', () => {
  it('shows only the final no-service reason after an earlier green-board request', () => {
    const notes = [
      '[GREEN_BOARD_CLEAN_REQUEST] Green Clean My Room card seen at the door — cleaning requested.',
      '[NO_SERVICE] Guest confirmed no service required',
    ].join('\n');

    expect(isNoServiceApproval(notes)).toBe(true);
    expect(getSupervisorApprovalNote(notes)).toBe('Guest confirmed no service required');
  });

  it('uses the no-board explanation when the no-service marker has no own text', () => {
    const notes = [
      '[NO_SERVICE]',
      '[NO_BOARD_NO_CLEANING] Door checked — no green Clean My Room card / no cleaning request.',
    ].join('\n');

    expect(getSupervisorApprovalNote(notes)).toBe(
      'Door checked — no green Clean My Room card / no cleaning request.',
    );
  });

  it('keeps the housekeeper no-service comment', () => {
    const notes = '[NO_SERVICE] Guest confirmed no service required — Guest asked us to return tomorrow';

    expect(getSupervisorApprovalNote(notes)).toBe(
      'Guest confirmed no service required — Guest asked us to return tomorrow',
    );
  });

  it('never exposes technical markers in normal supervisor notes', () => {
    const notes = '[SUPERVISOR_RECHECK:same] Bathroom floor still dirty';

    expect(getSupervisorApprovalNote(notes)).toBe('Bathroom floor still dirty');
  });

  it('uses a human fallback for a bare no-service marker', () => {
    expect(getSupervisorApprovalNote('[NO_SERVICE]')).toBe('No service required');
  });

  it('leaves a plain human note unchanged', () => {
    expect(getSupervisorApprovalNote('Guest requested extra towels')).toBe('Guest requested extra towels');
  });
});
