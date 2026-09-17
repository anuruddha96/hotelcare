import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Header } from '@/components/layout/Header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CalendarDays, FileSpreadsheet, ShieldCheck } from 'lucide-react';

type Kind = 'work' | 'off' | 'leave' | 'training' | 'unavailable';
type Shift = {
  id: string; staff_id: string; hotel_id: string; shift_date: string; slot: number;
  kind: Kind; start_local: string | null; end_local: string | null;
  end_day_offset: number; unpaid_break_minutes: number; note: string;
  state: 'draft' | 'published'; version: number; updated_at: string;
};
type Staff = { id: string; full_name: string; role: string };
type Hotel = { hotel_id: string; hotel_name: string };
type Preview = { filename: string; sheets: { name: string; staffColumns: number; days: number; nonemptyCells: number; sampleTokens: string[] }[] };

const MANAGE_ROLES = new Set([
  'admin', 'hr', 'manager', 'top_management', 'top_management_manager',
  'housekeeping_manager', 'maintenance_manager', 'reception_manager',
  'back_office_manager', 'control_manager', 'finance_manager', 'marketing_manager',
]);
const ORG_WIDE_ROLES = new Set(['admin', 'hr']);
const todayBudapest = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Budapest' });
const monthBounds = (month: string) => {
  const [year, mm] = month.split('-').map(Number);
  const last = new Date(Date.UTC(year, mm, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
};
const plannedHours = (item: Shift) => {
  if (item.kind !== 'work' || !item.start_local || !item.end_local) return 0;
  const time = (value: string) => { const [h, m] = value.split(':').map(Number); return h * 60 + m; };
  return Math.max(0, (time(item.end_local) - time(item.start_local) + item.end_day_offset * 1440 - item.unpaid_break_minutes) / 60);
};
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

/** Dark RD-only pilot. The database migration and its RLS/RPCs must be deployed after UAT. */
export default function WorkSchedule() {
  const { user, profile, loading: authLoading } = useAuth();
  const { organizationSlug } = useParams<{ organizationSlug: string }>();
  const manager = Boolean(profile && MANAGE_ROLES.has(profile.role));
  const orgWide = Boolean(profile && ORG_WIDE_ROLES.has(profile.role));
  const [month, setMonth] = useState(todayBudapest().slice(0, 7));
  const [hotels, setHotels] = useState<Hotel[]>([]);
  const [hotelId, setHotelId] = useState('');
  const [staff, setStaff] = useState<Staff[]>([]);
  const [entries, setEntries] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [staffId, setStaffId] = useState('');
  const [shiftDate, setShiftDate] = useState(todayBudapest());
  const [kind, setKind] = useState<Kind>('work');
  const [startTime, setStartTime] = useState('08:00');
  const [endTime, setEndTime] = useState('16:00');
  const [overnight, setOvernight] = useState(false);
  const [breakMinutes, setBreakMinutes] = useState(30);
  const [note, setNote] = useState('');
  const [editing, setEditing] = useState<Shift | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);

  useEffect(() => {
    if (!profile || !manager || profile.organization_slug !== 'rdhotels') return;
    let active = true;
    void (async () => {
      const { data, error: dbError } = await supabase.from('hotel_configurations')
        .select('hotel_id, hotel_name, organizations!inner(slug)')
        .eq('organizations.slug', 'rdhotels');
      if (!active) return;
      if (dbError) { setError(dbError.message); return; }
      const all = ((data ?? []) as unknown as Hotel[]);
      const allowed = orgWide ? all : all.filter(h =>
        h.hotel_id === profile.assigned_hotel || h.hotel_name === profile.assigned_hotel);
      setHotels(allowed);
      setHotelId(current => allowed.some(h => h.hotel_id === current) ? current : allowed[0]?.hotel_id ?? '');
    })();
    return () => { active = false; };
  }, [profile?.id, profile?.organization_slug, profile?.role, profile?.assigned_hotel, manager, orgWide]);

  useEffect(() => {
    if (!profile || !user || profile.organization_slug !== 'rdhotels') return;
    let active = true;
    setLoading(true); setError('');
    void (async () => {
      const { from, to } = monthBounds(month);
      let staffResult: Staff[] = [];
      if (manager) {
        if (!hotelId) { if (active) { setEntries([]); setStaff([]); setLoading(false); } return; }
        const { data, error: staffError } = await supabase.rpc('work_schedule_staff_for_hotel' as any, { p_hotel_id: hotelId });
        if (staffError) throw staffError;
        staffResult = (data ?? []) as Staff[];
      }
      let query = (supabase.from('work_schedule_entries' as any) as any)
        .select('id,staff_id,hotel_id,shift_date,slot,kind,start_local,end_local,end_day_offset,unpaid_break_minutes,note,state,version,updated_at')
        .eq('organization_slug', 'rdhotels').gte('shift_date', from).lte('shift_date', to)
        .order('shift_date').order('start_local');
      query = manager ? query.eq('hotel_id', hotelId) : query.eq('staff_id', profile.id).eq('state', 'published');
      const { data, error: entriesError } = await query;
      if (entriesError) throw entriesError;
      if (!active) return;
      setStaff(staffResult); setEntries((data ?? []) as Shift[]);
      setStaffId(previous => staffResult.some(s => s.id === previous) ? previous : staffResult[0]?.id ?? '');
    })().catch(e => { if (active) { setError(message(e)); setEntries([]); setStaff([]); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user?.id, profile?.id, profile?.organization_slug, manager, hotelId, month, refresh]);

  const { from, to } = monthBounds(month);
  const byStaff = useMemo(() => new Map(staff.map(s => [s.id, s.full_name])), [staff]);
  const totalHours = useMemo(() => entries.reduce((sum, e) => sum + plannedHours(e), 0), [entries]);
  const drafts = entries.filter(e => e.state === 'draft').length;
  const resetEditor = () => { setEditing(null); setShiftDate(todayBudapest()); setKind('work'); setStartTime('08:00'); setEndTime('16:00'); setOvernight(false); setBreakMinutes(30); setNote(''); };
  const editEntry = (entry: Shift) => {
    if (entry.state !== 'draft') return;
    setEditing(entry); setStaffId(entry.staff_id); setShiftDate(entry.shift_date);
    setKind(entry.kind); setStartTime(entry.start_local?.slice(0, 5) ?? '08:00');
    setEndTime(entry.end_local?.slice(0, 5) ?? '16:00');
    setOvernight(entry.end_day_offset === 1); setBreakMinutes(entry.unpaid_break_minutes); setNote(entry.note);
  };
  const saveDraft = async () => {
    if (!manager || !hotelId || !staffId || !shiftDate) return;
    if (kind === 'work' && !overnight && endTime <= startTime) { setError('End must be later than start, or mark overnight.'); return; }
    if (editing && (editing.staff_id !== staffId || editing.hotel_id !== hotelId)) { setError('Cannot reassign a shift to another employee or venue.'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      const { error: dbError } = await supabase.rpc('work_schedule_save_draft' as any, {
        p_hotel_id: hotelId, p_staff_id: staffId, p_shift_date: shiftDate, p_slot: editing?.slot ?? 1,
        p_kind: kind, p_start_local: kind === 'work' ? startTime : null,
        p_end_local: kind === 'work' ? endTime : null,
        p_end_day_offset: kind === 'work' && overnight ? 1 : 0,
        p_unpaid_break_minutes: kind === 'work' ? breakMinutes : 0,
        p_note: note, p_entry_id: editing?.id ?? null,
        p_expected_version: editing?.version ?? null, p_source: 'manual',
      });
      if (dbError) throw dbError;
      setNotice('Draft saved and audited. Employees cannot see it until published.');
      resetEditor(); setRefresh(n => n + 1);
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  };
  const publish = async () => {
    if (!manager || !hotelId || drafts === 0) return;
    if (!window.confirm(`Publish ${drafts} draft shifts for ${month}? Employees will be able to see them. Confirm that HR has reviewed roster notice, breaks and rest.`)) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const { data, error: dbError } = await supabase.rpc('work_schedule_publish_range' as any,
        { p_hotel_id: hotelId, p_from: from, p_to: to });
      if (dbError) throw dbError;
      setNotice(`${data ?? 0} shifts published. Existing published shifts were not overwritten.`);
      setRefresh(n => n + 1);
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  };
  const previewExcel = async (file: File | undefined) => {
    setPreview(null); setError('');
    if (!file) return;
    if (!/\.(xlsx|xls)$/i.test(file.name) || file.size > 8 * 1024 * 1024) {
      setError('Select an XLS/XLSX file of at most 8 MB.'); return;
    }
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', bookVBA: false, cellDates: false });
      const sheets = workbook.SheetNames.map(name => {
        const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name],
          { header: 1, raw: false, defval: '' });
        const people = (rows[1] ?? []).slice(2).filter(v => String(v ?? '').trim());
        const dayRows = rows.slice(2).filter(r => /^(?:[1-9]|[12]\d|3[01])$/.test(String(r?.[0] ?? '').trim()));
        const tokens = dayRows.flatMap(r => r.slice(2).map(v => String(v ?? '').trim()).filter(Boolean));
        return { name, staffColumns: people.length, days: dayRows.length, nonemptyCells: tokens.length,
          sampleTokens: [...new Set(tokens)].slice(0, 12) };
      });
      setPreview({ filename: file.name, sheets });
    } catch (e) { setError(`Could not preview this workbook: ${message(e)}`); }
  };

  if (authLoading) return <div className="p-8">Checking access…</div>;
  if (!user || !profile) return <Navigate to={`/${organizationSlug || 'rdhotels'}/auth`} replace />;
  if (profile.organization_slug !== 'rdhotels' && !profile.is_super_admin) return <div className="p-8">The pilot is not enabled for this organization.</div>;
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto max-w-6xl px-3 py-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h1 className="text-2xl font-bold flex items-center gap-2"><CalendarDays />{manager ? 'Work schedule' : 'My schedule'}</h1>
            <p className="text-sm text-muted-foreground">RD Hotels · Budapest time · {manager ? 'Authorized-venue drafts and publication' : 'Your published shifts only'}</p></div>
          <Link to={`/${organizationSlug || profile.organization_slug}`} className="text-sm underline">Back to workspace</Link>
        </div>
        <Card className="border-amber-400/60"><CardContent className="pt-4 text-sm">
          <strong>Testing feature — not live.</strong> The GitHub schema must be applied to an approved test environment before this page can load data. Excel is preview-only in this first phase; never enter medical diagnoses in roster notes. Planned hours are not attendance, payroll or verified holiday entitlement.
        </CardContent></Card>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm font-medium">Month <Input type="month" value={month} onChange={e => setMonth(e.target.value)} className="mt-1" /></label>
          {manager && <label className="text-sm font-medium">Venue
            <select aria-label="Venue" value={hotelId} onChange={e => { setHotelId(e.target.value); resetEditor(); }} className="mt-1 block h-10 rounded-md border bg-background px-3">
              {hotels.length === 0 && <option value="">No authorized venue</option>}
              {hotels.map(h => <option key={h.hotel_id} value={h.hotel_id}>{h.hotel_name}</option>)}
            </select></label>}
          <Button variant="outline" disabled={loading} onClick={() => setRefresh(n => n + 1)}>Refresh</Button>
        </div>
        {error && <div role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">{error}. If the work-schedule tables are missing, this test feature has not been deployed.</div>}
        {notice && <div role="status" className="rounded-md border border-green-500 p-3 text-sm">{notice}</div>}
        {loading ? <p>Loading schedule…</p> : <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Shifts</p><p className="text-2xl font-bold">{entries.filter(e => e.kind === 'work').length}</p></CardContent></Card>
            <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Planned hours only</p><p className="text-2xl font-bold">{totalHours.toFixed(1)} h</p></CardContent></Card>
            <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">{manager ? 'Staff scheduled' : 'Days off'}</p><p className="text-2xl font-bold">{manager ? new Set(entries.map(e => e.staff_id)).size : entries.filter(e => e.kind === 'off').length}</p></CardContent></Card>
            <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">{manager ? 'Unpublished drafts' : 'Published shifts'}</p><p className="text-2xl font-bold">{manager ? drafts : entries.length}</p></CardContent></Card>
          </div>
          <Card><CardHeader><CardTitle>{manager ? 'Venue schedule' : 'Your shifts'}</CardTitle></CardHeader><CardContent className="space-y-2">
            {entries.length === 0 && <p className="text-sm text-muted-foreground">No {manager ? 'draft or published entries' : 'published shifts'} this month.</p>}
            <div className="max-h-[570px] overflow-auto"><table className="min-w-full text-sm text-left"><thead className="sticky top-0 bg-background"><tr>
              <th className="p-2">Date</th>{manager && <th className="p-2">Employee</th>}<th className="p-2">Shift / status</th><th className="p-2">Hours</th>{manager && <th className="p-2">Action</th>}
            </tr></thead><tbody>{entries.map(e => <tr key={e.id} className="border-t">
              <td className="p-2 whitespace-nowrap">{e.shift_date}</td>{manager && <td className="p-2">{byStaff.get(e.staff_id) || 'Authorized employee'}</td>}
              <td className="p-2">{e.kind === 'work' ? `${e.start_local?.slice(0,5)}–${e.end_local?.slice(0,5)}${e.end_day_offset ? ' (+1 day)' : ''}` : e.kind}
                <span className="ml-2"><Badge variant={e.state === 'published' ? 'default' : 'secondary'}>{e.state}</Badge></span>
                {e.note && <p className="text-xs text-muted-foreground">{e.note}</p>}</td>
              <td className="p-2">{plannedHours(e).toFixed(1)}</td>{manager && <td className="p-2">{e.state === 'draft' ? <Button size="sm" variant="outline" onClick={() => editEntry(e)}>Edit</Button> : <span className="text-xs text-muted-foreground">Locked</span>}</td>}
            </tr>)}</tbody></table></div>
          </CardContent></Card>
        </>}
        {manager && hotelId && <>
          <Card><CardHeader><CardTitle>{editing ? 'Edit draft shift' : 'Add draft shift'}</CardTitle></CardHeader><CardContent className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="text-sm">Employee<select aria-label="Employee" value={staffId} disabled={Boolean(editing)} onChange={e => setStaffId(e.target.value)} className="block mt-1 w-full h-10 border rounded-md bg-background px-2">
                {staff.map(s => <option value={s.id} key={s.id}>{s.full_name} ({s.role})</option>)}
              </select></label>
              <label className="text-sm">Date<Input type="date" className="mt-1" value={shiftDate} onChange={e => setShiftDate(e.target.value)} /></label>
              <label className="text-sm">Type<select aria-label="Shift type" className="block mt-1 w-full h-10 border rounded-md bg-background px-2" value={kind} onChange={e => setKind(e.target.value as Kind)}>
                {(['work','off','leave','training','unavailable'] as Kind[]).map(v => <option key={v} value={v}>{v}</option>)}
              </select></label>
              {kind === 'work' && <>
                <label className="text-sm">Start<Input type="time" className="mt-1" value={startTime} onChange={e => setStartTime(e.target.value)} /></label>
                <label className="text-sm">End<Input type="time" className="mt-1" value={endTime} onChange={e => setEndTime(e.target.value)} /></label>
                <label className="text-sm">Unpaid break (minutes)<Input type="number" min={0} max={240} className="mt-1" value={breakMinutes} onChange={e => setBreakMinutes(Number(e.target.value))} /></label>
                <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={overnight} onChange={e => setOvernight(e.target.checked)} />Ends next day</label>
              </>}
            </div>
            <label className="block text-sm">Operational note (no health or diagnosis information)<Input value={note} maxLength={500} onChange={e => setNote(e.target.value)} className="mt-1" /></label>
            <div className="flex gap-2"><Button onClick={saveDraft} disabled={busy || !staffId}>{busy ? 'Saving…' : editing ? 'Save draft revision' : 'Add draft'}</Button>
              {editing && <Button variant="outline" onClick={resetEditor}>Cancel edit</Button>}</div>
          </CardContent></Card>
          <Card><CardHeader><CardTitle>Publish approved roster</CardTitle></CardHeader><CardContent className="space-y-2 text-sm">
            <p>Review scheduling notice, rest periods, applicable agreements and conflicting shifts with HR before publishing. Publishing locks entries; there is no automatic employee notification yet.</p>
            <Button disabled={busy || drafts === 0} onClick={publish}>Publish {drafts} draft entries for {month}</Button>
          </CardContent></Card>
          <Card><CardHeader><CardTitle className="flex items-center gap-2"><FileSpreadsheet />Excel file inspection (preview only)</CardTitle></CardHeader><CardContent className="space-y-3 text-sm">
            <p>Inspect a local XLS/XLSX without uploading names, hours or documents to the server. The legacy workbook has ambiguous shift/leave codes and multi-property assignments: imports are disabled until explicit employee mapping, code definitions and an atomic dry-run are implemented.</p>
            <Input type="file" accept=".xls,.xlsx" onChange={e => void previewExcel(e.target.files?.[0])} />
            {preview && <div className="space-y-2"><p className="font-medium">{preview.filename} — {preview.sheets.length} sheets</p>
              {preview.sheets.map(s => <div key={s.name} className="rounded-md border p-2"><strong>{s.name}</strong>: {s.staffColumns} named columns, {s.days} day rows, {s.nonemptyCells} non-empty cells.
                <p className="text-xs text-muted-foreground">Sample source values: {s.sampleTokens.join(' · ') || 'none'} (not yet interpreted)</p></div>)}
            </div>}
          </CardContent></Card>
          {orgWide && <Card><CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck />HR analytics and documents — next controlled phase</CardTitle></CardHeader><CardContent className="text-sm space-y-2">
            <p>Current analytics show planned shift counts, staff scheduled and planned hours for the selected authorized venue. Actual hours, payroll, annual leave and sick leave must be reconciled with attendance, contracts and HR-approved entitlements.</p>
            <p>Contracts and sick certificates are not accepted in this preview. They require private storage, a separate health-document entitlement, access logging and retention settings before deployment.</p>
          </CardContent></Card>}
        </>}
      </main>
    </div>
  );
}
