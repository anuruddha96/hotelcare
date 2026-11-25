import { describe, expect, it } from 'vitest';
import { historicalDndState, isBudapestBusinessDate, selectSavedSnapshot } from './historicalDndStatus';

const approvedCheckout = {
  is_dnd: false,
  had_dnd: true,
  dnd_attempt_count: 0,
  assignment_status: 'completed',
  supervisor_approved: true,
} as const;

describe('historical DND is specific to the saved business date', () => {
  it('does not label Memories 138 DND on 17 September from the previous-day room flag', () => {
    expect(historicalDndState(approvedCheckout, 0)).toBe('none');
  });
  it('retains genuine same-day DND evidence separately after approval', () => {
    expect(historicalDndState(approvedCheckout, 1)).toBe('earlier');
    expect(historicalDndState({ ...approvedCheckout, dnd_attempt_count: 1 }, 0)).toBe('earlier');
  });
  it('shows unresolved DND and a contradictory approved+DND state honestly', () => {
    expect(historicalDndState({ ...approvedCheckout, supervisor_approved: false, is_dnd: true }, 0)).toBe('active');
    expect(historicalDndState({ ...approvedCheckout, is_dnd: true }, 0)).toBe('conflict');
    expect(historicalDndState({ ...approvedCheckout, is_dnd: false, assignment_status: 'dnd_pending_retry', supervisor_approved: false }, 0)).toBe('active');
  });
  it('does not create events from a sticky had_dnd without dated evidence', () => {
    expect(historicalDndState({ ...approvedCheckout, had_dnd: true, dnd_attempt_count: null }, 0)).toBe('none');
    expect(historicalDndState({ ...approvedCheckout, had_dnd: false }, 0)).toBe('none');
  });
  it('validates the business date in Budapest, not UTC', () => {
    expect(isBudapestBusinessDate('2026-09-16T22:05:00Z', '2026-09-17')).toBe(true);
    expect(isBudapestBusinessDate('2026-09-16T21:55:00Z', '2026-09-17')).toBe(false);
    expect(isBudapestBusinessDate('2026-09-17T22:05:00Z', '2026-09-17')).toBe(false);
  });
  it('chooses canonical-hotel and fresh saved rows independent of API ordering', () => {
    const a = { hotel: 'Hotel Memories Budapest', room_number: '138', room_id: 'a', source: 'live_capture', captured_at: '2026-09-17T01:00:00Z', updated_at: '2026-09-17T18:00:00Z' };
    const b = { ...a, room_id: 'b', source: 'assignment_capture', updated_at: '2026-09-17T20:00:00Z' };
    const c = { ...a, hotel: 'memories-alias', room_id: 'c', updated_at: '2026-09-17T22:00:00Z' };
    expect(selectSavedSnapshot([b, c, a], 'Hotel Memories Budapest')).toEqual([a]);
    expect(selectSavedSnapshot([a, c, b], 'Hotel Memories Budapest')).toEqual([a]);
    expect(selectSavedSnapshot([{ ...a, room_number: '139' }, a], 'Hotel Memories Budapest')).toHaveLength(2);
  });
});
