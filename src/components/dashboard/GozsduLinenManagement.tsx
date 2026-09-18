import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DateRange } from 'react-day-picker';
import { Download, RefreshCw, Shirt } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { supabase } from '@/integrations/supabase/client';
import { gozsduLinenLabel, loadHotelLinenCatalogue, type LinenCatalogueItem } from '@/lib/gozsduLinenCatalogue';
import { getLocalDateString } from '@/lib/utils';
import { DateRangeFilter } from './DateRangeFilter';

type Room = { id: string; room_number: string; hotel: string };
type LinenCount = { id: string; room_id: string; housekeeper_id: string; assignment_id: string | null; linen_item_id: string; count: number; work_date: string };
type Assignment = { id: string; room_id: string; assigned_to: string; assignment_date: string; supervisor_approved: boolean | null };
type Person = { id: string; full_name: string; nickname: string | null };
type Session = { key: string; roomId: string; room: string; date: string; personId: string; person: string; assignmentId: string | null; approved: boolean; counts: Map<string, number>; records: Map<string, LinenCount[]>; legacy: number };
const editableRoles = ['admin', 'manager', 'housekeeping_manager', 'top_management', 'top_management_manager'];
const csvCell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;

/** Gozsdu-only counterpart. Other properties keep DirtyLinenManagementV2 untouched.
 * Always preserve pre-migration records and their item IDs; new corrections use
 * the 15 scoped items and are audited by the existing count triggers. */
export function GozsduLinenManagement() {
  const { profile } = useAuth();
  const { t, language } = useTranslation();
  const [dateRange, setDateRange] = useState<DateRange | undefined>({ from: new Date(), to: new Date() });
  const [items, setItems] = useState<LinenCatalogueItem[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [counts, setCounts] = useState<LinenCount[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [publicTotal, setPublicTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const canCorrect = !!profile?.role && editableRoles.includes(profile.role);

  const load = useCallback(async () => {
    if (!profile?.organization_slug || !dateRange?.from) return;
    setLoading(true);
    try {
      const start = getLocalDateString(dateRange.from);
      const end = getLocalDateString(dateRange.to || dateRange.from);
      const [catalogue, roomResult] = await Promise.all([
        loadHotelLinenCatalogue(profile.assigned_hotel),
        supabase.from('rooms').select('id,room_number,hotel')
          .in('hotel', ['gozsdu-court', 'Gozsdu Court Budapest'])
          .eq('organization_slug', profile.organization_slug),
      ]);
      if (roomResult.error) throw roomResult.error;
      const hotelRooms = ((roomResult.data || []) as Room[]).sort((a, b) => a.room_number.localeCompare(b.room_number, undefined, { numeric: true }));
      const ids = hotelRooms.map(row => row.id);
      let existing: LinenCount[] = [];
      let assignmentsForRooms: Assignment[] = [];
      if (ids.length) {
        const [countResult, assignmentResult] = await Promise.all([
          supabase.from('dirty_linen_counts')
            .select('id,room_id,housekeeper_id,assignment_id,linen_item_id,count,work_date')
            .in('room_id', ids).gte('work_date', start).lte('work_date', end).gt('count', 0),
          supabase.from('room_assignments')
            .select('id,room_id,assigned_to,assignment_date,supervisor_approved')
            .in('room_id', ids).gte('assignment_date', start).lte('assignment_date', end),
        ]);
        if (countResult.error) throw countResult.error;
        if (assignmentResult.error) throw assignmentResult.error;
        existing = (countResult.data || []) as LinenCount[];
        assignmentsForRooms = (assignmentResult.data || []) as Assignment[];
      }
      const staffIds = [...new Set([...existing.map(row => row.housekeeper_id), ...assignmentsForRooms.map(row => row.assigned_to)].filter(Boolean))];
      let staff: Person[] = [];
      if (staffIds.length) {
        const peopleResult = await supabase.from('profiles').select('id,full_name,nickname').in('id', staffIds);
        if (peopleResult.error) throw peopleResult.error;
        staff = (peopleResult.data || []) as Person[];
      }
      const publicResult = await (supabase as any).from('dirty_linen_public_area_counts')
        .select('count').in('hotel', ['gozsdu-court','Gozsdu Court Budapest'])
        .gte('work_date', start).lte('work_date', end).gt('count', 0);
      if (publicResult.error) throw publicResult.error;
      setPublicTotal((publicResult.data || []).reduce((total: number, row: any) => total + row.count, 0));
      setItems(catalogue);
      setRooms(hotelRooms);
      setCounts(existing);
      setAssignments(assignmentsForRooms);
      setPeople(staff);
      setError(null);
    } catch (caught: any) {
      console.error('[GozsduLinenManagement] load failed', caught);
      setError(caught?.message || 'Could not load Gozsdu linen records.');
      toast.error('Could not load Gozsdu linen records.');
    } finally {
      setLoading(false);
    }
  }, [profile?.assigned_hotel, profile?.organization_slug, dateRange?.from, dateRange?.to]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!profile?.id) return;
    const channel = supabase.channel(`gozsdu-linen-manager-${profile.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dirty_linen_counts' }, () => { void load(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_assignments' }, () => { void load(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [profile?.id, load]);

  const sessions = useMemo(() => {
    const roomMap = new Map(rooms.map(room => [room.id, room.room_number]));
    const peopleMap = new Map(people.map(person => [person.id, person.nickname || person.full_name]));
    const itemIds = new Set(items.map(item => item.id));
    const map = new Map<string, Session>();
    const make = (key: string, roomId: string, personId: string, date: string, assignmentId: string | null, approved: boolean): Session => ({
      key, roomId, room: roomMap.get(roomId) || 'Unknown room', personId, person: peopleMap.get(personId) || 'Unknown user',
      date, assignmentId, approved, counts: new Map(), records: new Map(), legacy: 0,
    });
    for (const assignment of assignments) {
      if (!assignment.assigned_to) continue;
      map.set(assignment.id, make(assignment.id, assignment.room_id, assignment.assigned_to, assignment.assignment_date, assignment.id, !!assignment.supervisor_approved));
    }
    for (const row of counts) {
      const matching = assignments.find(assignment => assignment.room_id === row.room_id && assignment.assigned_to === row.housekeeper_id && assignment.assignment_date === row.work_date);
      const key = matching?.id || `orphan:${row.work_date}:${row.room_id}:${row.housekeeper_id}`;
      if (!map.has(key)) map.set(key, make(key, row.room_id, row.housekeeper_id, row.work_date, matching?.id || null, !!matching?.supervisor_approved));
      const session = map.get(key)!;
      if (!itemIds.has(row.linen_item_id)) { session.legacy += row.count; continue; }
      session.counts.set(row.linen_item_id, (session.counts.get(row.linen_item_id) || 0) + row.count);
      session.records.set(row.linen_item_id, [...(session.records.get(row.linen_item_id) || []), row]);
    }
    return Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date) || a.room.localeCompare(b.room, undefined, { numeric: true }));
  }, [rooms, people, items, counts, assignments]);

  const staffSummary = useMemo(() => {
    const map = new Map<string, { id: string; name: string; count: number; sessions: number; byItem: Map<string, number>; legacy: number }>();
    for (const session of sessions) {
      if (!map.has(session.personId)) map.set(session.personId, { id: session.personId, name: session.person, count: 0, sessions: 0, byItem: new Map(), legacy: 0 });
      const entry = map.get(session.personId)!;
      entry.sessions += 1;
      entry.legacy += session.legacy;
      for (const [id, qty] of session.counts) { entry.count += qty; entry.byItem.set(id, (entry.byItem.get(id) || 0) + qty); }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [sessions]);
  const total = staffSummary.reduce((sum, staff) => sum + staff.count, 0);
  const legacyTotal = staffSummary.reduce((sum, staff) => sum + staff.legacy, 0);
  const selected = sessions.find(row => row.key === selectedKey) || null;
  const label = (item: LinenCatalogueItem) => gozsduLinenLabel(item, language, t);

  const openSession = (session: Session) => {
    setSelectedKey(session.key);
    setDraft(Object.fromEntries(items.map(item => [item.id, session.counts.get(item.id) || 0])));
  };
  const saveSession = async () => {
    if (!canCorrect || !selected || !profile?.organization_slug || saving) return;
    setSaving(true);
    try {
      for (const item of items) {
        const old = selected.counts.get(item.id) || 0;
        const next = draft[item.id] || 0;
        if (next === old) continue;
        const existing = selected.records.get(item.id) || [];
        if (next === 0 && existing.length) {
          const result = await supabase.from('dirty_linen_counts').delete().in('id', existing.map(record => record.id));
          if (result.error) throw result.error;
        } else if (existing.length) {
          const result = await supabase.from('dirty_linen_counts').update({ count: next }).eq('id', existing[0].id);
          if (result.error) throw result.error;
          if (existing.length > 1) {
            const extras = await supabase.from('dirty_linen_counts').delete().in('id', existing.slice(1).map(record => record.id));
            if (extras.error) throw extras.error;
          }
        } else if (next > 0) {
          const result = await supabase.from('dirty_linen_counts').insert({
            housekeeper_id: selected.personId, room_id: selected.roomId,
            assignment_id: selected.assignmentId, linen_item_id: item.id, count: next,
            work_date: selected.date, organization_slug: profile.organization_slug,
          });
          if (result.error) throw result.error;
        }
      }
      setSelectedKey(null);
      await load();
      toast.success('Gozsdu linen corrections saved.');
    } catch (caught: any) {
      console.error('[GozsduLinenManagement] correction failed', caught);
      toast.error(caught?.message || 'Linen corrections could not be saved. Please refresh.');
    } finally { setSaving(false); }
  };

  const exportCsv = () => {
    if (!dateRange?.from) return;
    const rows: unknown[][] = [
      ['Date', 'Housekeeper / Laundryner', 'Room', ...items.map(label), 'SUM', 'Previously recorded (legacy)'],
      ...sessions.map(session => [session.date, session.person, session.room,
        ...items.map(item => session.counts.get(item.id) || 0),
        items.reduce((sum, item) => sum + (session.counts.get(item.id) || 0), 0), session.legacy]),
    ];
    const blob = new Blob([rows.map(row => row.map(csvCell).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `gozsdu-dirty-linen-${getLocalDateString(dateRange.from)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return <div className="space-y-5" data-testid="gozsdu-linen-management">
    <div className="flex items-start justify-between gap-3 flex-wrap">
      <div><h2 className="text-2xl font-bold flex items-center gap-2"><Shirt className="h-5 w-5" />{t('linen.management')}</h2>
        <p className="text-sm text-muted-foreground">Gozsdu Court Budapest • 15 sheet columns in the original order</p></div>
      <div className="flex gap-2"><Button variant="outline" onClick={() => { void load(); }} disabled={loading}><RefreshCw className="h-4 w-4 mr-1" />Refresh</Button>
        <Button variant="outline" onClick={exportCsv} disabled={loading || !sessions.length}><Download className="h-4 w-4 mr-1" />{t('linen.exportCsv')}</Button></div>
    </div>
    <DateRangeFilter dateRange={dateRange} onDateRangeChange={setDateRange} />
    {error && <Card role="alert" className="p-3 text-destructive">{error}</Card>}
    <Card className="p-4 space-y-3">
      <div className="flex justify-between gap-2 flex-wrap"><h3 className="font-semibold">Collection summary</h3><Badge>{total} {t('linen.total')}</Badge></div>
      <div className="overflow-x-auto rounded-md border">
        <table className="min-w-[1200px] w-full border-collapse text-xs">
          <thead><tr className="bg-muted/70"><th className="border p-2 text-left">{t('linen.housekeepers')}</th>
            {items.map(item => <th key={item.id} className="border p-2 text-center min-w-[65px] break-words">{label(item)}</th>)}
            <th className="border p-2 text-center font-bold">SUM</th></tr></thead>
          <tbody>{staffSummary.map(staff => <tr key={staff.id} className="even:bg-muted/20">
            <th className="border p-2 text-left font-medium">{staff.name}</th>
            {items.map(item => <td key={item.id} className="border p-2 text-center tabular-nums">{staff.byItem.get(item.id) || 0}</td>)}
            <td className="border p-2 text-center font-bold tabular-nums">{staff.count}</td>
          </tr>)}
          <tr className="bg-muted font-bold"><th className="border p-2 text-left">SUM</th>
            {items.map(item => <td key={item.id} className="border p-2 text-center tabular-nums">{staffSummary.reduce((sum, staff) => sum + (staff.byItem.get(item.id) || 0), 0)}</td>)}
            <td className="border p-2 text-center tabular-nums">{total}</td>
          </tr></tbody>
        </table>
      </div>
      {legacyTotal > 0 && <p role="status" className="text-xs text-muted-foreground">
        {legacyTotal} items were recorded using the previous catalogue and remain safely in historical records. They are excluded from the new 15-column sheet; no counts were deleted.
      </p>}
      <p className="text-xs text-muted-foreground">Public-area linen: {publicTotal} items (tracked separately from guest rooms).</p>
    </Card>
    <Card className="p-4 space-y-3"><h3 className="font-semibold">Housekeepers &amp; Laundryners</h3>
      {loading && <p role="status">Loading…</p>}
      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-2">
        {staffSummary.map(staff => <Card key={staff.id} className="p-3 space-y-2">
          <div className="flex items-center justify-between gap-2"><strong className="truncate">{staff.name}</strong><Badge>{staff.count}</Badge></div>
          <p className="text-xs text-muted-foreground">{staff.sessions} rooms • {staff.legacy} legacy items</p>
          {sessions.filter(session => session.personId === staff.id).map(session => <Button key={session.key} size="sm" variant="outline" className="w-full justify-between" onClick={() => openSession(session)}>
            {session.room} • {session.date} <Badge variant="secondary">{items.reduce((sum, item) => sum + (session.counts.get(item.id) || 0), 0)}</Badge>
          </Button>)}
        </Card>)}
      </div>
    </Card>
    <Card className="p-4 space-y-2"><h3 className="font-semibold">Room overview</h3>
      <div className="flex flex-wrap gap-2">{rooms.map(room => <Button size="sm" key={room.id} variant="outline"
        onClick={() => { const session = sessions.find(row => row.roomId === room.id); if (session) openSession(session); }}>
        {room.room_number}
      </Button>)}</div>
    </Card>
    <Dialog open={!!selected} onOpenChange={open => { if (!open && !saving) setSelectedKey(null); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{t('common.room')} {selected?.room} • {selected?.person}</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground">{selected?.date} • {selected?.approved ? 'Supervisor approved' : 'Pending approval'}</p>
        {selected && items.map(item => <div key={item.id} className="flex items-center gap-2 rounded-md border p-2">
          <span className="flex-1 min-w-0 text-sm">{label(item)}</span>
          <Button size="sm" variant="outline" disabled={!canCorrect || saving || !draft[item.id]}
            onClick={() => setDraft(old => ({ ...old, [item.id]: Math.max(0, (old[item.id] || 0) - 1) }))}>−</Button>
          <Input type="number" min={0} max={1000} step={1} className="w-16 text-center" value={draft[item.id] || 0} disabled={!canCorrect || saving}
            aria-label={`${label(item)} quantity`}
            onChange={event => { const n = Number(event.target.value); if (Number.isInteger(n) && n >= 0 && n <= 1000) setDraft(old => ({ ...old, [item.id]: n })); }} />
          <Button size="sm" variant="outline" disabled={!canCorrect || saving || (draft[item.id] || 0) >= 1000}
            onClick={() => setDraft(old => ({ ...old, [item.id]: (old[item.id] || 0) + 1 }))}>+</Button>
        </div>)}
        {selected?.legacy ? <p className="text-xs text-muted-foreground">Previous catalogue: {selected.legacy} items (preserved; edit through historical records if required).</p> : null}
        {canCorrect && <Button onClick={() => { void saveSession(); }} disabled={saving || !!error}>{saving ? 'Saving…' : t('common.save')}</Button>}
      </DialogContent>
    </Dialog>
  </div>;
}
