import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { addDays, addWeeks, format, startOfWeek, subWeeks } from 'date-fns';
import { CalendarDays, Check, ChevronLeft, ChevronRight, Clock, Copy, MapPin, Search, Send, Settings2, Users } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useVenues } from '@/hooks/useVenues';
import { resolveCanonicalHotelId, resolveHotelKeys } from '@/lib/hotelKeys';
import { todayBudapest } from '@/lib/budapestTime';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { HousekeepingAutomationSettings } from './HousekeepingAutomationSettings';

type Person = { id: string; full_name: string; nickname: string | null };
type Shift = { id: string; user_id: string; work_date: string; shift_start: string; shift_end: string;
  status: 'draft' | 'published' | 'off'; notes: string | null; staff_schedule_venues: { venue_id: string }[] };
type Editor = { person: Person; date: string; previous: Shift | null };
type SaveMode = 'draft' | 'published' | 'off';
const localDate = (day: string) => new Date(`${day}T12:00:00`);
const iso = (date: Date) => format(date, 'yyyy-MM-dd');
const monday = (day: string) => iso(startOfWeek(localDate(day), { weekStartsOn: 1 }));
const key = (user: string, date: string) => `${user}|${date}`;

/** SLNT only. All modifications are validated and committed atomically by SQL RPCs. */
export function SlntSecureStaffSchedulePlanner() {
  const { profile } = useAuth();
  const { visibleVenues, myVenueIds, hasScopes, loading: venuesLoading } = useVenues();
  const [hotel, setHotel] = useState<string | null>(null);
  const [aliases, setAliases] = useState<string[]>([]);
  const [week, setWeek] = useState(() => monday(todayBudapest()));
  const [mobileDay, setMobileDay] = useState(todayBudapest());
  const [people, setPeople] = useState<Person[]>([]);
  const [scopes, setScopes] = useState<Map<string, string[]>>(new Map());
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [search, setSearch] = useState('');
  const [filterVenue, setFilterVenue] = useState('all');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Editor | null>(null);
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('17:00');
  const [selectedVenues, setSelectedVenues] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const generation = useRef(0);
  const org = profile?.organization_slug;
  // Team View's "Open Staff schedule" CTA preserves the chosen working day.
  useEffect(() => {
    if (!profile?.assigned_hotel || !['slnt', 'slnt-group'].includes(org ?? '')) return;
    const key = `slnt-roster-target:${profile.assigned_hotel}`;
    let target: string | null = null;
    try { target = window.sessionStorage.getItem(key); window.sessionStorage.removeItem(key); }
    catch { return; }
    if (target && /^\d{4}-\d{2}-\d{2}$/.test(target)) {
      setWeek(monday(target));
      setMobileDay(target);
    }
  }, [org, profile?.assigned_hotel]);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => iso(addDays(localDate(week), i))), [week]);
  const venues = useMemo(() => visibleVenues.filter((v) => v.hotel_id === hotel && v.organization_slug === 'slnt'), [visibleVenues, hotel]);
  const venueIds = useMemo(() => new Set(venues.map((v) => v.id)), [venues]);
  const shiftMap = useMemo(() => new Map(shifts.map((s) => [key(s.user_id, s.work_date), s])), [shifts]);

  useEffect(() => {
    let active = true;
    generation.current++;
    setPeople([]); setShifts([]); setHotel(null); setAliases([]); setEditing(null); setError('');
    if (org !== 'slnt' || !profile?.assigned_hotel) { setLoading(false); return; }
    setLoading(true);
    void Promise.all([resolveCanonicalHotelId(profile.assigned_hotel), resolveHotelKeys(profile.assigned_hotel)])
      .then(([canonical, keys]) => {
        if (!active) return;
        if (!canonical || !keys.length) throw new Error('Unable to resolve the selected SLNT property.');
        setHotel(canonical); setAliases(keys);
      }).catch((cause) => { if (active) { setError(cause instanceof Error ? cause.message : 'Hotel configuration failed'); setLoading(false); } });
    return () => { active = false; generation.current++; };
  }, [org, profile?.assigned_hotel]);

  const load = useCallback(async () => {
    if (org !== 'slnt' || !hotel || !aliases.length || venuesLoading) return;
    const current = ++generation.current;
    setLoading(true); setError(''); setPeople([]); setShifts([]);
    try {
      const { data: access, error: accessError } = await (supabase as any).rpc('can_manage_slnt_schedule', { _hotel_id: hotel });
      if (accessError || access !== true) throw new Error('You do not have permission to manage this SLNT hotel schedule.');
      const [{ data: staff, error: staffError }, { data: roster, error: rosterError }] = await Promise.all([
        supabase.from('profiles').select('id,full_name,nickname').eq('organization_slug', 'slnt')
          .in('assigned_hotel', aliases).is('deleted_at', null)
          .or('role.eq.housekeeping,acts_as_housekeeper.eq.true').order('full_name'),
        (supabase as any).from('staff_schedules')
          .select('id,user_id,work_date,shift_start,shift_end,status,notes,staff_schedule_venues(venue_id)')
          .eq('organization_slug', 'slnt').eq('hotel_id', hotel)
          .gte('work_date', days[0]).lte('work_date', days[6]),
      ]);
      if (staffError || rosterError) throw new Error(staffError?.message ?? rosterError?.message ?? 'Unable to load roster');
      const candidates = (staff ?? []) as Person[];
      const scopeResult = candidates.length
        ? await supabase.from('user_property_scopes').select('user_id,venue_id')
            .eq('organization_slug', 'slnt').in('user_id', candidates.map((p) => p.id))
        : { data: [] as { user_id: string; venue_id: string }[], error: null };
      if (scopeResult.error) throw new Error('Unable to verify employee location permissions.');
      const mapped = new Map<string, string[]>();
      for (const row of scopeResult.data ?? []) mapped.set(row.user_id, [...(mapped.get(row.user_id) ?? []), row.venue_id]);
      const allowed = candidates.filter((p) => !hasScopes || (mapped.get(p.id) ?? []).some((id) => myVenueIds.includes(id)));
      const ids = new Set(allowed.map((p) => p.id));
      if (generation.current !== current) return;
      setScopes(mapped); setPeople(allowed); setShifts(((roster ?? []) as Shift[]).filter((s) => ids.has(s.user_id)));
    } catch (cause) {
      if (generation.current === current) setError(cause instanceof Error ? cause.message : 'Unable to load this schedule');
    } finally { if (generation.current === current) setLoading(false); }
  }, [org, hotel, aliases.join('|'), days.join('|'), venuesLoading, hasScopes, myVenueIds.join('|')]);
  useEffect(() => { void load(); return () => { generation.current++; }; }, [load]);

  const eligibleVenues = (person: Person) => {
    const employeeScopes = scopes.get(person.id) ?? [];
    return venues.filter((v) => !employeeScopes.length || employeeScopes.includes(v.id));
  };
  const editable = (shift: Shift | null | undefined) =>
    !shift || !hasScopes || (shift.staff_schedule_venues ?? []).every((link) => venueIds.has(link.venue_id));
  const open = (person: Person, date: string) => {
    const previous = shiftMap.get(key(person.id, date)) ?? null;
    if (!editable(previous)) { toast.error('This shift belongs to another venue.'); return; }
    const permitted = eligibleVenues(person);
    setEditing({ person, date, previous });
    setStart(previous?.shift_start.slice(0, 5) ?? '09:00'); setEnd(previous?.shift_end.slice(0, 5) ?? '17:00');
    setSelectedVenues(previous?.staff_schedule_venues?.map((v) => v.venue_id) ?? (permitted.length === 1 ? [permitted[0].id] : []));
    setNotes(previous?.notes ?? '');
  };
  const save = async (mode: SaveMode) => {
    if (busy || !editing || org !== 'slnt' || !hotel) return;
    if (!start || !end || end <= start) { toast.error('End time must be after start time. Overnight shifts are not supported.'); return; }
    const permitted = new Set(eligibleVenues(editing.person).map((v) => v.id));
    if (mode !== 'off' && (!selectedVenues.length || selectedVenues.some((id) => !permitted.has(id)))) {
      toast.error('Choose at least one permitted working venue.'); return;
    }
    if (mode === 'off' && editing.previous?.status === 'published' && !window.confirm('Remove this published shift and mark the day off? The employee will no longer see a shift.')) return;
    setBusy(true);
    try {
      const { error: saveError } = await (supabase as any).rpc('slnt_save_staff_shift', {
        _hotel: hotel, _employee: editing.person.id, _date: editing.date,
        _start: start, _end: end, _status: mode, _notes: notes.trim(),
        _venues: mode === 'off' ? [] : selectedVenues,
      });
      if (saveError) throw new Error(saveError.message);
      setEditing(null);
      toast.success(mode === 'published' ? 'Shift published to this employee' : mode === 'draft' ? 'Draft saved privately' : 'Day marked off');
      await load();
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : 'Unable to save shift'); }
    finally { setBusy(false); }
  };
  const drafts = shifts.filter((s) => s.status === 'draft' && editable(s) && (s.staff_schedule_venues?.length ?? 0) > 0);
  const publish = async () => {
    if (busy || !hotel || !drafts.length || org !== 'slnt') return;
    if (!window.confirm(`Publish ${drafts.length} drafts for this week? Only their assigned employees will see the shifts.`)) return;
    setBusy(true);
    try {
      const { data, error: publishError } = await (supabase as any).rpc('slnt_publish_staff_week', {
        _hotel: hotel, _from: week, _ids: drafts.map((s) => s.id),
      });
      if (publishError) throw new Error(publishError.message);
      toast.success(`${data} shifts published`); await load();
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : 'Could not publish'); }
    finally { setBusy(false); }
  };
  const copy = async () => {
    if (busy || !hotel || org !== 'slnt') return;
    if (!window.confirm('Copy last week to empty days this week? Existing shifts will not be overwritten.')) return;
    setBusy(true);
    try {
      const { data, error: copyError } = await (supabase as any).rpc('slnt_copy_staff_week', { _hotel: hotel, _from: week });
      if (copyError) throw new Error(copyError.message);
      const result = data as { copied?: number; skipped?: number } | null;
      toast.info(`Copied ${result?.copied ?? 0} shifts as drafts; skipped ${result?.skipped ?? 0}.`); await load();
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : 'Could not copy week'); }
    finally { setBusy(false); }
  };
  const shown = people.filter((person) => {
    if (!`${person.full_name} ${person.nickname ?? ''}`.toLowerCase().includes(search.trim().toLowerCase())) return false;
    if (filterVenue === 'all') return true;
    const employeeScopes = scopes.get(person.id) ?? [];
    return !employeeScopes.length || employeeScopes.includes(filterVenue);
  });
  const today = todayBudapest();
  const move = (date: Date) => { const next = iso(date); setWeek(next); setMobileDay(next); };
  const cell = (person: Person, date: string) => {
    const shift = shiftMap.get(key(person.id, date));
    const restricted = !!shift && !editable(shift);
    const title = !shift ? '+ Add shift' : restricted ? 'Restricted venue' : shift.status === 'off'
      ? 'Day off' : `${shift.shift_start.slice(0, 5)}–${shift.shift_end.slice(0, 5)}`;
    const location = shift && !restricted ? shift.staff_schedule_venues?.map((link) => venues.find((v) => v.id === link.venue_id)?.name).filter(Boolean).join(', ') : '';
    return <button type="button" disabled={busy || restricted || loading} onClick={() => open(person, date)}
      aria-label={`${person.full_name}, ${date}, ${title}`}
      className="w-full min-h-16 rounded-lg border bg-background p-2 text-left hover:border-primary hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60">
      <span className="text-xs font-semibold">{title}</span>
      {shift?.status !== 'off' && shift && !restricted && <><p className="mt-1 text-[11px] text-muted-foreground line-clamp-2">{location || 'Venue missing — contact manager'}</p>
        <Badge variant={shift.status === 'published' ? 'default' : 'outline'} className="mt-1 text-[10px]">{shift.status === 'published' ? 'Published' : 'Draft'}</Badge></>}
    </button>;
  };

  if (org !== 'slnt') return <Card><CardContent className="p-6">This roster is available only to the SLNT organization.</CardContent></Card>;
  if (!profile?.assigned_hotel) return <Card><CardContent className="p-6">Select an SLNT hotel to manage the roster.</CardContent></Card>;
  return <div className="space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-semibold flex items-center gap-2"><CalendarDays className="h-5 w-5" />Staff schedule</h2>
      <p className="text-sm text-muted-foreground">Create shifts, choose venues and publish to staff. Drafts stay private.</p></div>
      <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy || loading || !!error} onClick={copy}><Copy className="h-4 w-4 mr-1" />Copy last week</Button>
        <Button disabled={busy || loading || !!error || !drafts.length} onClick={publish}><Send className="h-4 w-4 mr-1" />Publish {drafts.length || ''} drafts</Button></div>
    </div>
    <div className="grid gap-2 sm:grid-cols-3">
      <Card><CardContent className="p-3 flex gap-3 items-center"><Users className="h-5 w-5 text-muted-foreground" /><div><div className="text-xl font-semibold">{people.length}</div><p className="text-xs text-muted-foreground">Housekeepers</p></div></CardContent></Card>
      <Card><CardContent className="p-3 flex gap-3 items-center"><Check className="h-5 w-5 text-muted-foreground" /><div><div className="text-xl font-semibold">{shifts.filter((s) => s.status === 'published').length}</div><p className="text-xs text-muted-foreground">Published this week</p></div></CardContent></Card>
      <Card><CardContent className="p-3 flex gap-3 items-center"><Clock className="h-5 w-5 text-muted-foreground" /><div><div className="text-xl font-semibold">{drafts.length}</div><p className="text-xs text-muted-foreground">Ready-to-publish drafts</p></div></CardContent></Card>
    </div>
    <Card><CardContent className="p-3 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-1">
        <Button size="icon" variant="outline" aria-label="Previous week" disabled={busy} onClick={() => move(subWeeks(localDate(week), 1))}><ChevronLeft className="h-4 w-4" /></Button>
        <Button size="icon" variant="outline" aria-label="Next week" disabled={busy} onClick={() => move(addWeeks(localDate(week), 1))}><ChevronRight className="h-4 w-4" /></Button>
        <span className="px-2 text-sm font-semibold">{format(localDate(week), 'MMM d')} – {format(localDate(days[6]), 'MMM d, yyyy')}</span>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => move(localDate(monday(today)))}>Today</Button></div>
        <div className="flex flex-wrap gap-2"><div className="relative"><Search className="absolute pointer-events-none left-2 top-2.5 h-4 w-4 text-muted-foreground" /><Input aria-label="Search employees" className="w-40 pl-8" placeholder="Find staff" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
          {venues.length > 0 && <Select value={filterVenue} onValueChange={setFilterVenue}><SelectTrigger className="w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All my venues</SelectItem>{venues.map((v) => <SelectItem value={v.id} key={v.id}>{v.name}</SelectItem>)}</SelectContent></Select>}</div>
      </div>
      {error && <div role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">{error} <Button variant="outline" size="sm" onClick={() => void load()}>Retry</Button></div>}
      {loading || venuesLoading || !hotel ? <p role="status" className="p-8 text-center text-sm text-muted-foreground">Loading SLNT roster…</p>
        : !shown.length ? <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">{search || filterVenue !== 'all' ? 'No matching housekeepers.' : 'No housekeepers linked to this hotel. Check employee account and venue mappings.'}</p>
        : <><div className="hidden md:block max-h-[65vh] overflow-auto rounded-lg border"><table className="w-full min-w-[850px] border-collapse text-sm"><thead className="sticky top-0 z-20 bg-background"><tr><th className="sticky left-0 z-30 min-w-40 border-b border-r bg-background p-3 text-left">Housekeeper</th>
          {days.map((day) => <th key={day} className={`min-w-28 border-b p-2 text-center ${day === today ? 'bg-primary/5' : ''}`}><div>{format(localDate(day), 'EEE')}</div><div className="text-xs text-muted-foreground">{format(localDate(day), 'MMM d')}</div><div className="text-[10px] text-muted-foreground">{shifts.filter((s) => s.work_date === day && s.status === 'published').length} scheduled</div></th>)}</tr></thead>
          <tbody>{shown.map((person) => <tr key={person.id}><th className="sticky left-0 z-10 border-b border-r bg-background p-3 text-left"><div className="font-semibold">{person.full_name}</div><span className="text-xs font-normal text-muted-foreground">{person.nickname}</span></th>
            {days.map((day) => <td key={day} className={`border-b p-1 align-top ${day === today ? 'bg-primary/5' : ''}`}>{cell(person, day)}</td>)}</tr>)}</tbody></table></div>
          <div className="space-y-3 md:hidden"><div role="group" aria-label="Select schedule date" className="flex gap-1 overflow-x-auto pb-2">{days.map((day) => <Button key={day} size="sm" className="shrink-0" variant={mobileDay === day ? 'default' : 'outline'} onClick={() => setMobileDay(day)}>{format(localDate(day), 'EEE d')}</Button>)}</div>
            {shown.map((person) => <div key={person.id} className="rounded-lg border p-3"><p className="mb-2 text-sm font-semibold">{person.full_name}</p>{cell(person, days.includes(mobileDay) ? mobileDay : days[0])}</div>)}</div></>}
      <p className="text-xs text-muted-foreground">Housekeeping flags assignment conflicts using published shifts and venues. Publishing does not assign rooms or alter checkout/daily classifications.</p>
    </CardContent></Card>
    <details className="rounded-lg border bg-background"><summary className="flex cursor-pointer items-center gap-2 p-4 text-sm font-semibold"><Settings2 className="h-4 w-4" />Advanced · alerts and safeguards</summary><div className="p-3 pt-0"><HousekeepingAutomationSettings /></div></details>
    <Dialog open={!!editing} onOpenChange={(open) => { if (!open && !busy) setEditing(null); }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
      <DialogHeader><DialogTitle>{editing?.person.full_name} · {editing && format(localDate(editing.date), 'EEE, MMM d')}</DialogTitle></DialogHeader>
      <div className="space-y-4"><div><Label className="mb-2 block">Quick shift</Label><div className="flex flex-wrap gap-2">
        {[{ label: 'Morning', start: '08:00', end: '16:00' }, { label: 'Standard', start: '09:00', end: '17:00' }, { label: 'Late', start: '12:00', end: '20:00' }].map((preset) => <Button key={preset.label} size="sm" variant={start === preset.start && end === preset.end ? 'default' : 'outline'} onClick={() => { setStart(preset.start); setEnd(preset.end); }}>{preset.label}</Button>)}</div></div>
        <div className="grid grid-cols-2 gap-3"><div><Label htmlFor="shift-start">Start</Label><Input id="shift-start" type="time" value={start} onChange={(e) => setStart(e.target.value)} /></div><div><Label htmlFor="shift-end">End</Label><Input id="shift-end" type="time" value={end} onChange={(e) => setEnd(e.target.value)} /></div></div>
        <div><Label className="mb-2 flex items-center gap-1"><MapPin className="h-4 w-4" />Working venue(s)</Label><div className="max-h-44 space-y-2 overflow-auto rounded-lg border p-3">{editing && eligibleVenues(editing.person).length ? eligibleVenues(editing.person).map((v) => <label key={v.id} className="flex items-center gap-2 text-sm"><Checkbox checked={selectedVenues.includes(v.id)} onCheckedChange={(checked) => setSelectedVenues((old) => checked === true ? [...new Set([...old, v.id])] : old.filter((id) => id !== v.id))} />{v.name}</label>) : <p className="text-sm text-muted-foreground">No permitted venues. Ask SLNT management to map access.</p>}</div></div>
        <div><Label htmlFor="shift-note">Note visible to this employee (optional)</Label><Textarea id="shift-note" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="For example: start at the main entrance" /></div>
        {editing?.previous?.status === 'published' && <p className="text-xs text-muted-foreground">Changes to this published shift become visible to the employee after saving.</p>}
      </div>
      <DialogFooter className="flex-wrap gap-2"><Button variant="outline" disabled={busy} onClick={() => setEditing(null)}>Cancel</Button><Button variant="secondary" disabled={busy} onClick={() => void save('off')}>Day off</Button>
        {editing?.previous?.status !== 'published' && <Button variant="outline" disabled={busy} onClick={() => void save('draft')}>Save draft</Button>}
        <Button disabled={busy} onClick={() => void save('published')}><Check className="mr-1 h-4 w-4" />{busy ? 'Saving…' : editing?.previous?.status === 'published' ? 'Save changes' : 'Save & publish'}</Button></DialogFooter>
    </DialogContent></Dialog>
  </div>;
}
