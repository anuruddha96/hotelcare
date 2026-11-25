import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Shirt, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { supabase } from '@/integrations/supabase/client';
import { todayBudapest } from '@/lib/budapestTime';
import { isGozsduCourtHotel } from '@/lib/gozsdu-housekeeping';
import { gozsduLinenLabel, loadHotelLinenCatalogue, type LinenCatalogueItem } from '@/lib/gozsduLinenCatalogue';
import { summarizeGozsduLinen, type CollectionRoom, type CollectionCount, type CollectionAssignment, type UnallocatedDailyBatch } from '@/lib/gozsduLinenDailyBreakdown';
import { gozsduLinenSummaryCopy } from '@/lib/gozsduLinenSummaryI18n';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const HOTEL_NAMES = ['gozsdu-court', 'Gozsdu Court Budapest'];
type Props = { mode: 'own' | 'manager' };
type Staff = { id: string; full_name: string | null; nickname: string | null };

/** Additive, Gozsdu-only reporting. Does not edit existing reports or room assignments. */
export function GozsduLinenCollectionBreakdown({ mode }: Props) {
  const { user, profile } = useAuth();
  const { t, language } = useTranslation();
  const copy = useMemo(() => gozsduLinenSummaryCopy(language), [language]);
  const [workDate, setWorkDate] = useState(todayBudapest);
  const [rooms, setRooms] = useState<CollectionRoom[]>([]);
  const [counts, setCounts] = useState<CollectionCount[]>([]);
  const [assignments, setAssignments] = useState<CollectionAssignment[]>([]);
  const [batches, setBatches] = useState<UnallocatedDailyBatch[]>([]);
  const [items, setItems] = useState<LinenCatalogueItem[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [bulkAvailable, setBulkAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const eligible = !!user?.id && !!profile?.organization_slug && isGozsduCourtHotel(profile.assigned_hotel);
  const readOnly = mode === 'manager';
  const label = (item: LinenCatalogueItem) => gozsduLinenLabel(item, language, t);

  const load = useCallback(async () => {
    if (!eligible || !user?.id || !profile?.organization_slug) return;
    try {
      const [roomResult, catalogue] = await Promise.all([
        supabase.from('rooms').select('id,room_number,is_checkout_room,pms_metadata')
          .eq('organization_slug', profile.organization_slug).in('hotel', HOTEL_NAMES),
        loadHotelLinenCatalogue(profile.assigned_hotel),
      ]);
      if (roomResult.error) throw roomResult.error;
      const hotelRooms = (roomResult.data || []) as CollectionRoom[];
      const roomIds = hotelRooms.map(room => room.id);
      const saved: CollectionCount[] = [];
      let activeAssignments: CollectionAssignment[] = [];
      if (roomIds.length) {
        // Supabase's default 1,000-row limit must not silently hide daily counts.
        for (let start = 0; ; start += 1000) {
          let query = supabase.from('dirty_linen_counts')
            .select('id,room_id,housekeeper_id,linen_item_id,count')
            .eq('work_date', workDate).in('room_id', roomIds).gt('count', 0)
            .order('id', { ascending: true }).range(start, start + 999);
          if (!readOnly) query = query.eq('housekeeper_id', user.id);
          const result = await query;
          if (result.error) throw result.error;
          saved.push(...((result.data || []) as CollectionCount[]));
          if ((result.data || []).length < 1000) break;
        }
        const assignmentResult = await supabase.from('room_assignments')
          .select('room_id,assigned_to,assignment_type,status')
          .eq('organization_slug', profile.organization_slug).eq('assignment_date', workDate).in('room_id', roomIds);
        if (assignmentResult.error) throw assignmentResult.error;
        activeAssignments = (assignmentResult.data || []) as CollectionAssignment[];
      }
      let dailyBatches: UnallocatedDailyBatch[] = [];
      let available = true;
      let batchQuery = (supabase as any).from('gozsdu_laundry_unallocated_daily')
        .select('user_id,item_counts').eq('organization_slug', profile.organization_slug)
        .eq('hotel_id', 'gozsdu-court').eq('work_date', workDate);
      if (!readOnly) batchQuery = batchQuery.eq('user_id', user.id);
      const batchResult = await batchQuery;
      if (batchResult.error) {
        const code = batchResult.error.code;
        if (code === '42P01' || code === 'PGRST205') available = false;
        else throw batchResult.error;
      } else dailyBatches = (batchResult.data || []) as UnallocatedDailyBatch[];
      let people: Staff[] = [];
      if (readOnly) {
        const ids = [...new Set([...saved.map(row => row.housekeeper_id), ...dailyBatches.map(row => row.user_id)])];
        if (ids.length) {
          const peopleResult = await supabase.from('profiles').select('id,full_name,nickname')
            .eq('organization_slug', profile.organization_slug).in('assigned_hotel', HOTEL_NAMES).in('id', ids);
          if (peopleResult.error) throw peopleResult.error;
          people = (peopleResult.data || []) as Staff[];
        }
      }
      setRooms(hotelRooms);
      setCounts(saved);
      setAssignments(activeAssignments);
      setItems(catalogue);
      setBatches(dailyBatches);
      setBulkAvailable(available);
      setStaff(people);
      setError(false);
    } catch (caught) {
      console.error('[GozsduLinenBreakdown] failed to load', caught);
      setError(true); // Never display stale totals as current after a failed refresh.
    } finally { setLoading(false); }
  }, [eligible, user?.id, profile?.organization_slug, profile?.assigned_hotel, workDate, readOnly]);

  useEffect(() => { setLoading(true); void load(); }, [load]);
  useEffect(() => {
    if (!eligible) return;
    const refresh = () => { void load(); };
    const interval = window.setInterval(() => {
      const date = todayBudapest();
      if (date !== workDate) { setEditing(false); setWorkDate(date); }
      else void load();
    }, 30_000);
    window.addEventListener('dirty-linen-updated', refresh);
    const visible = () => { if (!document.hidden) void load(); };
    document.addEventListener('visibilitychange', visible);
    return () => { window.clearInterval(interval); window.removeEventListener('dirty-linen-updated', refresh); document.removeEventListener('visibilitychange', visible); };
  }, [eligible, workDate, load]);

  const breakdown = useMemo(() => summarizeGozsduLinen(rooms, counts, assignments, batches,
    items.map(item => item.id), workDate), [rooms, counts, assignments, batches, items, workDate]);
  const names = useMemo(() => new Map(staff.map(person => [person.id, person.nickname || person.full_name || person.id])), [staff]);
  const person = (id: string) => readOnly ? names.get(id) || copy.collector : '';
  const myBatch = batches.find(row => row.user_id === user?.id);
  const startEdit = () => {
    setDraft(Object.fromEntries(items.map(item => [item.id, Number(myBatch?.item_counts?.[item.id] || 0)])));
    setEditing(true);
  };
  const saveBatch = async () => {
    if (readOnly || !eligible || saving || !bulkAvailable || todayBudapest() !== workDate) return;
    setSaving(true);
    try {
      const payload = items.map(item => ({ linen_item_id: item.id, count: draft[item.id] || 0 }));
      const response = await (supabase as any).rpc('record_gozsdu_unallocated_daily_linen', { p_counts: payload });
      if (response.error) throw response.error;
      setEditing(false);
      await load();
      window.dispatchEvent(new CustomEvent('dirty-linen-updated'));
      toast.success(copy.saved);
    } catch (caught) {
      console.error('[GozsduLinenBreakdown] batch save failed', caught);
      toast.error(copy.saveError);
    } finally { setSaving(false); }
  };
  const itemRows = (values: Record<string, number>) => items.filter(item => (values[item.id] || 0) > 0)
    .map(item => <div key={item.id} className="flex justify-between gap-3 py-1 text-sm">
      <span>{label(item)}</span><span className="tabular-nums font-semibold">{values[item.id]}</span>
    </div>);
  const renderRooms = (category: 'checkout' | 'daily') => {
    const entries = breakdown.roomDetails.filter(row => row.category === category);
    return entries.length ? entries.map(entry => <details key={`${entry.roomId}:${entry.userId}`} className="rounded-md border px-3 py-2">
      <summary className="cursor-pointer flex items-center justify-between gap-2 text-sm font-medium">
        <span>{copy.room} {entry.room}{readOnly && <span className="block text-xs font-normal text-muted-foreground">{person(entry.userId)}</span>}</span>
        <strong className="tabular-nums">{entry.total}</strong>
      </summary>
      <div className="mt-2 border-t pt-2">{itemRows(entry.byItem)}</div>
    </details>) : <p className="text-xs text-muted-foreground">{copy.none}</p>;
  };

  if (!eligible) return null;
  return <Card className="space-y-3 p-4" data-testid={`gozsdu-linen-breakdown-${mode}`}>
    <div className="flex items-center justify-between gap-2">
      <div><h3 className="flex items-center gap-2 text-lg font-bold"><Shirt className="h-4 w-4" />{copy.title}</h3>
        <p className="text-xs text-muted-foreground">{workDate} • {copy.recorded}</p></div>
      <Button variant="outline" size="sm" disabled={loading || saving} onClick={() => { void load(); }}>
        <RefreshCw className="mr-1 h-4 w-4" />{copy.updated}
      </Button>
    </div>
    {loading && <p role="status" className="text-xs"><Loader2 className="mr-1 inline h-3 w-3 animate-spin" />{copy.saving}</p>}
    {error ? <p role="alert" className="text-sm text-destructive">{copy.error}</p> : <>
      <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <div className="rounded-md border bg-muted/30 p-3"><p>{copy.checkout}</p><strong className="text-2xl tabular-nums">{breakdown.checkoutTotal}</strong></div>
        <div className="rounded-md border bg-muted/30 p-3"><p>{copy.roomDaily}</p><strong className="text-2xl tabular-nums">{breakdown.dailyRoomTotal}</strong></div>
        <div className="rounded-md border bg-muted/30 p-3"><p>{copy.unallocated}</p><strong className="text-2xl tabular-nums">{bulkAvailable ? breakdown.unallocatedDailyTotal : '—'}</strong></div>
        <div className="rounded-md border border-emerald-400 bg-emerald-50 p-3 text-emerald-950 dark:bg-emerald-950/20 dark:text-emerald-100"><p>{copy.total}</p>
          <strong className="text-2xl tabular-nums">{bulkAvailable ? breakdown.grandTotal : '—'}</strong></div>
      </div>
      <p className="text-xs text-muted-foreground">{copy.explanation}</p>
      {!bulkAvailable && <p role="status" className="text-sm text-amber-700">{copy.setup}</p>}
      <details className="rounded-md border p-3"><summary className="cursor-pointer font-semibold">{copy.checkout} — {breakdown.checkoutTotal} · {copy.details}</summary>
        <div className="mt-3 space-y-2">{renderRooms('checkout')}</div>
      </details>
      <details className="rounded-md border p-3"><summary className="cursor-pointer font-semibold">{copy.daily} — {bulkAvailable ? breakdown.dailyTotal : breakdown.dailyRoomTotal} · {copy.details}</summary>
        <div className="mt-3 space-y-2">
          <p className="text-xs font-semibold">{copy.roomDaily} — {breakdown.dailyRoomTotal}</p>
          {renderRooms('daily')}
          <p className="border-t pt-2 text-xs font-semibold">{copy.unknown} — {bulkAvailable ? breakdown.unallocatedDailyTotal : '—'}</p>
          {breakdown.bulkByUser.map(batch => <details key={batch.userId} className="rounded-md border px-3 py-2">
            <summary className="cursor-pointer flex justify-between gap-2 text-sm font-medium"><span>{readOnly ? person(batch.userId) : copy.unallocated}</span><strong>{batch.total}</strong></summary>
            <div className="mt-2 border-t pt-2">{itemRows(batch.byItem)}</div>
          </details>)}
        </div>
      </details>
      <details className="rounded-md border p-3"><summary className="cursor-pointer font-semibold">{copy.items}</summary>
        <div className="mt-3 space-y-1">
          <div className="grid grid-cols-[minmax(0,1fr)_repeat(4,50px)] gap-1 text-[10px] font-semibold text-muted-foreground">
            <span>{copy.items}</span><span>{copy.checkout}</span><span>{copy.roomDaily}</span><span>{copy.unallocated}</span><span>{copy.total}</span>
          </div>
          {items.map(item => {
            const c = breakdown.checkoutItems[item.id] || 0;
            const d = breakdown.dailyRoomItems[item.id] || 0;
            const u = breakdown.unallocatedItems[item.id] || 0;
            return <div key={item.id} className="grid grid-cols-[minmax(0,1fr)_repeat(4,50px)] gap-1 border-t py-2 text-xs tabular-nums">
              <span className="break-words">{label(item)}</span><span>{c}</span><span>{d}</span><span>{bulkAvailable ? u : '—'}</span><strong>{bulkAvailable ? c + d + u : '—'}</strong>
            </div>;
          })}
        </div>
      </details>
      {breakdown.legacyTotal > 0 && <p className="text-xs text-muted-foreground">{breakdown.legacyTotal} — {copy.legacy}</p>}
      {readOnly && <p className="text-xs text-muted-foreground">{copy.roomReport}</p>}
      {!readOnly && bulkAvailable && <div className="space-y-3 border-t pt-3">
        {!editing ? <Button type="button" variant="outline" className="w-full" onClick={startEdit}>
          {myBatch ? copy.editExisting : copy.edit}
        </Button> : <div className="space-y-3">
          <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-950 dark:bg-amber-950/20 dark:text-amber-100">{copy.note}</p>
          {items.map(item => <label key={item.id} className="flex items-center justify-between gap-2 text-sm">
            <span className="min-w-0 flex-1">{label(item)}</span>
            <Input type="number" min={0} max={1000} step={1} className="w-20 text-center" disabled={saving}
              aria-label={`${label(item)} quantity`} value={draft[item.id] ?? 0}
              onChange={event => { const value = Number(event.target.value); if (Number.isInteger(value) && value >= 0 && value <= 1000) setDraft(old => ({ ...old, [item.id]: value })); }} />
          </label>)}
          <div className="flex justify-end gap-2"><Button variant="outline" disabled={saving} onClick={() => setEditing(false)}>{copy.cancel}</Button>
            <Button disabled={saving} onClick={() => { void saveBatch(); }}>{saving ? copy.saving : copy.save}</Button></div>
        </div>}
      </div>}
    </>}
  </Card>;
}
