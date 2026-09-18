/* A snapshot's had_dnd is an OR-accumulator, not proof of an encounter on its
 * business date. In particular, midnight capture can inherit yesterday's
 * rooms.is_dnd before PMS checkout reconciliation clears it in the morning.
 * Do not change persisted history; interpret it conservatively in the UI. */
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
  // A completed and approved room cannot simultaneously be displayed as an
  // active DND. Preserve conflicting facts visibly rather than rewriting one.
  if (approved && reportedActive) return 'conflict';
  if (reportedActive) return 'active';
  // The assignment counter is date-scoped. had_dnd is NOT: it may be inherited
  // from the previous night's rooms.is_dnd at midnight.
  if (evidenceCount > 0 || (row.dnd_attempt_count ?? 0) > 0) return 'earlier';
  return 'none';
}

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
      return x[i] > y[i];
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

export function isBudapestBusinessDate(timestamp: string, businessDate: string): boolean {
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime())
    && new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Budapest', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date) === businessDate;
}
