import { describe, expect, it } from 'vitest';
import {
  formatBudapestNoteTimestamp,
  isNoteFromBudapestToday,
  matchingRoomNoteHistory,
  type RoomNoteHistoryEntry,
} from './roomNoteProvenance';

const history: RoomNoteHistoryEntry[] = [
  { id: 'new', content: 'check 2 small towels', created_at: '2026-10-22T05:47:48Z', created_by: 'one', created_by_name: 'Éva' },
  { id: 'old', content: 'out 2 bathrobes', created_at: '2026-10-18T05:56:10Z', created_by: 'one', created_by_name: 'Éva' },
];

describe('room note provenance', () => {
  it('attributes only the exact current saved note', () => {
    expect(matchingRoomNoteHistory('check 2 small towels', history)?.id).toBe('new');
    expect(matchingRoomNoteHistory('out 2 bathrobes', history)?.id).toBe('old');
  });

  it('never assigns a stale note timestamp to new or cleared text', () => {
    expect(matchingRoomNoteHistory('Please bring coffee capsules', history)).toBeNull();
    expect(matchingRoomNoteHistory('', history)).toBeNull();
    expect(matchingRoomNoteHistory(null, history)).toBeNull();
  });

  it('normalizes spacing without changing note content', () => {
    expect(matchingRoomNoteHistory(' check  2 small towels\n', history)?.id).toBe('new');
  });

  it('uses Budapest civil time, including seasonal daylight savings', () => {
    expect(formatBudapestNoteTimestamp('2026-10-22T05:47:48Z')).toContain('07:47');
    expect(formatBudapestNoteTimestamp('2026-01-22T05:47:48Z')).toContain('06:47');
    expect(isNoteFromBudapestToday('2026-10-22T05:47:48Z', new Date('2026-10-22T19:00:00Z'))).toBe(true);
    expect(isNoteFromBudapestToday('2026-10-21T05:47:48Z', new Date('2026-10-22T07:00:00Z'))).toBe(false);
  });
});
