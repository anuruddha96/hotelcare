import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Loader2, RefreshCw, Shirt, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { supabase } from '@/integrations/supabase/client';
import { todayBudapest } from '@/lib/budapestTime';
import { groupLaundryRooms, type LaundryBucket, type LaundryRoom } from '@/lib/gozsduLaundryner';
import { translateLinenItem } from '@/lib/linen-item-i18n';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { isGozsduCourtHotel } from '@/lib/gozsdu-housekeeping';

type LinenItem = { id: string; name: string; display_name: string; sort_order: number };
type Count = { room_id: string; linen_item_id: string; count: number };
type Progress = { room_id: string; status: 'collected' | 'nothing_to_collect' | 'could_not_access'; reason: string | null };
const GROUPS: { key: LaundryBucket; title: string; description: string }[] = [
  { key: 'checkout', title: 'Checkout rooms', description: 'Prioritize after guest checkout and room release.' },
  { key: 'second_day', title: 'Second-day stayovers', description: 'Confirm guest access before collecting.' },
  { key: 'other', title: 'Other rooms', description: 'Includes later-night stayovers; follow the existing Gozsdu service cycle.' },
];

export function GozsduLaundrynerTasks() {
  const { user, profile } = useAuth();
  const { t } = useTranslation();
  const [workDate, setWorkDate] = useState(todayBudapest);
  const [rooms, setRooms] = useState<LaundryRoom[]>([]);
  const [items, setItems] = useState<LinenItem[]>([]);
  const [counts, setCounts] = useState<Count[]>([]);
  const [progress, setProgress] = useState<Progress[]>([]);
  const [buildingNames, setBuildingNames] = useState<Record<string, string>>({});
  const [selectedRoom, setSelectedRoom] = useState<LaundryRoom | null>(null);
  const [draft, setDraft] = useState<Record<string, number>>({});
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const eligible = !!user?.id && !!profile?.organization_slug && isGozsduCourtHotel(profile.assigned_hotel);

  const load = useCallback(async (silent = false) => {
    if (!eligible || !user?.id || !profile?.organization_slug) return;
    if (!silent) setLoading(true);
    try {
      const roomQuery = supabase.from('rooms')
        .select('id, hotel, room_number, status, is_checkout_room, is_dnd, pms_metadata')
        .in('hotel', ['gozsdu-court', 'Gozsdu Court Budapest']);
      const [roomResult, itemResult, progressResult] = await Promise.all([
        roomQuery,
        supabase.from('dirty_linen_items').select('id, name, display_name, sort_order')
          .eq('is_active', true).order('sort_order'),
        (supabase as any).from('gozsdu_laundry_room_progress')
          .select('room_id,status,reason').eq('organization_slug', profile.organization_slug)
          .eq('hotel_id', 'gozsdu-court').eq('work_date', workDate).eq('user_id', user.id),
      ]);
      if (roomResult.error) throw roomResult.error;
      if (itemResult.error) throw itemResult.error;
      if (progressResult.error) throw progressResult.error;
      const eligibleRooms = Object.values(groupLaundryRooms((roomResult.data || []) as LaundryRoom[])).flat();
      const roomIds = eligibleRooms.map(room => room.id);
      let savedCounts: Count[] = [];
      if (roomIds.length) {
        const result = await supabase.from('dirty_linen_counts')
          .select('room_id, linen_item_id, count').eq('housekeeper_id', user.id)
          .eq('work_date', workDate).in('room_id', roomIds);
        if (result.error) throw result.error;
        savedCounts = (result.data || []) as Count[];
      }
      // Building labels from the existing manager map, not guessed room numbers.
      const { data: sections, error: sectionError } = await (supabase as any)
        .from('hotel_housekeeping_sections').select('id,name')
        .eq('hotel_name', 'Gozsdu Court Budapest').eq('is_active', true);
      if (sectionError) throw sectionError;
      const sectionIds: string[] = (sections || []).map((section: any) => section.id);
      const map: Record<string, string> = {};
      if (sectionIds.length) {
        const { data: mappings, error: mapError } = await (supabase as any)
          .from('hotel_housekeeping_section_rooms').select('room_id,section_id')
          .in('section_id', sectionIds);
        if (mapError) throw mapError;
        const names = new Map((sections || []).map((section: any) => [section.id, section.name]));
        for (const mapping of mappings || []) map[mapping.room_id] = names.get(mapping.section_id) as string || '';
      }
      setRooms(eligibleRooms);
      setItems((itemResult.data || []) as LinenItem[]);
      setCounts(savedCounts);
      setProgress((progressResult.data || []) as Progress[]);
      setBuildingNames(map);
    } catch (error) {
      console.error('[GozsduLaundryner] failed to refresh', error);
      toast.error('Laundry tasks could not be synchronized. Retry before entering counts.');
    } finally {
      setLoading(false);
    }
  }, [eligible, profile?.organization_slug, user?.id, workDate]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!eligible) return;
    const channel = supabase.channel(`gozsdu-laundry-${user?.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dirty_linen_counts' }, () => { void load(true); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gozsdu_laundry_room_progress' }, () => { void load(true); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, () => { void load(true); })
      .subscribe();
    const poll = window.setInterval(() => {
      const date = todayBudapest();
      if (date !== workDate) { setSelectedRoom(null); setWorkDate(date); }
      else void load(true);
    }, 20_000);
    return () => { window.clearInterval(poll); void supabase.removeChannel(channel); };
  }, [eligible, user?.id, workDate, load]);

  const grouped = useMemo(() => groupLaundryRooms(rooms), [rooms]);
  const progressMap = useMemo(() => new Map(progress.map(row => [row.room_id, row])), [progress]);
  const countByRoom = useMemo(() => {
    const totals = new Map<string, number>();
    for (const row of counts) totals.set(row.room_id, (totals.get(row.room_id) || 0) + row.count);
    return totals;
  }, [counts]);
  const finished = progress.filter(p => p.status === 'collected' || p.status === 'nothing_to_collect').length;

  const selectRoom = (room: LaundryRoom) => {
    setSelectedRoom(room);
    setDraft(Object.fromEntries(counts.filter(row => row.room_id === room.id)
      .map(row => [row.linen_item_id, row.count])));
    setReason(progressMap.get(room.id)?.reason || '');
  };

  const submit = async (status: Progress['status']) => {
    if (!selectedRoom || busy || !eligible) return;
    if (todayBudapest() !== workDate) {
      setSelectedRoom(null);
      setWorkDate(todayBudapest());
      toast.error('A new Budapest business date has started. Reload tasks before recording linen.');
      return;
    }
    if (selectedRoom.is_dnd && status !== 'could_not_access') {
      toast.error('This room is DND. Record no access or have reception resolve guest access.');
      return;
    }
    const payload = status === 'could_not_access' ? [] : items.map(item => ({
      linen_item_id: item.id,
      count: status === 'nothing_to_collect' ? 0 : (draft[item.id] || 0),
    }));
    if (status === 'collected' && payload.every(item => item.count === 0)) {
      toast.error('Enter at least one linen item or select Nothing to collect.');
      return;
    }
    if (status === 'could_not_access' && !reason.trim()) {
      toast.error('Please provide a reason (DND, occupied, guest refused, etc.).');
      return;
    }
    setBusy(true);
    try {
      const { error } = await (supabase as any).rpc('record_gozsdu_laundry_collection', {
        p_room_id: selectedRoom.id, p_status: status, p_counts: payload,
        p_reason: status === 'could_not_access' ? reason.trim() : null,
      });
      if (error) throw error;
      setSelectedRoom(null);
      await load(true);
      window.dispatchEvent(new CustomEvent('dirty-linen-updated'));
      toast.success(status === 'collected' ? 'Linen collected and manager records updated.'
        : status === 'nothing_to_collect' ? 'Room recorded: nothing to collect.' : 'Access blocker recorded.');
    } catch (error: any) {
      toast.error(error?.message || 'Linen collection was not saved. Nothing was marked complete.');
    } finally {
      setBusy(false);
    }
  };

  if (!eligible) return null;
  return <div className="space-y-4" data-testid="gozsdu-laundryner-workspace">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-semibold"><Shirt className="h-5 w-5" /> Laundryner • My Tasks</h2>
        <p className="text-sm text-muted-foreground">Gozsdu Court Budapest • {workDate} • {finished}/{rooms.length} rooms recorded</p>
      </div>
      <Button size="sm" variant="outline" disabled={loading} onClick={() => { void load(); }}>
        <RefreshCw className="mr-1 h-4 w-4" /> Refresh
      </Button>
    </div>
    <p className="text-xs text-muted-foreground">Laundry-only duty: attendance, breaks and tickets remain in the usual tabs. Only enter a stayover with guest permission; DND rooms must be recorded as no access.</p>
    {loading && <p className="text-sm"><Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> Loading laundry tasks…</p>}
    {GROUPS.map(group => <Card key={group.key}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          {group.title} <Badge variant="secondary">{grouped[group.key].length}</Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground">{group.description}</p>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {grouped[group.key].map(room => {
          const state = progressMap.get(room.id);
          const total = countByRoom.get(room.id) || 0;
          return <button type="button" key={room.id} onClick={() => selectRoom(room)}
            className="min-w-[100px] rounded-xl border bg-background p-2 text-left text-sm shadow-sm hover:border-primary focus-visible:outline-2 focus-visible:outline-primary"
            aria-label={`Room ${room.room_number}, ${state?.status || 'not recorded'}`}>
            <span className="block font-semibold">{room.room_number}</span>
            {buildingNames[room.id] && <span className="block max-w-[155px] truncate text-[10px] text-muted-foreground">{buildingNames[room.id]}</span>}
            {room.is_dnd && <span className="block text-xs text-destructive">DND • no entry</span>}
            {state?.status === 'collected' && <span className="flex items-center gap-1 text-xs text-emerald-600"><CheckCircle2 className="h-3 w-3" /> {total} collected</span>}
            {state?.status === 'nothing_to_collect' && <span className="block text-xs text-emerald-600">Nothing to collect</span>}
            {state?.status === 'could_not_access' && <span className="flex items-center gap-1 text-xs text-amber-600"><TriangleAlert className="h-3 w-3" /> No access</span>}
            {!state && <span className="block text-xs text-muted-foreground">Not recorded</span>}
          </button>;
        })}
        {grouped[group.key].length === 0 && <p className="text-sm text-muted-foreground">No eligible rooms in this group.</p>}
      </CardContent>
    </Card>)}
    <Dialog open={!!selectedRoom} onOpenChange={open => { if (!open && !busy) setSelectedRoom(null); }}>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
        <DialogHeader><DialogTitle>Room {selectedRoom?.room_number} • Dirty linen</DialogTitle></DialogHeader>
        {selectedRoom?.is_dnd ? <p className="text-sm text-destructive">Do not enter: this room is DND. Record an access blocker below.</p>
          : <p className="text-sm text-muted-foreground">Enter quantities actually collected. Saving updates Dirty Linen and the manager view together.</p>}
        {!selectedRoom?.is_dnd && <div className="space-y-2">
          {items.map(item => <div key={item.id} className="flex items-center gap-2 rounded-md border px-3 py-2">
            <label htmlFor={`laundry-${item.id}`} className="min-w-0 flex-1 text-sm">{translateLinenItem(item.display_name || item.name, t)}</label>
            <Button type="button" size="sm" variant="outline" disabled={busy || !draft[item.id]}
              onClick={() => setDraft(old => ({ ...old, [item.id]: Math.max(0, (old[item.id] || 0) - 1) }))}>−</Button>
            <Input id={`laundry-${item.id}`} type="number" min={0} max={1000} step={1}
              className="w-16 text-center" disabled={busy} value={draft[item.id] ?? 0}
              onChange={event => {
                const raw = Number(event.target.value);
                if (Number.isInteger(raw) && raw >= 0 && raw <= 1000) setDraft(old => ({ ...old, [item.id]: raw }));
              }} />
            <Button type="button" size="sm" variant="outline" disabled={busy || (draft[item.id] || 0) >= 1000}
              onClick={() => setDraft(old => ({ ...old, [item.id]: (old[item.id] || 0) + 1 }))}>+</Button>
          </div>)}
          <div className="grid grid-cols-2 gap-2">
            <Button disabled={busy} onClick={() => { void submit('collected'); }}>Save collected linen</Button>
            <Button disabled={busy} variant="outline" onClick={() => { void submit('nothing_to_collect'); }}>Nothing to collect</Button>
          </div>
        </div>}
        <div className="space-y-2 border-t pt-3">
          <label htmlFor="laundry-access-reason" className="text-sm font-medium">Could not access room</label>
          <Input id="laundry-access-reason" value={reason} disabled={busy}
            placeholder="DND, guest refused, occupied…" onChange={event => setReason(event.target.value)} />
          <Button type="button" variant="secondary" disabled={busy || !reason.trim()}
            onClick={() => { void submit('could_not_access'); }}>Record access blocker</Button>
        </div>
        {busy && <p className="text-sm"><Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> Saving securely…</p>}
      </DialogContent>
    </Dialog>
  </div>;
}
