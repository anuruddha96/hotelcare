export type RoomNoteHistoryEntry = {
  id: string;
  content: string;
  created_at: string;
  created_by: string | null;
  created_by_name: string | null;
};

const normalizeNote = (value: string | null | undefined): string =>
  String(value || '').replace(/\r\n/g, '\n').trim().replace(/\s+/g, ' ');

/**
 * Room timestamps belong to the exact persisted note, never to a room's
 * unrelated updated_at (which can move during PMS refresh or cleaning).
 * An unmatched historical note is not evidence of when today's text was saved.
 */
export function matchingRoomNoteHistory(
  currentPersistedNote: string | null | undefined,
  history: RoomNoteHistoryEntry[],
): RoomNoteHistoryEntry | null {
  const current = normalizeNote(currentPersistedNote);
  if (!current) return null;
  return history.find((entry) => normalizeNote(entry.content) === current) || null;
}

export function formatBudapestNoteTimestamp(value: string, language = 'en'): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(language === 'hu' ? 'hu-HU' : 'en-GB', {
    timeZone: 'Europe/Budapest',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

export function isNoteFromBudapestToday(value: string, now: Date = new Date()): boolean {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const day = (at: Date) => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Budapest', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(at);
  return day(date) === day(now);
}
