import { describe, expect, it } from 'vitest';
import { isCurrentNoServiceOutcome, selectCurrentHousekeepingAssignments } from '../currentHousekeepingAssignments';

const prior = {
  id: '001', room_id: 'memories-room-123', assigned_to: 'christy',
  status: 'completed', created_at: '2026-09-17T11:50:00Z',
  notes: '[NO_SERVICE] Guest declined', service_result: 'guest_declined',
};
const reopened = {
  id: '002', room_id: 'memories-room-123', assigned_to: 'christy',
  status: 'in_progress', created_at: '2026-09-17T12:17:00Z',
  notes: '[SUPERVISOR_RECHECK:same] Please clean again', service_result: null,
};

describe('current housekeeping assignment (Hotel Memories recheck)', () => {
  it.each([[prior, reopened], [reopened, prior]])(
    'shows the active recheck regardless of database row ordering',
    (...rows) => {
      const current = selectCurrentHousekeepingAssignments(rows).get(prior.room_id);
      expect(current?.id).toBe(reopened.id);
      expect(current?.status).toBe('in_progress');
      expect(isCurrentNoServiceOutcome(current)).toBe(false);
    },
  );

  it('shows a newer pending recheck instead of the prior completed submission', () => {
    const pending = { ...reopened, status: 'assigned' };
    expect(selectCurrentHousekeepingAssignments([pending, prior]).get(prior.room_id)?.id).toBe(pending.id);
  });

  it('shows the recheck result once it is completed, even if the old no-service is returned last', () => {
    const finished = { ...reopened, status: 'completed', service_result: 'cleaned' };
    const current = selectCurrentHousekeepingAssignments([finished, prior]).get(prior.room_id);
    expect(current?.id).toBe(finished.id);
    expect(isCurrentNoServiceOutcome(current)).toBe(false);
  });

  it('retains genuine completed no-service when there is no reopened assignment', () => {
    const current = selectCurrentHousekeepingAssignments([prior]).get(prior.room_id);
    expect(isCurrentNoServiceOutcome(current)).toBe(true);
  });

  it('never shows no-service on active work, even if a stale marker was copied', () => {
    expect(isCurrentNoServiceOutcome({ ...reopened, notes: '[NO_SERVICE] stale note' })).toBe(false);
  });

  it('explicit cleaned outcome supersedes a stale legacy no-service marker', () => {
    expect(isCurrentNoServiceOutcome({ ...prior, service_result: 'cleaned' })).toBe(false);
  });

  it('prefers active work over a completed record when creation timestamps are identical', () => {
    const tied = { ...reopened, created_at: prior.created_at };
    expect(selectCurrentHousekeepingAssignments([tied, prior]).get(prior.room_id)?.id).toBe(tied.id);
  });

  it('keeps different rooms independent', () => {
    const unrelated = { ...prior, id: '003', room_id: 'memories-room-125' };
    const selected = selectCurrentHousekeepingAssignments([prior, reopened, unrelated]);
    expect(selected.size).toBe(2);
    expect(selected.get(prior.room_id)?.id).toBe(reopened.id);
    expect(selected.get(unrelated.room_id)?.id).toBe(unrelated.id);
  });
});
