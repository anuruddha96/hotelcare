import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Loader2, RefreshCw, Shirt, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { supabase } from '@/integrations/supabase/client';
import { todayBudapest } from '@/lib/budapestTime';
import { groupLaundryRooms, type LaundryBucket, type LaundryRoom } from '@/lib/gozsduLaundryner';
import { gozsduLinenLabel, loadHotelLinenCatalogue, type LinenCatalogueItem } from '@/lib/gozsduLinenCatalogue';
import { laundryCopy } from '@/lib/gozsduLaundrynerI18n';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { isGozsduCourtHotel } from '@/lib/gozsdu-housekeeping';

type Count = { room_id: string; linen_item_id: string; count: number };
type Progress = { room_id: string; status: 'collected' | 'nothing_to_collect' | 'could_not_access'; reason: string | null };
const GROUPS: { key: LaundryBucket; title: 'checkout' | 'stayover' | 'other'; description: 'checkoutHint' | 'stayoverHint' | 'otherHint' }[] = [
  { key: 'checkout', title: 'checkout', description: 'checkoutHint' },
  { key: 'second_day', title: 'stayover', description: 'stayoverHint' },
  { key: 'other', title: 'other', description: 'otherHint' },
];

export function GozsduLaundrynerTasks() {
  const { user, profile } = useAuth();
  const { t, language } = useTranslation();
  const copy = useMemo(() => laundryCopy(language), [language]);
  const [workDate, setWorkDate] = useState(todayBudapest);
  const [rooms, setRooms] = useState<LaundryRoom[]>([]);
  const [items, setItems] = useState<LinenCatalogueItem[]>([]);
  const [counts, setCounts] = useState<Count[]>([]);
  const [progress, setProgress] = useState<Progress[]>([]);
  const [buildingNames, setBuildingNames] = useState<Record<string, string>>({});
  const [selectedRoom, setSelectedRoom] = useState<LaundryRoom | null>(null);
  const [draft, setDraft] = useState<Record<string, number>>({});
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const eligible = !!user?.id && !!profile?.organization_slug && isGozsduCourtHotel(profile.assigned_hotel);

  const load = useCallback(async (silent = false) => {
    if (!eligible || !user?.id || !profile?.organization_slug) return;
    if (!silent) setLoading(true);
    try {
      const [roomResult, hotelItems, progressResult] = await Promise.all([
        supabase.from('rooms')
          .select('id, hotel, room_number, status, is_checkout_room, is_dnd, pms_metadata')
          .in('hotel', ['gozsdu-court', 'Gozsdu Court Budapest'])
          .eq('organization_slug', profile.organization_slug),
        loadHotelLinenCatalogue(profile.assigned_hotel),
        (supabase as any).from('gozsdu_laundry_room_progress')
          .select('room_id,status,reason').eq('organization_slug', profile.organization_slug)
          .eq('hotel_id', 'gozsdu-court').eq('work_date', workDate).eq('user_id', user.id),
      ]);
      if (roomResult.error) throw roomResult.error;
      if (progressResult.error) throw progressResult.error;
      const eligibleRooms = Object.values(groupLaundryRooms((roomResult.data || []) as LaundryRoom[])).flat();
      const roomIds = eligibleRooms.map(room => room.id);
      let savedCounts: Count[] = [];
      if (roomIds.length) {
        const result = await supabase.from('dirty_linen_counts')
          .select('room_id,linen_item_id,count').eq('housekeeper_id', user.id)
          .eq('work_date', workDate).in('room_id', roomIds);
        if (result.error) throw result.error;
        savedCounts = (result.data || []) as Count[];
      }
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
      setItems(hotelItems);
      setCounts(savedCounts);
      setProgress((progressResult.data || []) as Progress[]);
      setBuildingNames(map);
      setLoadFailed(false);
    } catch (error) {
      console.error('[GozsduLaundryner] failed to refresh', error);
      setLoadFailed(true);
      toast.error(copy.syncError);
    } finally {
      setLoading(false);
    }
  }, [eligible, profile?.assigned_hotel, profile?.organization_slug, user?.id, workDate, copy.syncError]);

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
    const allowed = new Set(items.map(item => item.id));
    for (const row of counts) {
      if (allowed.has(row.linen_item_id)) totals.set(row.room_id, (totals.get(row.room_id) || 0) + row.count);
    }
    return totals;
  }, [counts, items]);
  const finished = progress.filter(p => p.status === 'collected' || p.status === 'nothing_to_collect').length;

  const selectRoom = (room: LaundryRoom) => {
    if (loadFailed || busy || items.length === 0) return;
    setSelectedRoom(room);
    setDraft(Object.fromEntries(counts.filter(row => row.room_id === room.id)
      .map(row => [row.linen_item_id, row.count])));
    setReason(progressMap.get(room.id)?.reason || '');
  };

  const submit = async (status: Progress['status']) => {
    if (!selectedRoom || busy || !eligible || loadFailed || items.length === 0) return;
    if (todayBudapest() !== workDate) {
      setSelectedRoom(null);
      setWorkDate(todayBudapest());
      toast.error(copy.newDayError);
      return;
    }
    if (selectedRoom.is_dnd && status !== 'could_not_access') {
      toast.error(copy.dndError);
      return;
    }
    const payload = status === 'could_not_access' ? [] : items.map(item => ({
      linen_item_id: item.id,
      count: status === 'nothing_to_collect' ? 0 : (draft[item.id] || 0),
    }));
    if (status === 'collected' && payload.every(item => item.count === 0)) {
      toast.error(copy.countError);
      return;
    }
    if (status === 'could_not_access' && !reason.trim()) {
      toast.error(copy.reasonError);
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
      toast.success(status === 'collected' ? copy.successCollected
        : status === 'nothing_to_collect' ? copy.successNothing : copy.successBlocked);
    } catch (error: any) {
      console.error('[GozsduLaundryner] failed to save', error);
      toast.error(copy.saveError);
    } finally {
      setBusy(false);
    }
  };

  if (!eligible) return null;
  return <div className="space-y-4" data-testid="gozsdu-laundryner-workspace">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-semibold"><Shirt className="h-5 w-5" /> {copy.title}</h2>
        <p className="text-sm text-muted-foreground">Gozsdu Court Budapest • {workDate} • {finished}/{rooms.length} {copy.recorded}</p>
      </div>
      <Button size="sm" variant="outline" disabled={loading} onClick={() => { void load(); }}>
        <RefreshCw className="mr-1 h-4 w-4" /> {copy.refresh}
      </Button>
    </div>
    <p className="text-xs text-muted-foreground">{copy.duty}</p>
    {loading && <p role="status" className="text-sm"><Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> {copy.loading}</p>}
    {loadFailed && <div role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">
      {copy.syncError} <Button variant="outline" size="sm" onClick={() => { void load(); }}>{copy.refresh}</Button>
    </div>}
    {GROUPS.map(group => <Card key={group.key}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          {copy[group.title]} <Badge variant="secondary">{grouped[group.key].length}</Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground">{copy[group.description]}</p>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {grouped[group.key].map(room => {
          const state = progressMap.get(room.id);
          const total = countByRoom.get(room.id) || 0;
          const stateText = state?.status === 'collected' ? `${total} ${copy.collected}`
            : state?.status === 'nothing_to_collect' ? copy.nothing
              : state?.status === 'could_not_access' ? copy.noAccess : copy.notRecorded;
          return <button type="button" key={room.id} onClick={() => selectRoom(room)}
            disabled={loadFailed || busy || items.length === 0}
            className="min-w-[100px] rounded-xl border bg-background p-2 text-left text-sm shadow-sm hover:border-primary focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
            aria-label={`${copy.room} ${room.room_number}, ${stateText}`}>
            <span className="block font-semibold">{room.room_number}</span>
            {buildingNames[room.id] && <span className="block max-w-[155px] truncate text-[10px] text-muted-foreground">{buildingNames[room.id]}</span>}
            {room.is_dnd && <span className="block text-xs text-destructive">{copy.dnd}</span>}
            {state?.status === 'collected' && <span className="flex items-center gap-1 text-xs text-emerald-600"><CheckCircle2 className="h-3 w-3" /> {stateText}</span>}
            {state?.status === 'nothing_to_collect' && <span className="block text-xs text-emerald-600">{stateText}</span>}
            {state?.status === 'could_not_access' && <span className="flex items-center gap-1 text-xs text-amber-600"><TriangleAlert className="h-3 w-3" /> {stateText}</span>}
            {!state && <span className="block text-xs text-muted-foreground">{stateText}</span>}
          </button>;
        })}
        {grouped[group.key].length === 0 && <p className="text-sm text-muted-foreground">{copy.noRooms}</p>}
      </CardContent>
    </Card>)}
    <Dialog open={!!selectedRoom} onOpenChange={open => { if (!open && !busy) setSelectedRoom(null); }}>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
        <DialogHeader><DialogTitle>{copy.room} {selectedRoom?.room_number} • {copy.dirtyLinen}</DialogTitle></DialogHeader>
        {selectedRoom?.is_dnd ? <p className="text-sm text-destructive">{copy.dndWarning}</p>
          : <p className="text-sm text-muted-foreground">{copy.quantityHint}</p>}
        {!selectedRoom?.is_dnd && <div className="space-y-2">
          {items.map(item => <div key={item.id} className="flex items-center gap-2 rounded-md border px-3 py-2">
            <label htmlFor={`laundry-${item.id}`} className="min-w-0 flex-1 text-sm">{gozsduLinenLabel(item, language, t)}</label>
            <Button type="button" size="sm" variant="outline" disabled={busy || !draft[item.id]}
              aria-label={`− ${gozsduLinenLabel(item, language, t)}`}
              onClick={() => setDraft(old => ({ ...old, [item.id]: Math.max(0, (old[item.id] || 0) - 1) }))}>−</Button>
            <Input id={`laundry-${item.id}`} type="number" min={0} max={1000} step={1}
              aria-label={`${gozsduLinenLabel(item, language, t)} ${copy.quantity}`}
              className="w-16 text-center" disabled={busy} value={draft[item.id] ?? 0}
              onChange={event => {
                const raw = Number(event.target.value);
                if (Number.isInteger(raw) && raw >= 0 && raw <= 1000) setDraft(old => ({ ...old, [item.id]: raw }));
              }} />
            <Button type="button" size="sm" variant="outline" disabled={busy || (draft[item.id] || 0) >= 1000}
              aria-label={`+ ${gozsduLinenLabel(item, language, t)}`}
              onClick={() => setDraft(old => ({ ...old, [item.id]: (old[item.id] || 0) + 1 }))}>+</Button>
          </div>)}
          <div className="grid grid-cols-2 gap-2">
            <Button disabled={busy} onClick={() => { void submit('collected'); }}>{copy.save}</Button>
            <Button disabled={busy} variant="outline" onClick={() => { void submit('nothing_to_collect'); }}>{copy.nothingButton}</Button>
          </div>
        </div>}
        <div className="space-y-2 border-t pt-3">
          <label htmlFor="laundry-access-reason" className="text-sm font-medium">{copy.accessLabel}</label>
          <Input id="laundry-access-reason" value={reason} disabled={busy}
            placeholder={copy.reasonPlaceholder} onChange={event => setReason(event.target.value)} />
          <Button type="button" variant="secondary" disabled={busy || !reason.trim()}
            onClick={() => { void submit('could_not_access'); }}>{copy.accessButton}</Button>
        </div>
        {busy && <p role="status" className="text-sm"><Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> {copy.saving}</p>}
      </DialogContent>
    </Dialog>
  </div>;
}
