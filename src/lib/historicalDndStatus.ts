/* A snapshot's had_dnd is an OR-accumulator, not proof of an encounter on its
 * business date. A midnight capture can inherit yesterday's rooms.is_dnd
 * before PMS checkout reconciliation clears it the next morning.
 * Never change persisted history to correct its presentation. */
export interface HistoricalDndInput {
  is_dnd: boolean | null;
  had_dnd: boolean | null;
  dnd_attempt_count: number | null;
  assignment_status: string | null;
  supervisor_approved: boolean | null;
}

export type HistoricalDndState = 'none' | 'active' | 'earlier' | 'conflict';

/** evidenceCount includes only DND photos belonging to THIS day's assignment. */
export function historicalDndState(row: HistoricalDndInput, evidenceCount: number): HistoricalDndState {
  const approved = row.assignment_status === 'completed' && row.supervisor_approved === true;
  const reportedActive = row.is_dnd === true || row.assignment_status === 'dnd_pending_retry';
  const datedAttempt = evidenceCount > 0 || (row.dnd_attempt_count ?? 0) > 0;
  // Approval of a DND/no-entry outcome is possible. Keep the day's documented
  // encounter, but never render it as an ACTIVE DND on an approved task.
  if (approved && reportedActive) return datedAttempt ? 'earlier' : 'conflict';
  if (reportedActive) return 'active';
  // An assignment counter and photos are dated; had_dnd alone is not.
  if (datedAttempt) return 'earlier';
  return 'none';
}

/** Stable venue-scoped snapshot choice, independent of backend row ordering. */
export function selectSavedSnapshot<T extends {
  hotel: string;
  room_number: string;
  room_id: string;
  source: string | null;
  captured_at: string | null;
  updated_at: string | null;
}>(rows: T[], preferredHotel: string): T[] {
  const byNumber = new Map<string, T>();
  const rank = (r: T) => [
    r.hotel === preferredHotel ? 1 : 0,
    r.source === 'live_capture' ? 1 : 0,
    Date.parse(r.updated_at || r.captured_at || '') || 0,
    r.room_id,
  ] as const;
  const better = (a: T, b: T): boolean => {
    const x = rank(a), y = rank(b);
    for (let i = 0; i < x.length; i++) {
      if (x[i] === y[i]) continue;
      return String(x[i]) > String(y[i]);
    }
    return false;
  };
  for (const row of rows) {
    const key = row.room_number.trim();
    const previous = byNumber.get(key);
    if (!previous || better(row, previous)) byNumber.set(key, row);
  }
  return [...byNumber.values()].sort((a, b) => a.room_number.localeCompare(b.room_number, undefined, { numeric: true }));
}

/** Midnight UTC can already belong to the next Budapest business date. */
export function isBudapestBusinessDate(timestamp: string, businessDate: string): boolean {
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime())
    && new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Budapest', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date) === businessDate;
}
