import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Loader2, RefreshCw, Shirt, TriangleAlert, LockKeyhole, UserRound, DoorOpen } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { supabase } from '@/integrations/supabase/client';
import { todayBudapest } from '@/lib/budapestTime';
import { type LaundryBucket, type LaundryRoom } from '@/lib/gozsduLaundryner';
import { isEligibleLaundryRoom } from '@/lib/gozsduLaundryner';
import { type LaundryAssignment, activeLaundryAssignments, groupCurrentLaundryRooms, isCheckout, laundryAccess, laundryService } from '@/lib/gozsduLaundryReadiness';
import { laundryAccessCopy } from '@/lib/gozsduLaundryReadinessI18n';
import { gozsduLinenLabel, loadHotelLinenCatalogue, type LinenCatalogueItem } from '@/lib/gozsduLinenCatalogue';
import { laundryCopy } from '@/lib/gozsduLaundrynerI18n';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { isGozsduCourtHotel } from '@/lib/gozsdu-housekeeping';

type Count = { room_id: string; linen_item_id: string; count: number };
type Progress = { room_id: string; status: 'collected' | 'nothing_to_collect' | 'could_not_access'; reason: string | null };
type Staff = { id: string; full_name: string | null; nickname: string | null };
const HOTELS = ['gozsdu-court', 'Gozsdu Court Budapest'];
const GROUPS: { key: LaundryBucket; title: 'checkout' | 'stayover' | 'other'; description: 'checkoutHint' | 'stayoverHint' | 'otherHint' }[] = [
  { key: 'checkout', title: 'checkout', description: 'checkoutHint' },
  { key: 'second_day', title: 'stayover', description: 'stayoverHint' },
  { key: 'other', title: 'other', description: 'otherHint' },
];

/** Only mounted for Gozsdu laundry duties. No housekeeping/PMS status is mutated here. */
export function GozsduLaundrynerTasksV2() {
  const { user, profile } = useAuth();
  const { t, language } = useTranslation();
  const copy = useMemo(() => laundryCopy(language), [language]);
  const accessCopy = useMemo(() => laundryAccessCopy(language), [language]);
  const [workDate, setWorkDate] = useState(todayBudapest);
  const [rooms, setRooms] = useState<LaundryRoom[]>([]);
  const [assignments, setAssignments] = useState<LaundryAssignment[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [items, setItems] = useState<LinenCatalogueItem[]>([]);
  const [counts, setCounts] = useState<Count[]>([]);
  const [progress, setProgress] = useState<Progress[]>([]);
  const [buildingNames, setBuildingNames] = useState<Record<string, string>>({});
  const [selectedRoom, setSelectedRoom] = useState<LaundryRoom | null>(null);
  const [draft, setDraft] = useState<Record<string, number>>({});
  const [reason, setReason] = useState('');
  const [guestPermission, setGuestPermission] = useState(false);
  const [loading, setLoading] = useState(true);
  const [checkingRoomId, setCheckingRoomId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const eligible = !!user?.id && !!profile?.organization_slug && isGozsduCourtHotel(profile.assigned_hotel);

  const liveRoom = useCallback(async (id: string) => {
    if (!profile?.organization_slug) throw new Error('Missing hotel access');
    const [roomResponse, assignmentResponse] = await Promise.all([
      supabase.from('rooms')
        .select('id,hotel,room_number,status,is_checkout_room,is_dnd,pms_metadata')
        .eq('id', id).eq('organization_slug', profile.organization_slug).in('hotel', HOTELS).maybeSingle(),
      supabase.from('room_assignments')
        .select('id,room_id,assigned_to,assignment_type,status,ready_to_clean,is_dnd,pms_hold,notes,updated_at')
        .eq('room_id', id).eq('organization_slug', profile.organization_slug).eq('assignment_date', workDate),
    ]);
    if (roomResponse.error || assignmentResponse.error || !roomResponse.data) throw roomResponse.error || assignmentResponse.error || new Error('Room unavailable');
    return { room: roomResponse.data as LaundryRoom, assignments: (assignmentResponse.data || []) as LaundryAssignment[] };
  }, [profile?.organization_slug, workDate]);

  const load = useCallback(async (silent = false) => {
    if (!eligible || !user?.id || !profile?.organization_slug) return;
    if (!silent) setLoading(true);
    try {
      const [roomResponse, catalogue, progressResponse, sectionsResponse] = await Promise.all([
        supabase.from('rooms')
          .select('id,hotel,room_number,status,is_checkout_room,is_dnd,pms_metadata')
          .in('hotel', HOTELS).eq('organization_slug', profile.organization_slug),
        loadHotelLinenCatalogue(profile.assigned_hotel),
        (supabase as any).from('gozsdu_laundry_room_progress')
          .select('room_id,status,reason').eq('organization_slug', profile.organization_slug)
          .eq('hotel_id', 'gozsdu-court').eq('work_date', workDate).eq('user_id', user.id),
        (supabase as any).from('hotel_housekeeping_sections').select('id,name')
          .eq('hotel_name', 'Gozsdu Court Budapest').eq('is_active', true),
      ]);
      if (roomResponse.error || progressResponse.error || sectionsResponse.error) throw roomResponse.error || progressResponse.error || sectionsResponse.error;
      const currentRooms = ((roomResponse.data || []) as LaundryRoom[]).filter(isEligibleLaundryRoom);
      const ids = currentRooms.map(row => row.id);
      let liveAssignments: LaundryAssignment[] = [];
      let savedCounts: Count[] = [];
      if (ids.length) {
        const [assignmentResponse, countResponse] = await Promise.all([
          supabase.from('room_assignments')
            .select('id,room_id,assigned_to,assignment_type,status,ready_to_clean,is_dnd,pms_hold,notes,updated_at')
            .eq('organization_slug', profile.organization_slug).eq('assignment_date', workDate).in('room_id', ids),
          supabase.from('dirty_linen_counts').select('room_id,linen_item_id,count')
            .eq('housekeeper_id', user.id).eq('work_date', workDate).in('room_id', ids),
        ]);
        if (assignmentResponse.error || countResponse.error) throw assignmentResponse.error || countResponse.error;
        liveAssignments = (assignmentResponse.data || []) as LaundryAssignment[];
        savedCounts = (countResponse.data || []) as Count[];
      }
      const names: Record<string, string> = {};
      const sectionIds = (sectionsResponse.data || []).map((section: any) => section.id);
      if (sectionIds.length) {
        const sectionResponse = await (supabase as any).from('hotel_housekeeping_section_rooms')
          .select('room_id,section_id').in('section_id', sectionIds);
        if (sectionResponse.error) throw sectionResponse.error;
        const sections = new Map((sectionsResponse.data || []).map((section: any) => [section.id, section.name]));
        for (const mapping of sectionResponse.data || []) names[mapping.room_id] = sections.get(mapping.section_id) as string || '';
      }
      const staffIds = [...new Set(activeLaundryAssignments(liveAssignments).map(row => row.assigned_to).filter((id): id is string => !!id))];
      let people: Staff[] = [];
      if (staffIds.length) {
        const staffResponse = await supabase.from('profiles').select('id,full_name,nickname')
          .eq('organization_slug', profile.organization_slug).in('assigned_hotel', HOTELS).in('id', staffIds);
        if (staffResponse.error) throw staffResponse.error;
        people = (staffResponse.data || []) as Staff[];
      }
      setRooms(currentRooms);
      setItems(catalogue);
      setCounts(savedCounts);
      setAssignments(liveAssignments);
      setStaff(people);
      setProgress((progressResponse.data || []) as Progress[]);
      setBuildingNames(names);
      // An open dialog must never retain an old green checkout after a PMS/assignment update.
      setSelectedRoom(previous => {
        if (!previous) return null;
        const latest = currentRooms.find(room => room.id === previous.id);
        if (!latest) return null;
        const currentAssignments = liveAssignments.filter(row => row.room_id === latest.id);
        if (isCheckout(latest) && laundryAccess(latest, currentAssignments, workDate) !== 'ready') return null;
        return latest;
      });
      setLoadFailed(false);
    } catch (error) {
      console.error('[GozsduLaundryner] room information refresh failed', error);
      setSelectedRoom(null);
      setLoadFailed(true);
      if (!silent) toast.error(copy.syncError);
    } finally {
      setLoading(false);
    }
  }, [eligible, user?.id, profile?.organization_slug, profile?.assigned_hotel, workDate, copy.syncError]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!eligible) return;
    const channel = supabase.channel(`gozsdu-laundry-safe-${user?.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, () => { void load(true); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_assignments' }, () => { void load(true); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gozsdu_laundry_room_progress' }, () => { void load(true); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dirty_linen_counts' }, () => { void load(true); })
      .subscribe();
    const poll = window.setInterval(() => {
      const date = todayBudapest();
      if (date !== workDate) { setSelectedRoom(null); setWorkDate(date); }
      else void load(true);
    }, 20_000);
    const onVisible = () => { if (!document.hidden) void load(true); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.clearInterval(poll); document.removeEventListener('visibilitychange', onVisible); void supabase.removeChannel(channel); };
  }, [eligible, user?.id, workDate, load]);

  const grouped = useMemo(() => groupCurrentLaundryRooms(rooms, assignments, workDate), [rooms, assignments, workDate]);
  const assignmentMap = useMemo(() => {
    const map = new Map<string, LaundryAssignment[]>();
    for (const row of assignments) map.set(row.room_id, [...(map.get(row.room_id) || []), row]);
    return map;
  }, [assignments]);
  const staffNames = useMemo(() => new Map(staff.map(row => [row.id, row.nickname || row.full_name || accessCopy.unassigned])), [staff, accessCopy.unassigned]);
  const progressMap = useMemo(() => new Map(progress.map(row => [row.room_id, row])), [progress]);
  const countByRoom = useMemo(() => {
    const map = new Map<string, number>();
    const allowed = new Set(items.map(item => item.id));
    for (const row of counts) if (allowed.has(row.linen_item_id)) map.set(row.room_id, (map.get(row.room_id) || 0) + row.count);
    return map;
  }, [counts, items]);
  const finished = progress.filter(row => row.status === 'collected' || row.status === 'nothing_to_collect').length;
  const checkoutReady = grouped.checkout.filter(room => laundryAccess(room, assignmentMap.get(room.id) || [], workDate) === 'ready').length;
  const selectedAssignments = selectedRoom ? assignmentMap.get(selectedRoom.id) || [] : [];
  const selectedAccess = selectedRoom ? laundryAccess(selectedRoom, selectedAssignments, workDate) : 'unavailable';
  const serviceLabel = (room: LaundryRoom, rows: LaundryAssignment[]) => {
    const service = laundryService(room, rows, workDate);
    return service === 'full' ? accessCopy.full : service === 'textile' ? accessCopy.textile
      : service === 'towel' ? accessCopy.towel : service === 'daily' ? accessCopy.daily : accessCopy.noService;
  };
  const housekeepers = (rows: LaundryAssignment[]) => {
    const ids = [...new Set(activeLaundryAssignments(rows).map(row => row.assigned_to).filter((id): id is string => !!id))];
    return ids.length ? ids.map(id => staffNames.get(id) || accessCopy.unassigned).join(', ') : accessCopy.unassigned;
  };
  const accessLabel = (access: ReturnType<typeof laundryAccess>) => access === 'ready' ? accessCopy.ready
    : access === 'guest_inside' ? accessCopy.guestInside : access === 'guest_permission' ? accessCopy.guestPermission
      : access === 'dnd' ? accessCopy.dnd : accessCopy.unavailable;

  const selectRoom = async (room: LaundryRoom) => {
    if (loadFailed || busy || checkingRoomId || items.length === 0) return;
    const known = laundryAccess(room, assignmentMap.get(room.id) || [], workDate);
    if (isCheckout(room) && known !== 'ready') return;
    setCheckingRoomId(room.id);
    try {
      const latest = await liveRoom(room.id);
      const access = laundryAccess(latest.room, latest.assignments, workDate);
      if (isCheckout(latest.room) && access !== 'ready') {
        toast.error(accessCopy.cannotOpen);
        await load(true);
        return;
      }
      if (access === 'unavailable') { toast.error(copy.syncError); await load(true); return; }
      const countResponse = await supabase.from('dirty_linen_counts').select('room_id,linen_item_id,count')
        .eq('housekeeper_id', user!.id).eq('work_date', workDate).eq('room_id', room.id);
      if (countResponse.error) throw countResponse.error;
      setDraft(Object.fromEntries((countResponse.data || []).map(row => [row.linen_item_id, row.count])));
      setReason(progressMap.get(room.id)?.reason || '');
      setGuestPermission(false);
      setSelectedRoom(latest.room);
      setAssignments(old => [...old.filter(row => row.room_id !== room.id), ...latest.assignments]);
    } catch (error) {
      console.error('[GozsduLaundryner] access verification failed', error);
      setLoadFailed(true);
      setSelectedRoom(null);
      toast.error(copy.syncError);
    } finally { setCheckingRoomId(null); }
  };

  const submit = async (status: Progress['status']) => {
    if (!selectedRoom || busy || !eligible || loadFailed || items.length === 0) return;
    if (todayBudapest() !== workDate) {
      setSelectedRoom(null); setWorkDate(todayBudapest()); toast.error(copy.newDayError); return;
    }
    if (status !== 'could_not_access' && !isCheckout(selectedRoom) && !guestPermission) {
      toast.error(accessCopy.permissionMissing); return;
    }
    if (status === 'could_not_access' && !reason.trim()) { toast.error(copy.reasonError); return; }
    const payload = status === 'could_not_access' ? [] : items.map(item => ({
      linen_item_id: item.id, count: status === 'nothing_to_collect' ? 0 : (draft[item.id] || 0),
    }));
    if (status === 'collected' && payload.every(item => item.count === 0)) { toast.error(copy.countError); return; }
    setBusy(true);
    try {
      const latest = await liveRoom(selectedRoom.id);
      const access = laundryAccess(latest.room, latest.assignments, workDate);
      if (access === 'unavailable' || (isCheckout(latest.room) && access !== 'ready')
        || (access === 'dnd' && status !== 'could_not_access')) {
        setSelectedRoom(null);
        toast.error(access === 'guest_inside' ? accessCopy.cannotOpen : accessCopy.roomUpdated);
        await load(true);
        return;
      }
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
    } catch (error) {
      console.error('[GozsduLaundryner] save rejected', error);
      toast.error(copy.saveError);
      await load(true);
    } finally { setBusy(false); }
  };

  if (!eligible) return null;
  return <div className="space-y-4" data-testid="gozsdu-laundryner-workspace">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-semibold"><Shirt className="h-5 w-5" /> {copy.title}</h2>
        <p className="text-sm text-muted-foreground">Gozsdu Court Budapest • {workDate} • {finished}/{rooms.length} {copy.recorded}</p>
        <p className="mt-1 flex items-center gap-1 text-xs font-medium text-emerald-700"><DoorOpen className="h-4 w-4" />{checkoutReady}/{grouped.checkout.length} {accessCopy.readyCount}</p>
      </div>
      <Button size="sm" variant="outline" disabled={loading || busy} onClick={() => { void load(); }}>
        <RefreshCw className="mr-1 h-4 w-4" />{copy.refresh}
      </Button>
    </div>
    <p className="text-xs text-muted-foreground">{copy.duty}</p>
    {loading && <p role="status" className="text-sm"><Loader2 className="mr-1 inline h-4 w-4 animate-spin" />{copy.loading}</p>}
    {loadFailed && <div role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">
      {copy.syncError} <Button variant="outline" size="sm" onClick={() => { void load(); }}>{copy.refresh}</Button>
    </div>}
    {GROUPS.map(group => <Card key={group.key}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          {group.key === 'second_day' ? accessCopy.serviceDue : copy[group.title]}
          <Badge variant="secondary">{grouped[group.key].length}</Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground">{copy[group.description]}</p>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {grouped[group.key].map(room => {
          const rows = assignmentMap.get(room.id) || [];
          const access = laundryAccess(room, rows, workDate);
          const state = progressMap.get(room.id);
          const total = countByRoom.get(room.id) || 0;
          const stateText = state?.status === 'collected' ? `${total} ${copy.collected}`
            : state?.status === 'nothing_to_collect' ? copy.nothing
              : state?.status === 'could_not_access' ? copy.noAccess : copy.notRecorded;
          const locked = isCheckout(room) && access !== 'ready';
          return <button type="button" key={room.id} onClick={() => { void selectRoom(room); }}
            disabled={loadFailed || loading || busy || !!checkingRoomId || items.length === 0 || locked}
            className={`min-w-0 space-y-1 rounded-xl border p-3 text-left text-sm shadow-sm focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed ${locked ? 'border-amber-300 bg-amber-50 text-amber-950 dark:bg-amber-950/20 dark:text-amber-100' : 'bg-background hover:border-primary'} ${loadFailed ? 'opacity-60' : ''}`}
            aria-label={`${copy.room} ${room.room_number}, ${accessLabel(access)}, ${serviceLabel(room, rows)}, ${accessCopy.housekeeper}: ${housekeepers(rows)}, ${stateText}`}
            aria-disabled={locked} title={locked ? accessCopy.cannotOpen : undefined}>
            <span className="block text-base font-semibold">{room.room_number} {checkingRoomId === room.id && <Loader2 className="inline h-3 w-3 animate-spin" />}</span>
            {buildingNames[room.id] && <span className="block truncate text-[11px] text-muted-foreground">{buildingNames[room.id]}</span>}
            <span className={`flex items-start gap-1 text-xs font-semibold ${access === 'ready' ? 'text-emerald-700 dark:text-emerald-400' : access === 'guest_permission' ? 'text-amber-700 dark:text-amber-300' : 'text-destructive'}`}>
              {locked || access === 'dnd' ? <LockKeyhole className="mt-0.5 h-3 w-3 shrink-0" /> : <DoorOpen className="mt-0.5 h-3 w-3 shrink-0" />}
              <span>{accessLabel(access)}</span>
            </span>
            <span className="block text-xs">{serviceLabel(room, rows)}</span>
            <span className="flex items-start gap-1 text-xs text-muted-foreground"><UserRound className="mt-0.5 h-3 w-3 shrink-0" /><span className="min-w-0 break-words">{accessCopy.housekeeper}: {housekeepers(rows)}</span></span>
            {state?.status === 'collected' && <span className="flex items-center gap-1 text-xs text-emerald-600"><CheckCircle2 className="h-3 w-3" />{stateText}</span>}
            {state?.status === 'nothing_to_collect' && <span className="block text-xs text-emerald-600">{stateText}</span>}
            {state?.status === 'could_not_access' && <span className="flex items-center gap-1 text-xs text-amber-600"><TriangleAlert className="h-3 w-3" />{stateText}</span>}
            {!state && <span className="block text-xs text-muted-foreground">{stateText}</span>}
          </button>;
        })}
        {grouped[group.key].length === 0 && <p className="col-span-full text-sm text-muted-foreground">{copy.noRooms}</p>}
      </CardContent>
    </Card>)}
    <Dialog open={!!selectedRoom} onOpenChange={open => { if (!open && !busy) setSelectedRoom(null); }}>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
        <DialogHeader><DialogTitle>{copy.room} {selectedRoom?.room_number} • {copy.dirtyLinen}</DialogTitle></DialogHeader>
        {selectedRoom && <div className="space-y-1 rounded-md border p-3 text-sm">
          <p className="font-semibold">{accessLabel(selectedAccess)}</p>
          <p>{accessCopy.service}: {serviceLabel(selectedRoom, selectedAssignments)}</p>
          <p>{accessCopy.housekeeper}: {housekeepers(selectedAssignments)}</p>
        </div>}
        {selectedAccess === 'dnd' ? <p role="alert" className="text-sm text-destructive">{copy.dndWarning}</p>
          : <p className="text-sm text-muted-foreground">{copy.quantityHint}</p>}
        {selectedRoom && !isCheckout(selectedRoom) && selectedAccess !== 'dnd' && <label className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950/20 dark:text-amber-100">
          <Checkbox checked={guestPermission} onCheckedChange={value => setGuestPermission(value === true)} disabled={busy} aria-label={accessCopy.accessConfirm} />
          <span><strong className="block">{accessCopy.accessConfirm}</strong>{accessCopy.accessReminder}</span>
        </label>}
        {selectedAccess !== 'dnd' && <div className="space-y-2">
          {items.map(item => <div key={item.id} className="flex items-center gap-2 rounded-md border px-3 py-2">
            <label htmlFor={`laundry-${item.id}`} className="min-w-0 flex-1 text-sm">{gozsduLinenLabel(item, language, t)}</label>
            <Button type="button" size="sm" variant="outline" disabled={busy || !draft[item.id]}
              aria-label={`− ${gozsduLinenLabel(item, language, t)}`}
              onClick={() => setDraft(old => ({ ...old, [item.id]: Math.max(0, (old[item.id] || 0) - 1) }))}>−</Button>
            <Input id={`laundry-${item.id}`} type="number" min={0} max={1000} step={1}
              aria-label={`${gozsduLinenLabel(item, language, t)} ${copy.quantity}`}
              className="w-16 text-center" disabled={busy} value={draft[item.id] ?? 0}
              onChange={event => { const value = Number(event.target.value); if (Number.isInteger(value) && value >= 0 && value <= 1000) setDraft(old => ({ ...old, [item.id]: value })); }} />
            <Button type="button" size="sm" variant="outline" disabled={busy || (draft[item.id] || 0) >= 1000}
              aria-label={`+ ${gozsduLinenLabel(item, language, t)}`}
              onClick={() => setDraft(old => ({ ...old, [item.id]: (old[item.id] || 0) + 1 }))}>+</Button>
          </div>)}
          <div className="grid grid-cols-2 gap-2">
            <Button disabled={busy || (!isCheckout(selectedRoom!) && !guestPermission)} onClick={() => { void submit('collected'); }}>{copy.save}</Button>
            <Button disabled={busy || (!isCheckout(selectedRoom!) && !guestPermission)} variant="outline" onClick={() => { void submit('nothing_to_collect'); }}>{copy.nothingButton}</Button>
          </div>
        </div>}
        <div className="space-y-2 border-t pt-3">
          <label htmlFor="laundry-access-reason" className="text-sm font-medium">{copy.accessLabel}</label>
          <Input id="laundry-access-reason" value={reason} disabled={busy} placeholder={copy.reasonPlaceholder} onChange={event => setReason(event.target.value)} />
          <Button type="button" variant="secondary" disabled={busy || !reason.trim()} onClick={() => { void submit('could_not_access'); }}>{copy.accessButton}</Button>
        </div>
        {busy && <p role="status" className="text-sm"><Loader2 className="mr-1 inline h-4 w-4 animate-spin" />{copy.saving}</p>}
      </DialogContent>
    </Dialog>
  </div>;
}
