import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import type {
  ChangeNotice, WorkforceDepartment, WorkforceEntry, WorkforceJobRole, WorkforceShiftCode, WorkforceStaff,
} from '@/lib/workforce/model';
import { pad2 } from '@/lib/workforce/model';

// The workforce tables are newer than the generated Supabase types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export const entryKey = (staffId: string, date: string) => `${staffId}|${date}`;

const BASE_ENTRY_COLUMNS = 'id,staff_id,work_date,kind,code,start_time,end_time,day_fraction,extra_minutes,hotel_id,raw_text,note,worked_minutes,status,updated_by';
/** `published_version` arrives with the work-schedule v2 database update; until then the screen works without it. */
let entryColumns = `${BASE_ENTRY_COLUMNS},published_version`;
const missingColumn = (error: unknown) => /published_version/.test(String((error as { message?: string } | null)?.message ?? ''));
const BASE_STAFF_COLUMNS = 'id,full_name,nickname,department_id,job_role_id,hotel_id,profile_id,employment_type,daily_hours,annual_leave_days,leave_note,start_date,end_date,is_active,sort_order,notes,source_label';
/** Phone and e-mail arrive with a later database update; until then they are simply not read. */
let staffColumns = `${BASE_STAFF_COLUMNS},phone,email`;
const missingContact = (error: unknown) => /\b(phone|email)\b/.test(String((error as { message?: string } | null)?.message ?? ''));
export const staffContactAvailable = () => staffColumns !== BASE_STAFF_COLUMNS;
const NOTICE_COLUMNS = 'id,staff_id,work_date,before,after,short_notice,reason,changed_at,changed_by,acknowledged_at';

/** PostgREST returns at most 1000 rows per request; read in pages. */
export async function fetchAllRows<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>, pageSize = 1000): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) return rows;
  }
}

const trimTime = (t: string | null) => (t ? t.slice(0, 5) : null);
const normalizeEntry = (row: WorkforceEntry): WorkforceEntry => ({
  ...row, start_time: trimTime(row.start_time), end_time: trimTime(row.end_time),
  day_fraction: Number(row.day_fraction ?? 1), extra_minutes: Number(row.extra_minutes ?? 0),
});

export interface WorkforceProfileOption { id: string; full_name: string | null; nickname: string | null; role: string | null; assigned_hotel: string | null }

export interface WorkforceData {
  loading: boolean;
  error: string | null;
  departments: WorkforceDepartment[];
  jobRoles: WorkforceJobRole[];
  shiftCodes: WorkforceShiftCode[];
  staff: WorkforceStaff[];
  entries: Map<string, WorkforceEntry>;
  notes: Map<string, string>;
  /** Leave days used this calendar year up to the end of the shown month, per employee. */
  leaveUsed: Map<string, number>;
  /** Published days that changed and the employee has not confirmed yet (this month). */
  notices: ChangeNotice[];
  setChangeReason: (ids: string[], reason: string) => Promise<void>;
  reload: () => Promise<void>;
  saveEntries: (rows: WorkforceEntry[]) => Promise<void>;
  deleteEntries: (keys: Array<{ staff_id: string; work_date: string }>) => Promise<void>;
  publish: (from: string, to: string, staffIds?: string[]) => Promise<number>;
  saveStaff: (row: Partial<WorkforceStaff> & { full_name: string }) => Promise<WorkforceStaff>;
  saveNote: (staffId: string, note: string) => Promise<void>;
  saveReference: (table: 'workforce_departments' | 'workforce_job_roles' | 'workforce_shift_codes', row: Record<string, unknown>) => Promise<void>;
  /** Moves staff and job roles of one department into another and retires it. */
  mergeDepartment: (fromId: string, intoId: string) => Promise<void>;
}

export function useWorkforce(year: number, month: number): WorkforceData {
  const { profile } = useAuth();
  const org = profile?.organization_slug ?? null;
  const hotel = profile?.assigned_hotel ?? null;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [departments, setDepartments] = useState<WorkforceDepartment[]>([]);
  const [jobRoles, setJobRoles] = useState<WorkforceJobRole[]>([]);
  const [shiftCodes, setShiftCodes] = useState<WorkforceShiftCode[]>([]);
  const [staff, setStaff] = useState<WorkforceStaff[]>([]);
  const [entries, setEntries] = useState<Map<string, WorkforceEntry>>(new Map());
  const [notes, setNotes] = useState<Map<string, string>>(new Map());
  const [leaveUsed, setLeaveUsed] = useState<Map<string, number>>(new Map());
  const [notices, setNotices] = useState<ChangeNotice[]>([]);
  const request = useRef(0);

  const from = `${year}-${pad2(month)}-01`;
  const to = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);

  const loadNotices = useCallback(async () => {
    const { data, error: err } = await db.from('workforce_change_notices').select(NOTICE_COLUMNS)
      .is('acknowledged_at', null).gte('work_date', from).lte('work_date', to).order('work_date');
    // Before the database update the table does not exist: no notices.
    setNotices(err ? [] : (data ?? []));
  }, [from, to]);

  const reload = useCallback(async () => {
    if (!org) return;
    const id = ++request.current;
    setLoading(true);
    setError(null);
    try {
      const [d, r, c, s, e, n, l] = await Promise.all([
        db.from('workforce_departments').select('id,name,color,sort_order,is_active').order('sort_order').order('name'),
        db.from('workforce_job_roles').select('id,department_id,name,sort_order,is_active').order('sort_order').order('name'),
        db.from('workforce_shift_codes').select('id,code,label,kind,start_time,end_time,day_fraction,hotel_id,sort_order,is_active').order('sort_order'),
        (async () => {
          const read = () => fetchAllRows<WorkforceStaff>((a, b) => db.from('workforce_staff').select(staffColumns)
            .order('sort_order').order('full_name').range(a, b));
          try { return await read(); } catch (err) {
            if (!missingContact(err)) throw err;
            staffColumns = BASE_STAFF_COLUMNS;
            return read();
          }
        })(),
        (async () => {
          const read = () => fetchAllRows<WorkforceEntry>((a, b) => db.from('workforce_entries').select(entryColumns)
            .gte('work_date', from).lte('work_date', to).order('work_date').order('staff_id').range(a, b));
          try { return await read(); } catch (err) {
            if (!missingColumn(err)) throw err;
            entryColumns = BASE_ENTRY_COLUMNS;
            return read();
          }
        })(),
        db.from('workforce_staff_notes').select('staff_id,note').eq('month', from),
        fetchAllRows<{ staff_id: string; kind: string }>((a, b) => db.from('workforce_entries').select('staff_id,kind')
          .in('kind', ['leave', 'half_leave']).gte('work_date', `${year}-01-01`).lte('work_date', to).order('id').range(a, b)),
      ]);
      for (const res of [d, r, c, n]) if (res.error) throw res.error;
      if (id !== request.current) return;
      setDepartments(d.data ?? []);
      setJobRoles(r.data ?? []);
      setShiftCodes((c.data ?? []).map((x: WorkforceShiftCode) => ({ ...x, start_time: trimTime(x.start_time), end_time: trimTime(x.end_time), day_fraction: Number(x.day_fraction) })));
      setStaff(s.map((x) => ({ ...x, daily_hours: Number(x.daily_hours ?? 8), annual_leave_days: x.annual_leave_days == null ? null : Number(x.annual_leave_days) })));
      setEntries(new Map(e.map((x) => [entryKey(x.staff_id, x.work_date), normalizeEntry(x)])));
      setNotes(new Map((n.data ?? []).map((x: { staff_id: string; note: string }) => [x.staff_id, x.note])));
      const used = new Map<string, number>();
      for (const x of l) used.set(x.staff_id, (used.get(x.staff_id) ?? 0) + (x.kind === 'half_leave' ? 0.5 : 1));
      setLeaveUsed(used);
      void loadNotices();
    } catch (err) {
      if (id === request.current) setError(err instanceof Error ? err.message : (err as { message?: string })?.message ?? 'Could not load the schedule');
    } finally {
      if (id === request.current) setLoading(false);
    }
    // hotel: property managers see the hotel they are currently signed in to.
  }, [org, from, to, year, hotel, loadNotices]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void reload(); }, [reload]);

  const saveEntries = useCallback(async (rows: WorkforceEntry[]) => {
    if (!rows.length) return;
    // Bookkeeping columns are set by the database (published version, last editor).
    const payload = rows.map(({ id: _id, worked_minutes: _w, published_version: _p, updated_by: _u, ...rest }) => rest);
    const saved: WorkforceEntry[] = [];
    for (let i = 0; i < payload.length; i += 500) {
      const { data, error: err } = await db.from('workforce_entries')
        .upsert(payload.slice(i, i + 500), { onConflict: 'staff_id,work_date' }).select(entryColumns);
      if (err) throw err;
      saved.push(...(data ?? []));
    }
    setEntries((prev) => {
      const next = new Map(prev);
      for (const row of saved) if (row.work_date >= from && row.work_date <= to) next.set(entryKey(row.staff_id, row.work_date), normalizeEntry(row));
      return next;
    });
  }, [from, to]);

  const deleteEntries = useCallback(async (keys: Array<{ staff_id: string; work_date: string }>) => {
    if (!keys.length) return;
    const byStaff = new Map<string, string[]>();
    for (const k of keys) byStaff.set(k.staff_id, [...(byStaff.get(k.staff_id) ?? []), k.work_date]);
    for (const [staffId, dates] of byStaff) {
      const { error: err } = await db.from('workforce_entries').delete().eq('staff_id', staffId).in('work_date', dates);
      if (err) throw err;
    }
    setEntries((prev) => {
      const next = new Map(prev);
      for (const k of keys) next.delete(entryKey(k.staff_id, k.work_date));
      return next;
    });
    // Removing a published day is announced to the employee straight away.
    void db.rpc('workforce_push_change_notices').then(() => loadNotices(), () => undefined);
  }, [loadNotices]);

  const publish = useCallback(async (start: string, end: string, staffIds?: string[]) => {
    const { data, error: err } = await db.rpc('workforce_publish', { _from: start, _to: end, _staff_ids: staffIds?.length ? staffIds : null });
    if (err) throw err;
    setEntries((prev) => {
      const next = new Map(prev);
      const only = staffIds?.length ? new Set(staffIds) : null;
      for (const [k, v] of next) if (v.status === 'draft' && v.work_date >= start && v.work_date <= end && (!only || only.has(v.staff_id))) next.set(k, { ...v, status: 'published', published_version: null });
      return next;
    });
    void loadNotices();
    return Number(data ?? 0);
  }, [loadNotices]);

  const setChangeReason = useCallback(async (ids: string[], reason: string) => {
    if (!ids.length) return;
    const { error: err } = await db.rpc('workforce_set_change_reason', { _ids: ids, _reason: reason });
    if (err) throw err;
    const text = reason.trim() || null;
    setNotices((prev) => prev.map((n) => (ids.includes(n.id) ? { ...n, reason: text } : n)));
  }, []);

  const saveStaff = useCallback(async (row: Partial<WorkforceStaff> & { full_name: string }) => {
    const payload: Record<string, unknown> = { ...row, organization_slug: org };
    if (!staffContactAvailable()) { delete payload.phone; delete payload.email; }
    const query = row.id
      ? db.from('workforce_staff').update(payload).eq('id', row.id)
      : db.from('workforce_staff').insert(payload);
    const { data, error: err } = await query.select('*').single();
    if (err) throw err;
    const saved = { ...data, daily_hours: Number(data.daily_hours), annual_leave_days: data.annual_leave_days == null ? null : Number(data.annual_leave_days) } as WorkforceStaff;
    setStaff((prev) => (prev.some((s) => s.id === saved.id) ? prev.map((s) => (s.id === saved.id ? saved : s)) : [...prev, saved]));
    return saved;
  }, [org]);

  const saveNote = useCallback(async (staffId: string, note: string) => {
    if (note.trim()) {
      const { error: err } = await db.from('workforce_staff_notes')
        .upsert({ staff_id: staffId, month: from, organization_slug: org, note: note.trim() }, { onConflict: 'staff_id,month' });
      if (err) throw err;
    } else {
      const { error: err } = await db.from('workforce_staff_notes').delete().eq('staff_id', staffId).eq('month', from);
      if (err) throw err;
    }
    setNotes((prev) => { const next = new Map(prev); if (note.trim()) next.set(staffId, note.trim()); else next.delete(staffId); return next; });
  }, [from, org]);

  const saveReference = useCallback(async (table: 'workforce_departments' | 'workforce_job_roles' | 'workforce_shift_codes', row: Record<string, unknown>) => {
    const payload = { ...row, organization_slug: org };
    const { error: err } = row.id
      ? await db.from(table).update(payload).eq('id', row.id)
      : await db.from(table).insert(payload);
    if (err) throw err;
    await reload();
  }, [org, reload]);

  const mergeDepartment = useCallback(async (fromId: string, intoId: string) => {
    if (fromId === intoId) return;
    const target = new Map(jobRoles.filter((r) => r.department_id === intoId).map((r) => [r.name.trim().toLowerCase(), r.id]));
    for (const role of jobRoles.filter((r) => r.department_id === fromId)) {
      const same = target.get(role.name.trim().toLowerCase());
      if (same) {
        // Same role name exists in the target: move people onto it and retire the duplicate.
        const { error: e1 } = await db.from('workforce_staff').update({ job_role_id: same }).eq('job_role_id', role.id);
        if (e1) throw e1;
        const { error: e2 } = await db.from('workforce_job_roles').update({ is_active: false, name: `${role.name} (merged)` }).eq('id', role.id);
        if (e2) throw e2;
      } else {
        const { error: e3 } = await db.from('workforce_job_roles').update({ department_id: intoId }).eq('id', role.id);
        if (e3) throw e3;
      }
    }
    const { error: e4 } = await db.from('workforce_staff').update({ department_id: intoId }).eq('department_id', fromId);
    if (e4) throw e4;
    const { error: e5 } = await db.from('workforce_departments').update({ is_active: false }).eq('id', fromId);
    if (e5) throw e5;
    await reload();
  }, [jobRoles, reload]);

  return useMemo(() => ({
    loading, error, departments, jobRoles, shiftCodes, staff, entries, notes, leaveUsed, notices,
    reload, saveEntries, deleteEntries, publish, saveStaff, saveNote, saveReference, mergeDepartment, setChangeReason,
  }), [loading, error, departments, jobRoles, shiftCodes, staff, entries, notes, leaveUsed, notices, reload, saveEntries, deleteEntries, publish, saveStaff, saveNote, saveReference, mergeDepartment, setChangeReason]);
}
