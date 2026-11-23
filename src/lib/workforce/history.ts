/**
 * Change history of the work schedule, read from the audit log, and
 * "restore to a point in time": what each day looked like just before a
 * chosen moment. Pure functions, unit-tested.
 */
import type { ShiftSnapshot, WorkforceEntry, WorkforceKind } from './model';

export interface AuditRow {
  id: number;
  actor_id: string | null;
  action: 'INSERT' | 'UPDATE' | 'DELETE';
  staff_id: string | null;
  work_date: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  created_at: string;
}

export interface HistoryBatch {
  key: string;
  actorId: string | null;
  /** First and last change of the batch (ISO timestamps). */
  from: string;
  until: string;
  rows: AuditRow[];
  staffIds: string[];
  /** Only the status changed on every row: a Publish, not an edit. */
  publishOnly: boolean;
}

const time = (value: unknown) => (typeof value === 'string' && value ? value.slice(0, 5) : null);

/** The shift stored in an audit row's before/after image. */
export function snapshotOf(row: Record<string, unknown> | null | undefined): ShiftSnapshot | null {
  if (!row || !row.kind) return null;
  return {
    kind: row.kind as WorkforceKind, code: (row.code as string | null) ?? null,
    start_time: time(row.start_time), end_time: time(row.end_time),
    day_fraction: Number(row.day_fraction ?? 1), extra_minutes: Number(row.extra_minutes ?? 0),
    hotel_id: (row.hotel_id as string | null) ?? null, note: (row.note as string | null) ?? null,
    worked_minutes: row.worked_minutes == null ? undefined : Number(row.worked_minutes),
  };
}

/** Two days are the same shift for planning purposes (status and bookkeeping ignored). */
export function sameShift(a: ShiftSnapshot | null | undefined, b: ShiftSnapshot | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  return a.kind === b.kind && (a.code ?? null) === (b.code ?? null) && time(a.start_time) === time(b.start_time)
    && time(a.end_time) === time(b.end_time) && Number(a.day_fraction) === Number(b.day_fraction)
    && Number(a.extra_minutes) === Number(b.extra_minutes) && (a.hotel_id ?? null) === (b.hotel_id ?? null)
    && (a.note ?? null) === (b.note ?? null);
}

const isPublishOnly = (row: AuditRow) =>
  row.action === 'UPDATE' && sameShift(snapshotOf(row.before), snapshotOf(row.after)) && row.before?.status !== row.after?.status;

/**
 * Groups audit rows into "what one person did in one go": same person, each
 * change within a minute of the previous one. Newest batch first.
 */
export function groupHistory(rows: AuditRow[], gapMs = 60_000): HistoryBatch[] {
  const sorted = [...rows].sort((a, b) => a.id - b.id);
  const batches: HistoryBatch[] = [];
  for (const row of sorted) {
    const last = batches[batches.length - 1];
    if (last && last.actorId === row.actor_id && Date.parse(row.created_at) - Date.parse(last.until) <= gapMs) {
      last.rows.push(row);
      last.until = row.created_at;
    } else {
      batches.push({ key: String(row.id), actorId: row.actor_id, from: row.created_at, until: row.created_at, rows: [row], staffIds: [], publishOnly: false });
    }
  }
  for (const batch of batches) {
    batch.staffIds = [...new Set(batch.rows.map((r) => r.staff_id).filter(Boolean) as string[])];
    batch.publishOnly = batch.rows.every(isPublishOnly);
  }
  return batches.reverse();
}

export interface RestoreChange { staff_id: string; work_date: string; target: ShiftSnapshot | null; current: ShiftSnapshot | null }

/**
 * The days that differ from how they were just before `rows` happened.
 * `rows` are all audit rows of the period since the chosen moment; the
 * earliest row of each day holds that day's earlier state in `before`.
 * Days nobody touched since then are left alone.
 */
export function restoreChanges(rows: AuditRow[], current: (staffId: string, date: string) => WorkforceEntry | undefined): RestoreChange[] {
  const earliest = new Map<string, AuditRow>();
  for (const row of rows) {
    if (!row.staff_id || !row.work_date) continue;
    const key = `${row.staff_id}|${row.work_date}`;
    const seen = earliest.get(key);
    if (!seen || row.id < seen.id) earliest.set(key, row);
  }
  const out: RestoreChange[] = [];
  for (const row of earliest.values()) {
    const target = row.action === 'INSERT' ? null : snapshotOf(row.before);
    const now = current(row.staff_id!, row.work_date!);
    const nowShift = now ? snapshotOf(now as unknown as Record<string, unknown>) : null;
    if (sameShift(target, nowShift)) continue;
    out.push({ staff_id: row.staff_id!, work_date: row.work_date!, target, current: nowShift });
  }
  return out.sort((a, b) => a.work_date.localeCompare(b.work_date) || a.staff_id.localeCompare(b.staff_id));
}

/** A restored day as a draft entry (the planner checks it, then publishes). */
export function entryFromSnapshot(staffId: string, date: string, shift: ShiftSnapshot): WorkforceEntry {
  return {
    staff_id: staffId, work_date: date, kind: shift.kind, code: shift.code, start_time: time(shift.start_time), end_time: time(shift.end_time),
    day_fraction: Number(shift.day_fraction ?? 1), extra_minutes: Number(shift.extra_minutes ?? 0), hotel_id: shift.hotel_id,
    raw_text: null, note: shift.note, status: 'draft',
  };
}
