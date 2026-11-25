type SavedAssignmentIdentity = { id: string; assignment_date: string; assigned_to: string };
type SavedSnapshotIdentity = { business_date: string; assignment_id: string | null; assigned_to: string | null };

export function historyWindow(day: string, page: number) {
  const shift = (n: number) => {
    const d = new Date(day + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() - n);
    return d.toISOString().slice(0, 10);
  };
  return { from: shift(page * 30 + 29), to: shift(page * 30) };
}
export function missingAssignmentSnapshots(records: SavedAssignmentIdentity[], snapshots: SavedSnapshotIdentity[]) {
  const saved = new Set(records.map(a => [a.assignment_date, a.id, a.assigned_to].join('|')));
  return snapshots.filter(s => s.assigned_to && !saved.has([s.business_date, s.assignment_id, s.assigned_to].join('|')));
}

/** Keep all ownership events and surviving records, grouped by work date.
 * A saved row's creation time is not the time its current owner was assigned.
 * Never combine or infer a transfer from two saved records. */
export function groupAssignmentHistory<
  A extends { id: number; assignment_date: string; occurred_at: string },
  R extends { id: string; assignment_date: string; created_at: string },
  S extends { business_date: string }
>(events: A[], records: R[], snapshots: S[], selectedDay?: string) {
  const days = new Map<string, { date: string; events: A[]; records: R[]; snapshots: S[] }>();
  function day(date: string) {
    let item = days.get(date);
    if (!item) { item = { date, events: [], records: [], snapshots: [] }; days.set(date, item); }
    return item;
  }
  if (selectedDay) day(selectedDay);
  for (const e of events) day(e.assignment_date).events.push(e);
  for (const r of records) day(r.assignment_date).records.push(r);
  for (const s of snapshots) day(s.business_date).snapshots.push(s);
  return [...days.values()].sort((a,b) => b.date.localeCompare(a.date)).map(d => ({
    ...d,
    events: d.events.sort((a,b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at) || a.id - b.id),
    records: d.records.sort((a,b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id)),
  }));
}
