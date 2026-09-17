import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Header } from '@/components/layout/Header';
import { ExcelRosterDryRun } from '@/components/work-schedule/ExcelRosterDryRun';
import { ExcelRosterSync } from '@/components/work-schedule/ExcelRosterSync';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CalendarDays, ShieldCheck } from 'lucide-react';

type Kind = 'work' | 'off' | 'leave' | 'training' | 'unavailable';
type Shift = {
  id: string; staff_id: string; hotel_id: string; shift_date: string; slot: number;
  kind: Kind; start_local: string | null; end_local: string | null;
  end_day_offset: number; unpaid_break_minutes: number; note: string;
  state: 'draft' | 'published'; version: number; updated_at: string;
};
type Staff = { id: string; full_name: string; role: string };
type Hotel = { hotel_id: string; hotel_name: string };
const MANAGE_ROLES = new Set([
  'admin', 'hr', 'manager', 'top_management', 'top_management_manager',
  'housekeeping_manager', 'maintenance_manager', 'reception_manager',
  'back_office_manager', 'control_manager', 'finance_manager', 'marketing_manager',
]);
const ORG_WIDE_ROLES = new Set(['admin', 'hr']);
const todayBudapest = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Budapest' });
const monthBounds = (month: string) => {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!match) return null;
  const last = new Date(Date.UTC(Number(match[1]), Number(match[2]), 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
};
const plannedHours = (item: Shift) => {
  if (item.kind !== 'work' || !item.start_local || !item.end_local) return 0;
  const minutes = (time: string) => { const [hour, minute] = time.split(':').map(Number); return hour * 60 + minute; };
  return Math.max(0, (minutes(item.end_local) - minutes(item.start_local) + item.end_day_offset * 1440 - item.unpaid_break_minutes) / 60);
};
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

/** RD Hotels dark pilot; database migration and authenticated UAT are required before deployment. */
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
  const resetEditor = () => { setEditing(null); setShiftDate(todayBudapest()); setKind('work'); setStartTime('08:00'); setEndTime('16:00'); setOvernight(false); setBreakMinutes(30); setNote(''); };

  useEffect(() => {
    if (!profile || !manager || profile.organization_slug !== 'rdhotels') return;
    let active = true;
    void (async () => {
      const { data, error: dbError } = await supabase.from('hotel_configurations')
        .select('hotel_id, hotel_name, organizations!inner(slug)')
        .eq('organizations.slug', 'rdhotels');
      if (!active) return;
      if (dbError) { setError(dbError.message); return; }
      const all = (data ?? []) as unknown as Hotel[];
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
      const range = monthBounds(month);
      if (!range) throw new Error('Select a valid month.');
      let staffResult: Staff[] = [];
      if (manager) {
        if (!hotelId) { if (active) { setEntries([]); setStaff([]); setLoading(false); } return; }
        const { data, error: staffError } = await supabase.rpc('work_schedule_staff_for_hotel' as any,
          { p_hotel_id: hotelId });
        if (staffError) throw staffError;
        staffResult = (data ?? []) as Staff[];
      }
      let query = (supabase.from('work_schedule_entries' as any) as any)
        .select('id,staff_id,hotel_id,shift_date,slot,kind,start_local,end_local,end_day_offset,unpaid_break_minutes,note,state,version,updated_at')
        .eq('organization_slug', 'rdhotels').gte('shift_date', range.from).lte('shift_date', range.to)
        .order('shift_date').order('start_local');
      query = manager ? query.eq('hotel_id', hotelId) : query.eq('staff_id', profile.id).eq('state', 'published');
      const { data, error: entriesError } = await query;
      if (entriesError) throw entriesError;
      if (!active) return;
      setStaff(staffResult); setEntries((data ?? []) as Shift[]);
      setStaffId(previous => staffResult.some(person => person.id === previous) ? previous : staffResult[0]?.id ?? '');
    })().catch(caught => { if (active) { setError(message(caught)); setEntries([]); setStaff([]); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user?.id, profile?.id, profile?.organization_slug, manager, hotelId, month, refresh]);

  const bounds = monthBounds(month);
  const byStaff = useMemo(() => new Map(staff.map(person => [person.id, person.full_name])), [staff]);
  const totalHours = useMemo(() => entries.reduce((sum, shift) => sum + plannedHours(shift), 0), [entries]);
  const drafts = entries.filter(shift => shift.state === 'draft').length;
  const editEntry = (entry: Shift) => {
    if (entry.state !== 'draft') return;
    setEditing(entry); setStaffId(entry.staff_id); setShiftDate(entry.shift_date);
    setKind(entry.kind); setStartTime(entry.start_local?.slice(0, 5) ?? '08:00');
    setEndTime(entry.end_local?.slice(0, 5) ?? '16:00');
    setOvernight(entry.end_day_offset === 1); setBreakMinutes(entry.unpaid_break_minutes); setNote(entry.note);
  };
  const changeHotel = (value: string) => {
    if (!hotels.some(hotel => hotel.hotel_id === value)) return;
    setEntries([]); setStaff([]); setStaffId(''); setError(''); setNotice(''); resetEditor(); setHotelId(value);
  };
  const saveDraft = async () => {
    if (!manager || !hotelId || !staffId || !shiftDate || !bounds || busy || loading) return;
    if (kind === 'work' && !overnight && endTime <= startTime) {
      setError('End must be later than start, or mark overnight.'); return;
    }
    if (editing && (editing.staff_id !== staffId || editing.hotel_id !== hotelId)) {
      setError('Cannot reassign a shift to another employee or venue.'); return;
    }
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
      resetEditor(); setRefresh(number => number + 1);
    } catch (caught) { setError(message(caught)); } finally { setBusy(false); }
  };
  const publish = async () => {
    if (!manager || !hotelId || !bounds || drafts === 0 || busy || loading) return;
    if (!window.confirm(`Publish ${drafts} draft shifts for ${month}? Employees will be able to see them. Confirm HR reviewed notice, breaks and rest.`)) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const { data, error: dbError } = await supabase.rpc('work_schedule_publish_range' as any,
        { p_hotel_id: hotelId, p_from: bounds.from, p_to: bounds.to });
      if (dbError) throw dbError;
      setNotice(`${data ?? 0} shifts published. Existing published shifts were not overwritten.`);
      setRefresh(number => number + 1);
    } catch (caught) { setError(message(caught)); } finally { setBusy(false); }
  };

  if (authLoading) return <div className="p-8">Checking access…</div>;
  if (!user || !profile) return <Navigate to={`/${organizationSlug || 'rdhotels'}/auth`} replace />;
  if (profile.organization_slug !== 'rdhotels') return <div className="p-8">This pilot is not enabled for your organization.</div>;
  return <div className="min-h-screen bg-background">
    <Header />
    <main className="container mx-auto max-w-6xl px-3 py-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-2xl font-bold flex items-center gap-2"><CalendarDays />{manager ? 'Work schedule' : 'My schedule'}</h1>
          <p className="text-sm text-muted-foreground">RD Hotels · Budapest time · {manager ? 'Authorized-venue roster' : 'Only your published shifts'}</p></div>
        <Link to={`/${organizationSlug || profile.organization_slug}`} className="text-sm underline">Back to workspace</Link>
      </div>
      <Card className="border-amber-400/60"><CardContent className="pt-4 text-sm">
        <strong>Testing only — not deployed.</strong> The new schema and imported drafts require an approved test database and authenticated UAT before deployment. Excel imports never publish shifts automatically. Planned hours do not represent actual attendance, payroll or verified leave entitlement. Never put diagnoses in roster notes.
      </CardContent></Card>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm font-medium">Month <Input type="month" value={month} onChange={event => { setEntries([]); setMonth(event.target.value); resetEditor(); }} className="mt-1" /></label>
        {manager && <label className="text-sm font-medium">Venue
          <select aria-label="Venue" value={hotelId} onChange={event => changeHotel(event.target.value)}
            disabled={busy} className="mt-1 block h-10 rounded-md border bg-background px-3">
            {hotels.length === 0 && <option value="">No authorized venue</option>}
            {hotels.map(hotel => <option key={hotel.hotel_id} value={hotel.hotel_id}>{hotel.hotel_name}</option>)}
          </select></label>}
        <Button variant="outline" disabled={loading || busy} onClick={() => setRefresh(number => number + 1)}>Refresh</Button>
      </div>
      {error && <div role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">{error}. If the new tables are missing, the pilot has not been deployed.</div>}
      {notice && <div role="status" className="rounded-md border border-green-500 p-3 text-sm">{notice}</div>}
      {loading ? <p>Loading schedule…</p> : <>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Work shifts</p><p className="text-2xl font-bold">{entries.filter(shift => shift.kind === 'work').length}</p></CardContent></Card>
          <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Planned hours</p><p className="text-2xl font-bold">{totalHours.toFixed(1)} h</p></CardContent></Card>
          <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">{manager ? 'Staff scheduled' : 'Days off'}</p><p className="text-2xl font-bold">{manager ? new Set(entries.map(shift => shift.staff_id)).size : entries.filter(shift => shift.kind === 'off').length}</p></CardContent></Card>
          <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">{manager ? 'Draft entries' : 'Published entries'}</p><p className="text-2xl font-bold">{manager ? drafts : entries.length}</p></CardContent></Card>
        </div>
        <Card><CardHeader><CardTitle>{manager ? 'Venue roster' : 'Your shifts'}</CardTitle></CardHeader><CardContent className="space-y-2">
          {entries.length === 0 && <p className="text-sm text-muted-foreground">No {manager ? 'roster entries' : 'published shifts'} found in this month.</p>}
          <div className="max-h-[570px] overflow-auto"><table className="min-w-full text-left text-sm"><thead className="sticky top-0 bg-background"><tr>
            <th className="p-2">Date</th>{manager && <th className="p-2">Employee</th>}<th className="p-2">Shift / status</th><th className="p-2">Hours</th>{manager && <th className="p-2">Action</th>}
          </tr></thead><tbody>{entries.map(shift => <tr key={shift.id} className="border-t">
            <td className="p-2 whitespace-nowrap">{shift.shift_date}</td>{manager && <td className="p-2">{byStaff.get(shift.staff_id) || 'Authorized employee'}</td>}
            <td className="p-2">{shift.kind === 'work' ? `${shift.start_local?.slice(0, 5)}–${shift.end_local?.slice(0, 5)}${shift.end_day_offset ? ' (+1 day)' : ''}` : shift.kind}
              <span className="ml-2"><Badge variant={shift.state === 'published' ? 'default' : 'secondary'}>{shift.state}</Badge></span>
              {shift.note && <p className="text-xs text-muted-foreground">{shift.note}</p>}</td>
            <td className="p-2">{plannedHours(shift).toFixed(1)}</td>{manager && <td className="p-2">{shift.state === 'draft' ? <Button size="sm" variant="outline" disabled={busy} onClick={() => editEntry(shift)}>Edit</Button> : <span className="text-xs text-muted-foreground">Locked</span>}</td>}
          </tr>)}</tbody></table></div>
        </CardContent></Card>
      </>}
      {manager && hotelId && <>
        <Card><CardHeader><CardTitle>{editing ? 'Edit draft shift' : 'Add draft shift'}</CardTitle></CardHeader><CardContent className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="text-sm">Employee<select aria-label="Employee" value={staffId} disabled={Boolean(editing) || loading || busy}
              onChange={event => setStaffId(event.target.value)} className="block mt-1 w-full h-10 border rounded-md bg-background px-2">
              {staff.map(person => <option value={person.id} key={person.id}>{person.full_name} ({person.role})</option>)}
            </select></label>
            <label className="text-sm">Date<Input type="date" className="mt-1" value={shiftDate} onChange={event => setShiftDate(event.target.value)} /></label>
            <label className="text-sm">Type<select aria-label="Shift type" className="block mt-1 w-full h-10 border rounded-md bg-background px-2" value={kind}
              onChange={event => setKind(event.target.value as Kind)}>
              {(['work', 'off', 'leave', 'training', 'unavailable'] as Kind[]).map(value => <option key={value} value={value}>{value}</option>)}
            </select></label>
            {kind === 'work' && <>
              <label className="text-sm">Start<Input type="time" className="mt-1" value={startTime} onChange={event => setStartTime(event.target.value)} /></label>
              <label className="text-sm">End<Input type="time" className="mt-1" value={endTime} onChange={event => setEndTime(event.target.value)} /></label>
              <label className="text-sm">Unpaid break (minutes)<Input type="number" min={0} max={240} className="mt-1" value={breakMinutes} onChange={event => setBreakMinutes(Number(event.target.value))} /></label>
              <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={overnight} onChange={event => setOvernight(event.target.checked)} />Ends next day</label>
            </>}
          </div>
          <label className="block text-sm">Operational note (no health or diagnosis details)<Input value={note} maxLength={500} onChange={event => setNote(event.target.value)} className="mt-1" /></label>
          <div className="flex gap-2"><Button onClick={saveDraft} disabled={busy || loading || !staffId}>{busy ? 'Saving…' : editing ? 'Save draft revision' : 'Add draft'}</Button>
            {editing && <Button variant="outline" disabled={busy} onClick={resetEditor}>Cancel edit</Button>}</div>
        </CardContent></Card>
        <Card><CardHeader><CardTitle>Publish HR-reviewed roster</CardTitle></CardHeader><CardContent className="space-y-2 text-sm">
          <p>Review notice, breaks, rest, conflicts and applicable agreements before publishing. Publication locks entries; employee notifications have not been implemented.</p>
          <Button disabled={busy || loading || drafts === 0} onClick={publish}>Publish {drafts} drafts for {month}</Button>
        </CardContent></Card>
        {!loading && <ExcelRosterDryRun hotelId={hotelId} month={month} staff={staff} />}
        {!loading && <ExcelRosterSync hotelId={hotelId} month={month} staff={staff}
          onImported={() => setRefresh(number => number + 1)} />}
        {orgWide && <Card><CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck />HR analytics and documents — pending</CardTitle></CardHeader><CardContent className="text-sm space-y-2">
          <p>Current metrics are planned shift counts, scheduled staff and planned hours. Actual hours, payroll, leave and sick leave require attendance, contract and verified entitlement reconciliation.</p>
          <p>Contracts and sick certificates are not accepted. Separate private storage, health-document permissions, access logging and retention controls are required before deployment.</p>
        </CardContent></Card>}
      </>}
    </main>
  </div>;
}
