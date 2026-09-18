import { useCallback, useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { toast } from 'sonner';
import { Shirt, Plus, Minus, CheckCircle, Trash2, RefreshCw, AlertTriangle } from 'lucide-react';
import { getLocalDateString } from '@/lib/utils';
import { translateLinenItem } from '@/lib/linen-item-i18n';
import { isGozsduCourtHotel } from '@/lib/gozsdu-housekeeping';
import { gozsduLinenLabel, loadHotelLinenCatalogue, type LinenCatalogueItem } from '@/lib/gozsduLinenCatalogue';
import { DirtyLinenReliableQueue, dirtyLinenQueueKey, type LinenQueueSnapshot } from '@/lib/dirtyLinenReliableQueue';

interface DirtyLinenDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roomId: string;
  roomNumber: string;
  assignmentId?: string;
}
type LinenRecord = {
  id: string;
  linen_item_id: string;
  linen_item_name: string;
  count: number;
  room_id: string;
  room_number: string;
  display_name: string;
  work_date: string;
};
const initialSnapshot: LinenQueueSnapshot = { counts: {}, status: 'idle', pending: 0, error: null };

/** Every hotel keeps its existing queues, RLS, autosave, realtime and cart.
 * Gozsdu alone gets the separately scoped catalogue in paper-sheet order. */
export function DirtyLinenDialog({ open, onOpenChange, roomId, roomNumber, assignmentId }: DirtyLinenDialogProps) {
  const { user, profile } = useAuth();
  const { t, language } = useTranslation();
  const gozsdu = isGozsduCourtHotel(profile?.assigned_hotel);
  const displayName = (item: Pick<LinenCatalogueItem, 'name' | 'display_name'>) =>
    gozsdu ? gozsduLinenLabel(item, language, t) : translateLinenItem(item.display_name || item.name.replace(/_/g, ' '), t);
  const [workDate, setWorkDate] = useState(() => getLocalDateString(new Date()));
  const [linenItems, setLinenItems] = useState<LinenCatalogueItem[]>([]);
  const [myRecords, setMyRecords] = useState<LinenRecord[]>([]);
  const [showMyRecords, setShowMyRecords] = useState(false);
  const [queue, setQueue] = useState<DirtyLinenReliableQueue | null>(null);
  const [snapshot, setSnapshot] = useState<LinenQueueSnapshot>(initialSnapshot);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [catalogueError, setCatalogueError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const org = profile?.organization_slug;
  const userId = user?.id;

  const fetchMyRecords = useCallback(async () => {
    if (!userId) return;
    const { data: counts, error } = await supabase.from('dirty_linen_counts')
      .select('id, linen_item_id, count, work_date, room_id, created_at')
      .eq('housekeeper_id', userId).eq('work_date', workDate).gt('count', 0)
      .order('created_at', { ascending: false });
    if (error) { console.error('[DirtyLinen] cart refresh failed', error); return; }
    if (!counts?.length) { setMyRecords([]); return; }
    const roomIds = [...new Set(counts.map(row => row.room_id))];
    const itemIds = [...new Set(counts.map(row => row.linen_item_id))];
    const [rooms, items] = await Promise.all([
      supabase.from('rooms').select('id, room_number').in('id', roomIds),
      supabase.from('dirty_linen_items').select('id, name, display_name').in('id', itemIds),
    ]);
    if (rooms.error || items.error) {
      console.error('[DirtyLinen] cart metadata refresh failed', rooms.error || items.error);
      return;
    }
    const roomMap = new Map((rooms.data || []).map(row => [row.id, row.room_number]));
    const itemMap = new Map((items.data || []).map(row => [row.id, row]));
    setMyRecords(counts.map(row => ({
      id: row.id, linen_item_id: row.linen_item_id, count: row.count,
      work_date: row.work_date, room_id: row.room_id,
      room_number: roomMap.get(row.room_id) || 'Unknown',
      linen_item_name: itemMap.get(row.linen_item_id)?.name || '',
      display_name: itemMap.get(row.linen_item_id)?.display_name || 'Unknown item',
    })));
  }, [userId, workDate]);

  useEffect(() => {
    if (open) {
      const date = getLocalDateString(new Date());
      if (date !== workDate) setWorkDate(date);
    }
  }, [open, workDate]);

  useEffect(() => {
    if (!userId || !org || !roomId) {
      setQueue(null);
      setLoaded(false);
      return;
    }
    let mounted = true;
    let storage: Storage | null = null;
    try { storage = window.localStorage; } catch { /* private-mode storage may be blocked */ }
    const instance = new DirtyLinenReliableQueue({
      storageKey: dirtyLinenQueueKey(org, userId, roomId, workDate),
      storage,
      save: async (itemId, count) => {
        if (count === 0) {
          const { error } = await supabase.from('dirty_linen_counts').delete()
            .eq('housekeeper_id', userId).eq('room_id', roomId)
            .eq('linen_item_id', itemId).eq('work_date', workDate);
          if (error) throw error;
        } else {
          const { error } = await supabase.from('dirty_linen_counts').upsert({
            housekeeper_id: userId, room_id: roomId, assignment_id: assignmentId || null,
            linen_item_id: itemId, count, work_date: workDate,
          }, { onConflict: 'housekeeper_id,room_id,linen_item_id,work_date', ignoreDuplicates: false });
          if (error) throw error;
        }
      },
      onChange: value => { if (mounted) setSnapshot(value); },
      onSynced: () => { if (mounted) void fetchMyRecords(); },
    });
    setQueue(instance);
    setSnapshot(instance.snapshot());
    setLoaded(false);
    setLoadError(null);
    const loadCounts = async () => {
      const readRevision = instance.revision;
      const { data, error } = await supabase.from('dirty_linen_counts')
        .select('linen_item_id, count').eq('housekeeper_id', userId)
        .eq('room_id', roomId).eq('work_date', workDate);
      if (!mounted) return;
      if (error) {
        console.error('[DirtyLinen] initial count load failed', error);
        setLoadError(error.message);
        setLoaded(false);
        return;
      }
      if (instance.acceptServer(data || [], readRevision)) {
        setLoaded(true);
        setLoadError(null);
      }
      if (instance.hasPending) instance.flushNow();
    };
    void loadCounts();
    const online = () => instance.flushNow();
    const visible = () => { if (!document.hidden) instance.flushNow(); };
    window.addEventListener('online', online);
    document.addEventListener('visibilitychange', visible);
    return () => {
      mounted = false;
      instance.dispose();
      window.removeEventListener('online', online);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [userId, org, roomId, workDate, assignmentId, fetchMyRecords, refreshToken]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    const fetchItems = async () => {
      try {
        const data = await loadHotelLinenCatalogue(profile?.assigned_hotel);
        if (active) { setLinenItems(data); setCatalogueError(null); }
      } catch (error: any) {
        console.error('[DirtyLinen] catalogue load failed', error);
        if (active) { setLinenItems([]); setCatalogueError(error?.message || 'Failed to load linen items'); toast.error(error?.message || 'Failed to load linen items'); }
      }
    };
    void fetchItems();
    void fetchMyRecords();
    return () => { active = false; };
  }, [open, profile?.assigned_hotel, fetchMyRecords]);

  useEffect(() => {
    if (!open || !queue || !userId) return;
    let active = true;
    let refreshing = false;
    let needsRefresh = false;
    const refreshCounts = async () => {
      if (refreshing) { needsRefresh = true; return; }
      refreshing = true;
      do {
        needsRefresh = false;
        const version = queue.revision;
        const { data, error } = await supabase.from('dirty_linen_counts')
          .select('linen_item_id, count').eq('housekeeper_id', userId)
          .eq('room_id', roomId).eq('work_date', workDate);
        if (!active) break;
        if (!error && !queue.acceptServer(data || [], version)) needsRefresh = true;
      } while (active && needsRefresh && !queue.hasPending);
      refreshing = false;
    };
    const channel = supabase.channel(`dirty-linen-${userId}-${roomId}-${workDate}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dirty_linen_counts',
        filter: `room_id=eq.${roomId}` }, () => { void refreshCounts(); void fetchMyRecords(); }).subscribe();
    return () => { active = false; void supabase.removeChannel(channel); };
  }, [open, queue, userId, roomId, workDate, fetchMyRecords]);

  const change = (id: string, value: number) => queue?.setCount(id, value);
  const adjust = (id: string, delta: number) => queue?.adjust(id, delta);
  const total = useMemo(() => Object.values(snapshot.counts).reduce((sum, count) => sum + count, 0), [snapshot.counts]);
  const cartTotal = myRecords.reduce((sum, row) => sum + row.count, 0);
  const close = (value: boolean) => {
    if (!value && queue?.hasPending) {
      queue.flushNow();
      toast.info('Dirty linen changes are saved on this device and will sync automatically.');
    }
    onOpenChange(value);
  };
  const deleteRecord = async (record: LinenRecord) => {
    if (record.room_id === roomId && record.work_date === workDate && queue) {
      queue.setCount(record.linen_item_id, 0);
      queue.flushNow();
      return;
    }
    const { error } = await supabase.from('dirty_linen_counts')
      .delete().eq('id', record.id).eq('housekeeper_id', userId || '');
    if (error) toast.error(error.message);
    else { toast.success('Record deleted'); void fetchMyRecords(); }
  };

  return <Dialog open={open} onOpenChange={close}>
    <DialogContent className="max-w-2xl w-[96vw] max-h-[92vh] h-[92vh] flex flex-col p-3 sm:p-6 gap-2 overflow-hidden">
      <DialogHeader className="space-y-3">
        <div className="flex items-center gap-2 pr-8">
          <Shirt className="h-5 w-5 shrink-0" />
          <DialogTitle className="text-base sm:text-lg truncate">{t('dirtyLinen.title')} - {t('common.room')} {roomNumber}</DialogTitle>
        </div>
        <div className="flex justify-end w-full">
          <Button variant={showMyRecords ? 'default' : 'outline'} size="sm"
            onClick={() => { setShowMyRecords(value => !value); void fetchMyRecords(); }}
            className="max-w-full whitespace-normal text-left h-auto py-1.5 text-xs leading-tight">
            🛒 {t('dirtyLinen.myCart')} ({myRecords.length})
          </Button>
        </div>
      </DialogHeader>
      <div className="flex-1 min-h-0 overflow-y-auto pr-1">
        {showMyRecords ? <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">{t('dirtyLinen.myCart')}</h3>
            <Badge variant="outline">{t('dirtyLinen.totalItemsLabel').replace('{count}', String(cartTotal))}</Badge>
          </div>
          {snapshot.pending > 0 && <p className="text-xs text-amber-700" role="status">
            {snapshot.pending} item type(s) awaiting server confirmation. The cart shows confirmed records only.
          </p>}
          <p className="text-sm text-muted-foreground">{t('dirtyLinen.itemsCollectedFrom')}</p>
          {!myRecords.length ? <p className="py-10 text-center text-muted-foreground">{t('dirtyLinen.noItemsCollected')}</p>
            : <div className="space-y-3">{myRecords.map((record, index) => <Card key={record.id} className="border-l-4 border-l-primary p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="space-y-1 min-w-0">
                  <Badge>{t('common.room')} {record.room_number}</Badge>
                  {index === 0 && <Badge variant="secondary" className="ml-1">{t('dirtyLinen.latest')}</Badge>}
                  <p className="text-sm font-medium break-words">{displayName({ name: record.linen_item_name, display_name: record.display_name })} × {record.count}</p>
                  <p className="text-xs text-muted-foreground">{record.work_date}</p>
                </div>
                <AlertDialog>
                  <AlertDialogTrigger asChild><Button variant="ghost" size="icon" className="text-destructive shrink-0"><Trash2 className="h-5 w-5" /></Button></AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader><AlertDialogTitle>{t('dirtyLinen.removeConfirmTitle')}</AlertDialogTitle>
                      <AlertDialogDescription>{t('dirtyLinen.removeConfirmDescription')
                        .replace('{item}', displayName({ name: record.linen_item_name, display_name: record.display_name }))
                        .replace('{count}', String(record.count)).replace('{room}', record.room_number)}</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter><AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                      <AlertDialogAction onClick={() => { void deleteRecord(record); }} className="bg-destructive">{t('dirtyLinen.remove')}</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </Card>)}</div>}
        </div> : <>
          <div className="mb-2 flex items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2" aria-live="polite">
            <span className="text-sm font-semibold">{t('dirtyLinen.todaysCount')}</span>
            <div className="flex items-center gap-2 flex-wrap justify-end">
              <Badge variant="outline" className="text-xs">{total} {t('dirtyLinen.items')}</Badge>
              {snapshot.status === 'saved' && <span className="flex items-center gap-1 text-xs text-green-700"><CheckCircle className="h-3 w-3" /> {t('dirtyLinen.saved')}</span>}
              {(snapshot.status === 'pending' || snapshot.status === 'saving') && <span className="text-xs text-muted-foreground">{t('dirtyLinen.saving')} ({snapshot.pending})</span>}
              {snapshot.status === 'error' && <span role="alert" className="flex items-center gap-1 text-xs text-destructive"><AlertTriangle className="h-3 w-3" /> Not synced ({snapshot.pending})</span>}
            </div>
          </div>
          {snapshot.error && <div role="alert" className="mb-2 rounded-md border border-destructive/40 p-2 text-xs">
            <p className="break-words">{snapshot.error}</p>
            <Button size="sm" variant="outline" onClick={() => queue?.flushNow()} className="mt-2 gap-1"><RefreshCw className="h-3 w-3" /> Retry sync</Button>
          </div>}
          {loadError && <div role="alert" className="space-y-2 rounded-md border border-destructive/40 p-3 text-sm">
            Could not load today's current linen counts: {loadError}
            <Button size="sm" variant="outline" onClick={() => setRefreshToken(value => value + 1)}>Retry loading</Button>
          </div>}
          {catalogueError && <div role="alert" className="mb-2 rounded-md border border-destructive/40 p-2 text-xs">
            {catalogueError}<Button size="sm" variant="outline" onClick={() => setRefreshToken(value => value + 1)}>Retry loading</Button>
          </div>}
          {!loaded && !loadError && <p role="status" className="p-3 text-sm text-muted-foreground">Loading current linen counts…</p>}
          <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-2">
            {linenItems.map(item => <Card key={item.id} className="p-2 hover:bg-muted/50">
              <div className="flex flex-col gap-2">
                <div className="flex items-start gap-1.5">
                  <Shirt className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                  <Label className="text-xs sm:text-sm font-medium leading-tight break-words hyphens-auto">{displayName(item)}</Label>
                </div>
                <div className="flex items-center gap-1 w-full">
                  <Button type="button" variant="outline" size="sm" className="h-9 w-9 p-0 shrink-0"
                    disabled={!loaded || (snapshot.counts[item.id] ?? 0) === 0}
                    onClick={() => adjust(item.id, -1)} aria-label={`Remove one ${displayName(item)}`}><Minus className="h-4 w-4" /></Button>
                  <Input type="number" min="0" max="1000" inputMode="numeric"
                    disabled={!loaded} value={snapshot.counts[item.id] ?? 0}
                    onChange={event => change(item.id, Number(event.target.value))}
                    className="h-9 flex-1 min-w-0 px-1 text-center text-sm"
                    aria-label={`${displayName(item)} quantity`} />
                  <Button type="button" variant="outline" size="sm" className="h-9 w-9 p-0 shrink-0"
                    disabled={!loaded || (snapshot.counts[item.id] ?? 0) >= 1000}
                    onClick={() => adjust(item.id, 1)} aria-label={`Add one ${displayName(item)}`}><Plus className="h-4 w-4" /></Button>
                </div>
              </div>
            </Card>)}
          </div>
        </>}
      </div>
      <div className="flex gap-2 pt-2 shrink-0 border-t mt-1 items-center">
        <Button variant="outline" onClick={() => close(false)} className="flex-1">{t('common.close')}</Button>
        <div className="flex-1 text-center text-xs text-muted-foreground">
          {snapshot.pending > 0 ? `${snapshot.pending} pending • ${t('dirtyLinen.autoSave')}` : t('dirtyLinen.autoSave')}
        </div>
      </div>
    </DialogContent>
  </Dialog>;
}
