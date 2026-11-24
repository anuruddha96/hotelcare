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
