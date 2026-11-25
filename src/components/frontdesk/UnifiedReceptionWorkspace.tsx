import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { RoomStatePeriodManager } from '@/components/dashboard/RoomStatePeriodManager';
import {
  CalendarDays, Coffee, List, LogIn, LogOut, Plus, Search,
  Users, AlertTriangle,
  Hourglass, ListOrdered, Sparkles, Waves,
} from 'lucide-react';
import { ReservationCalendar, type RoomStatus } from '@/components/reservations/ReservationCalendar';
import { CreateReservationDialog } from '@/components/reservations/CreateReservationDialog';
import { CheckInDialog } from '@/components/frontdesk/CheckInDialog';
import { VizaGuestRecoveryCard } from '@/components/frontdesk/VizaGuestRecoveryCard';
import { WalkInSaleDialog } from '@/components/frontdesk/WalkInSaleDialog';
import { CheckOutDialog } from '@/components/frontdesk/CheckOutDialog';
import { PmsSyncButton } from '@/components/frontdesk/PmsSyncButton';
import { toast } from 'sonner';
import { useOperationalHotel } from '@/hooks/useOperationalHotel';
import { useReservationSearch, mergeSearchResults } from '@/hooks/useReservationSearch';
import { useTranslation } from '@/hooks/useTranslation';
import { todayBudapest, tomorrowBudapest } from '@/lib/budapestTime';
import { auditReceptionSnapshots, type ReceptionSnapshot } from '@/lib/receptionSnapshotAudit';
import { reservationChannel, reservationGuestLabel, reservationSearchText, RESERVATION_STATUS_COLORS } from '@/lib/reservations';
import { floatingState, importFreshness } from '@/lib/receptionAttention';
import { useGuestSignals } from '@/hooks/useGuestSignals';
import { GuestSignalBadge } from '@/components/guests/GuestSignalBadge';
import type { GuestSignal } from '@/lib/guestJourney';

const RES_SELECT = '*, guests!reservations_guest_id_fkey(first_name, last_name, email, phone, vip_status, id_document_number), rooms:room_id(id, room_number, room_type, status)';
type ViewMode = 'planner' | 'list';

type SnapshotRow = ReceptionSnapshot & {
  room_type_code: string | null;
  pax: number | null;
  source: string | null;
};

type ImportHistory = { created_at: string; sync_status: string | null };

const FRESHNESS_STYLE = {
  fresh: 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300',
  aging: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300',
  stale: 'border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300',
  never: 'border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300',
} as const;

function agoLabel(minutes: number, t: (key: string) => string): string {
  if (minutes < 1) return t('pms.sync.justNow');
  if (minutes < 60) return `${minutes} ${t('pms.sync.minAgo')}`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} ${t('pms.sync.hoursAgo')}`;
  return `${Math.round(minutes / 1440)} ${t('pms.sync.daysAgo')}`;
}

function snapshotStatus(value: string | null): string {
  const status = String(value ?? '').trim().toLowerCase();
  if (['ongoing', 'departing', 'in house', 'inhouse'].includes(status)) return 'checked_in';
  if (['cancelled', 'canceled'].includes(status)) return 'cancelled';
  if (['no show', 'no_show'].includes(status)) return 'no_show';
  // An unrecognised snapshot status does not establish a confirmed booking.
  return 'pending';
}

function isSnapshotOnly(row: any): boolean { return row?.snapshotOnly === true; }

function SideSection({ title, icon: Icon, items, onOpen, actionLabel, onAction, signals, actionAnchor }: {
  title: string;
  icon: typeof Users;
  items: any[];
  onOpen: (row: any) => void;
  /** Returning-guest / VIP markers per reservation id. */
  signals?: Map<string, GuestSignal>;
  /** One-tap action per row (e.g. Check in / Check out) so reception never has to hunt. */
  actionLabel?: string;
  actionAnchor?: string;
  onAction?: (row: Record<string, unknown>) => void;
}) {
  const { t } = useTranslation();
  return <details open className="border-b border-border last:border-b-0 group">
    <summary className="list-none cursor-pointer select-none px-3 py-2 bg-muted/45 hover:bg-muted/70 flex items-center justify-between gap-2">
      <span className="flex items-center gap-2 min-w-0 text-xs font-semibold uppercase tracking-wide"><Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" /><span className="truncate">{title}</span></span>
      <Badge variant="secondary" className="h-5 min-w-5 justify-center px-1.5 text-[10px]">{items.length}</Badge>
    </summary>
    <div className="divide-y divide-border/70">
      {items.length === 0 ? <div className="px-3 py-3 text-xs text-muted-foreground">—</div> : items.slice(0, 12).map((row) =>
        <div key={row.id} className="flex items-stretch">
          <button type="button" onClick={() => onOpen(row)} disabled={isSnapshotOnly(row)}
            className="flex-1 min-w-0 text-left px-3 py-2 hover:bg-accent/40 disabled:hover:bg-transparent transition-colors disabled:cursor-default"
            title={isSnapshotOnly(row) ? t('pms.unified.snapshotReadOnly') : undefined}>
            <div className="flex items-start justify-between gap-2"><div className="min-w-0">
              <div className="flex items-center gap-1 min-w-0"><span className="text-xs font-semibold truncate">{reservationGuestLabel(row)}</span><GuestSignalBadge signal={signals?.get(row.id)} /></div>
              <div className="text-[10px] text-muted-foreground truncate mt-0.5">{row.rooms?.room_number || row.room_label || t('pms.unified.unassigned')} · {row.check_in_date?.slice(5)} → {row.check_out_date?.slice(5)}</div>
            </div><span className="text-[10px] text-primary shrink-0 font-medium">{reservationChannel(row).label}</span></div>
          </button>
          {actionLabel && onAction && !isSnapshotOnly(row) && (
            <button type="button" data-training={actionAnchor} onClick={() => onAction(row)}
              className="shrink-0 px-2 my-1.5 mr-1.5 rounded-md border border-border text-[11px] font-medium text-primary hover:bg-primary hover:text-primary-foreground transition-colors">
              {actionLabel}
            </button>
          )}
        </div>,
      )}
    </div>
  </details>;
}

export function UnifiedReceptionWorkspace({ breakfastUploadPath }: { breakfastUploadPath?: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { organizationSlug } = useParams<{ organizationSlug: string }>();
  const basePath = `/${organizationSlug || 'rdhotels'}`;
  const { hotelId, hotelKeys, isPortfolio, canSync, ready } = useOperationalHotel();
  const requestId = useRef(0);
  const [reservations, setReservations] = useState<any[]>([]);
  const [snapshots, setSnapshots] = useState<SnapshotRow[]>([]);
  const [rooms, setRooms] = useState<any[]>([]);
  const [periodRoom, setPeriodRoom] = useState<{ id: string; room_number: string } | null>(null);
  const [importHistory, setImportHistory] = useState<ImportHistory | null>(null);
  const [lastImportSuccess, setLastImportSuccess] = useState<string | null>(null);
  // Bookings Previo no longer returns: hidden from the plan and counts, but never silently.
  const [hiddenNotInPrevio, setHiddenNotInPrevio] = useState(0);
  const [loadingData, setLoadingData] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [search, setSearch] = useState('');
  const [view, setView] = useState<ViewMode>('planner');
  const [createOpen, setCreateOpen] = useState(false);
  const [walkInOpen, setWalkInOpen] = useState(false);
  const [statPanel, setStatPanel] = useState<'arrivals' | 'departures' | 'inhouse' | 'unassigned' | null>(null);
  // One-tap check-in / check-out straight from the side lists.
  const [actioned, setActioned] = useState<{ row: Record<string, unknown>; dialog: 'checkin' | 'checkout' } | null>(null);
  const today = todayBudapest();
  const tomorrow = tomorrowBudapest();
  const isOttofiori = hotelId?.toLowerCase() === 'ottofiori';
  // Hotels where HotelCare itself is the PMS (no Previo): no import freshness,
  // no Previo warnings, and bookings without a room must stay visible.
  const [nativeHotel, setNativeHotel] = useState(false);
  useEffect(() => {
    let alive = true;
    setNativeHotel(false);
    if (!hotelId) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc('pms_ari_native_hotel', { _hotel_id: hotelId })
      .then(({ data }: { data: boolean | null }) => { if (alive) setNativeHotel(Boolean(data)); });
    return () => { alive = false; };
  }, [hotelId]);
  const keysKey = hotelKeys.join('|');

  const fetchAll = useCallback(async () => {
    const seq = ++requestId.current;
    if (!ready || !hotelId || isPortfolio) {
      setReservations([]); setSnapshots([]); setRooms([]); setImportHistory(null);
      setLoadingData(false);
      return;
    }
    setLoadingData(true);
    setLoadError(false);
    const from = new Date(); from.setDate(from.getDate() - 45);
    const to = new Date(); to.setDate(to.getDate() + 210);
    const keys = hotelKeys.length ? hotelKeys : [hotelId];
    try {
      const [res, rm, snap, history, lastSuccess] = await Promise.all([
        supabase.from('reservations').select(RES_SELECT).in('hotel_id', keys)
          .gte('check_out_date', from.toISOString().slice(0, 10)).lte('check_in_date', to.toISOString().slice(0, 10))
          .order('check_in_date', { ascending: true }).limit(2000),
        supabase.from('rooms').select('id, room_number, room_type, status, hotel').in('hotel', keys).limit(1500),
        supabase.from('daily_overview_snapshots')
          .select('id, hotel_id, business_date, room_label, room_number, room_type_code, arrival_date, departure_date, status, guest_names, pax, source, captured_at')
          .eq('hotel_id', hotelId).order('captured_at', { ascending: false }).limit(5000),
        supabase.from('pms_sync_history').select('created_at, sync_status').eq('hotel_id', hotelId)
          .eq('sync_type', 'reservations').order('created_at', { ascending: false }).limit(1),
        supabase.from('pms_sync_history').select('created_at').eq('hotel_id', hotelId)
          .eq('sync_type', 'reservations').eq('sync_status', 'success').order('created_at', { ascending: false }).limit(1),
      ]);
      if (seq !== requestId.current) return; // Ignore responses from a previously selected property.
      if (res.error || rm.error || snap.error || history.error) {
        setReservations([]); setRooms([]); setSnapshots([]); setImportHistory(null);
        setLoadError(true); // Never show previous-property data when a read fails.
        return;
      }
      const allRows = res.data ?? [];
      const visible = allRows.filter((row: any) => !row.pms_missing_since);
      setReservations(visible);
      // Only bookings that would still matter (not yet departed) are worth mentioning.
      setHiddenNotInPrevio(allRows.filter((row: any) => row.pms_missing_since && row.check_out_date >= today).length);
      setRooms(rm.data ?? []);
      setSnapshots((snap.data ?? []) as SnapshotRow[]);
      setImportHistory(history.data?.[0] ?? null);
      setLastImportSuccess(lastSuccess.error ? null : lastSuccess.data?.[0]?.created_at ?? null);
    } catch {
      if (seq !== requestId.current) return;
      setReservations([]); setRooms([]); setSnapshots([]); setImportHistory(null);
      setLoadError(true);
    } finally {
      if (seq === requestId.current) setLoadingData(false);
    }
  }, [ready, hotelId, isPortfolio, keysKey]);

  useEffect(() => { void fetchAll(); return () => { requestId.current += 1; }; }, [fetchAll]);

  // Live updates: a scheduled Previo import, another receptionist's check-in or a
  // housekeeper finishing a room refreshes the plan. Bursts (an import writes
  // hundreds of rows) collapse into one refresh.
  useEffect(() => {
    if (!ready || !hotelId || isPortfolio) return;
    const keys = hotelKeys.length ? hotelKeys : [hotelId];
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { void fetchAll(); }, 2500);
    };
    // Separate channels: if one table is not streamed yet, the other keeps working.
    const bookings = supabase.channel(`reception-bookings-${hotelId}`);
    const roomStates = supabase.channel(`reception-rooms-${hotelId}`);
    for (const key of keys) {
      bookings.on('postgres_changes', { event: '*', schema: 'public', table: 'reservations', filter: `hotel_id=eq.${key}` }, schedule);
      roomStates.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `hotel=eq.${key}` }, schedule);
    }
    bookings.subscribe();
    roomStates.subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(bookings);
      void supabase.removeChannel(roomStates);
    };
  }, [ready, hotelId, isPortfolio, keysKey, fetchAll]);

  // Reception sets a room's status with the same write housekeeping uses, so the
  // housekeeping boards, room history and the PMS status push all see it.
  // Out of order / maintenance is only ever left on purpose (confirmed here).
  const changeRoomStatus = useCallback(async (room: { id: string; room_number: string; status?: string | null }, next: RoomStatus) => {
    const label = (value: string) => t(`pms.room.status_${value}`);
    const current = String(room.status ?? '');
    if (['out_of_order', 'maintenance'].includes(current) && !['out_of_order', 'maintenance'].includes(next)
      && !window.confirm(t('pms.room.releaseConfirm').replace('{room}', room.room_number).replace('{status}', label(current).toLowerCase()))) return;
    const patch: Record<string, unknown> = { status: next };
    if (next === 'clean') {
      patch.last_cleaned_at = new Date().toISOString();
      const { data: auth } = await supabase.auth.getUser();
      if (auth.user?.id) patch.last_cleaned_by = auth.user.id;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await supabase.from('rooms').update(patch as any).eq('id', room.id).select('id,status').maybeSingle();
    if (error || !data) { toast.error(error?.message || t('pms.room.statusFailed')); return; }
    if (data.status !== next) { toast.error(t('ntak.phase4.activeOverride')); void fetchAll(); return; }
    setRooms((list) => list.map((item) => (item.id === room.id ? { ...item, status: data.status } : item)));
    toast.success(t('pms.room.statusSaved').replace('{room}', room.room_number).replace('{status}', label(next).toLowerCase()));
  }, [t]);

  const snapshotAudit = useMemo(() => hotelId
    ? auditReceptionSnapshots(hotelId, snapshots, rooms, reservations, Date.now())
    : null, [hotelId, snapshots, rooms, reservations]);

  const snapshotReservations = useMemo(() => (snapshotAudit?.records ?? []).map(({ snapshot, roomId }) => {
    const room = rooms.find((candidate) => candidate.id === roomId);
    return {
      id: `snapshot:${snapshot.id}`, snapshotOnly: true, reservation_number: 'SNAPSHOT',
      hotel_id: snapshot.hotel_id, status: snapshotStatus(snapshot.status),
      check_in_date: snapshot.arrival_date, check_out_date: snapshot.departure_date,
      source: 'previo_snapshot', pms_guest_name: snapshot.guest_names,
      adults: snapshot.pax ?? 0, children: 0, room_id: roomId,
      room_label: snapshot.room_label, captured_at: snapshot.captured_at,
      rooms: room ? { id: room.id, room_number: room.room_number, room_type: room.room_type, status: room.status } : null,
    };
  }), [snapshotAudit, rooms]);

  // Only persisted reservation rows may contribute to reception KPIs.
  // A daily snapshot has no trustworthy reservation ID and is never a booking.
  const plannerRows = useMemo(() => [...reservations, ...snapshotReservations], [reservations, snapshotReservations]);
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return term ? plannerRows.filter((row) => reservationSearchText(row).includes(term)) : plannerRows;
  }, [plannerRows, search]);
  // Instant results for the main search: real reservations only, soonest first.
  const localMatches = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (term.length < 2) return [];
    return reservations
      .filter((row) => reservationSearchText(row).includes(term))
      .sort((a, b) => {
        const rank = (r: any) => (r.status === 'checked_in' ? 0 : ['pending', 'confirmed'].includes(r.status) ? 1 : 2);
        return rank(a) - rank(b) || String(a.check_in_date).localeCompare(String(b.check_in_date));
      })
      .slice(0, 8);
  }, [reservations, search]);
  // The planner only loads -45d..+210d, so the search box also asks the server,
  // which covers every date and the guest's passport/ID number.
  const { serverResults, searching } = useReservationSearch(
    hotelKeys.length ? hotelKeys : (hotelId ? [hotelId] : []), search,
  );
  const quickMatches = useMemo(
    () => mergeSearchResults(serverResults, localMatches, 8),
    [serverResults, localMatches],
  );
  const arrivals = useMemo(() => reservations.filter((row) => row.check_in_date === today && ['pending', 'confirmed'].includes(row.status)), [reservations, today]);
  const departures = useMemo(() => reservations.filter((row) => row.check_out_date === today && row.status === 'checked_in'), [reservations, today]);
  const inHouse = useMemo(() => reservations.filter((row) => row.status === 'checked_in' && row.check_in_date <= today && row.check_out_date > today), [reservations, today]);
  const unassigned = useMemo(() => reservations.filter((row) => !row.room_id && ['pending', 'confirmed', 'checked_in'].includes(row.status) && row.check_out_date > today)
    .sort((a, b) => String(a.check_in_date).localeCompare(String(b.check_in_date))), [reservations, today]);
  // A future booking without a room is normal ("floating" in Previo). It becomes
  // a warning only when the guest arrives today/tomorrow or is already in house.
  const unassignedUrgent = useMemo(() => unassigned.filter((row) => row.status === 'checked_in' || floatingState(row, today) === 'urgent').length, [unassigned, today]);
  const expiringOptions = useMemo(() => reservations
    .filter((row) => row.status === 'pending' && Number(row.pms_status_id) === 1 && row.check_out_date > today)
    .sort((a, b) => String(a.pms_option_expires_at ?? '9').localeCompare(String(b.pms_option_expires_at ?? '9'))), [reservations, today]);
  const waitingList = useMemo(() => reservations.filter((row) => row.status === 'pending' && Number(row.pms_status_id) === 6 && row.check_out_date > today), [reservations, today]);
  const newOnline = useMemo(() => {
    const since = Date.now() - 24 * 60 * 60 * 1000;
    return reservations
      .filter((row) => ['pending', 'confirmed'].includes(row.status) && Date.parse(row.created_at ?? '') >= since
        && !['walk_in', 'direct', 'phone', 'email'].includes(String(row.source || '')))
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  }, [reservations]);
  const floatingTitle = nativeHotel ? t('pms.planner.unassignedSection') : t('pms.cal.floating');
  const upcomingOnline = useMemo(() => reservations
    .filter((row) => row.check_in_date > today && ['pending', 'confirmed'].includes(row.status) && !['walk_in', 'direct', 'phone', 'email'].includes(String(row.source || '')))
    .sort((a, b) => String(a.check_in_date).localeCompare(String(b.check_in_date))).slice(0, 20), [reservations, today]);
  const tomorrowCheckIns = useMemo(() => reservations.filter((row) =>
    row.check_in_date === tomorrow && ['pending', 'confirmed'].includes(row.status),
  ), [reservations, tomorrow]);
  // Returning guests and VIPs are marked in every list reception works from.
  const guestSignals = useGuestSignals([
    ...arrivals, ...departures, ...inHouse, ...unassigned, ...newOnline, ...upcomingOnline, ...tomorrowCheckIns,
  ].filter((row) => !isSnapshotOnly(row)).map((row) => row.id));
  const freshness = importFreshness(lastImportSuccess);
  const lastImportTime = importHistory?.created_at ? Date.parse(importHistory.created_at) : NaN;
  const importStale = !Number.isFinite(lastImportTime) || lastImportTime > Date.now() || Date.now() - lastImportTime > 24 * 60 * 60 * 1000 || importHistory?.sync_status !== 'success';

  const openReservation = (row: any) => { if (!isSnapshotOnly(row)) navigate(`${basePath}/reservations/${row.id}`); };
  if (ready && !hotelId && !isPortfolio) return <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">{t('pms.fd.noPropertyAssigned')}</CardContent></Card>;
  if (ready && !hotelId && isPortfolio) return <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">{t('pms.fd.selectProperty')}</CardContent></Card>;

  return <div className="space-y-3" data-training="reception-workspace">
    <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-bold">{t('pms.fd.title')}</h1>
        <div className="mt-0.5 flex flex-wrap items-center gap-2">
          <p className="text-xs text-muted-foreground">{today}</p>
          {!loadingData && !loadError && !nativeHotel && (
            <span
              role="status"
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${FRESHNESS_STYLE[freshness.state]}`}
              title={lastImportSuccess ? new Date(lastImportSuccess).toLocaleString() : undefined}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${freshness.state === 'fresh' ? 'bg-emerald-500' : freshness.state === 'aging' ? 'bg-amber-500' : 'bg-red-500'}`} aria-hidden="true" />
              {freshness.minutes == null
                ? t('pms.sync.neverImported')
                : `${t('pms.sync.previoBookings')} · ${agoLabel(freshness.minutes, t)}`}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex border border-border rounded-md overflow-hidden">
          <Button type="button" size="sm" title={t('pms.tip.planner')} variant={view === 'planner' ? 'default' : 'ghost'} className="rounded-none h-9 gap-1" onClick={() => setView('planner')}>🗓️ <span className="hidden sm:inline">{t('pms.planner.title')}</span></Button>
          <Button type="button" size="sm" title={t('pms.tip.list')} variant={view === 'list' ? 'default' : 'ghost'} className="rounded-none h-9 gap-1" onClick={() => setView('list')}>📋 <span className="hidden sm:inline">{t('pms.reservations.title')}</span></Button>
        </div>
        {breakfastUploadPath && <Link to={breakfastUploadPath} title={t('pms.tip.breakfast')}><Button type="button" size="sm" variant="outline" className="h-9 gap-1.5">🥐 <span className="hidden lg:inline">{t('pms.fd.breakfastUpload')}</span></Button></Link>}
        {canSync && hotelId && !nativeHotel && <span title="🔄 Pull the latest bookings from Previo."><PmsSyncButton hotelId={hotelId} onSynced={fetchAll} compact /></span>}
        {hotelId && organizationSlug && !isPortfolio && <Button type="button" size="sm" variant="outline" className="h-9 gap-1" onClick={() => setWalkInOpen(true)}>{t('ntak.phase5.title')}</Button>}
        <Button type="button" size="sm" title={t('pms.tip.newReservation')} className="h-9 gap-1" onClick={() => setCreateOpen(true)}>➕ {t('pms.fd.newReservation')}</Button>
      </div>
    </div>


    {hotelId && !isPortfolio && <VizaGuestRecoveryCard key={hotelId} hotelId={hotelId} />}
    <div className="relative" data-training="fd-quick-search">
      <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
      <Input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter' && quickMatches[0]) openReservation(quickMatches[0]); if (event.key === 'Escape') setSearch(''); }}
        placeholder={t('pms.fd.searchPlaceholder')}
        aria-label={t('pms.fd.searchPlaceholder')}
        autoFocus
        className="h-12 pl-11 text-base rounded-xl border-2 border-primary/30 focus-visible:border-primary shadow-sm"
      />
      {search.trim().length >= 2 && (
        <div className="absolute z-40 mt-1 w-full rounded-xl border border-border bg-popover shadow-lg overflow-hidden">
          {quickMatches.length === 0
            ? <div className="px-4 py-3 text-sm text-muted-foreground">{searching ? '…' : t('pms.cal.noMatches')}</div>
            : quickMatches.map((row) => (
              <div key={row.id} className="flex items-center gap-3 px-4 py-2.5 border-b border-border/60 last:border-b-0 hover:bg-accent/40">
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => openReservation(row)}>
                  <div className="text-sm font-semibold truncate">{reservationGuestLabel(row)} <span className="text-xs font-normal text-muted-foreground">· {row.reservation_number}</span></div>
                  <div className="text-xs text-muted-foreground truncate">{row.rooms?.room_number || t('pms.unified.unassigned')} · {row.check_in_date} → {row.check_out_date} · {String(row.status).replace('_', ' ')}</div>
                </button>
                {['pending', 'confirmed'].includes(row.status) && (
                  <Button type="button" size="sm" className="h-8 shrink-0" onClick={() => { setSearch(''); setActioned({ row, dialog: 'checkin' }); }}>{t('pms.checkIn')}</Button>
                )}
                {row.status === 'checked_in' && (
                  <Button type="button" size="sm" variant="outline" className="h-8 shrink-0" onClick={() => { setSearch(''); setActioned({ row, dialog: 'checkout' }); }}>{t('pms.checkOut')}</Button>
                )}
                <Button type="button" size="sm" variant="ghost" className="h-8 shrink-0" onClick={() => openReservation(row)}>{t('pms.open')}</Button>
              </div>
            ))}
        </div>
      )}
    </div>

    {loadError && <div role="alert" className="rounded-md border border-destructive/50 p-3 text-xs text-destructive flex items-center gap-2"><AlertTriangle className="h-4 w-4" />Unable to load the room plan. <Button variant="outline" size="sm" onClick={fetchAll}>Retry</Button></div>}
    {!loadingData && !loadError && !nativeHotel && (importStale || snapshotReservations.length > 0 || (snapshotAudit?.ambiguousRooms ?? 0) > 0) &&
      <details role="status" className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/20 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
        <summary className="cursor-pointer select-none flex items-center gap-2 font-medium">
          ⚠️ {t('pms.fd.pmsAttention')}
          <span className="ml-auto text-[11px] underline underline-offset-2">{t('pms.fd.details')}</span>
        </summary>
        <div className="mt-2 pl-6 text-muted-foreground">
          {importStale ? `Latest reservation import: ${importHistory?.created_at ? new Date(importHistory.created_at).toLocaleString() : 'not recorded'} (${importHistory?.sync_status ?? 'unknown'}). ` : ''}
          {snapshotReservations.length > 0 ? `${snapshotReservations.length} PMS observations could not be matched to HotelCare reservations. ` : ''}
          {(snapshotAudit?.ambiguousRooms ?? 0) > 0 ? `${snapshotAudit?.ambiguousRooms} room labels could not be mapped uniquely. ` : ''}
          {hiddenNotInPrevio > 0 ? `${hiddenNotInPrevio} ${t('pms.fd.hiddenNotInPrevio')} ` : ''}
          Verify the affected reservation in Previo before changing it.
        </div>
      </details>}

    {!loadingData && !loadError && !nativeHotel && !importStale && hiddenNotInPrevio > 0 && (
      <p className="text-[11px] text-muted-foreground" data-training="fd-hidden-note">ℹ️ {hiddenNotInPrevio} {t('pms.fd.hiddenNotInPrevio')}</p>
    )}
    {isOttofiori && !loadingData && !loadError && importStale && (
      <div role="alert" className="rounded-md border border-amber-400/60 bg-amber-50/70 dark:bg-amber-950/20 p-3 text-xs space-y-1">
        <p className="font-semibold">Tomorrow check-ins ({tomorrow}) are not verified against Previo.</p>
        <p>HotelCare has {tomorrowCheckIns.length} older reservation records for this date, but the latest reservation import has not succeeded. Do not use this number as tomorrow’s arrivals. Use Sync now above, and verify the guest list in Previo until the import succeeds.</p>
      </div>
    )}
    <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide pb-1" aria-label="HotelCare records only; not validated against Previo" data-training="fd-today-strip">
      {([
        { key: 'arrivals' as const, label: `🛬 ${t('pms.fd.arrivalsRemaining')}`, rows: arrivals, tone: 'border-emerald-300 bg-emerald-50 text-emerald-900 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100', active: 'ring-2 ring-emerald-500' },
        { key: 'departures' as const, label: `🧳 ${t('pms.fd.departuresRemaining')}`, rows: departures, tone: 'border-orange-300 bg-orange-50 text-orange-900 hover:bg-orange-100 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-100', active: 'ring-2 ring-orange-500' },
        { key: 'inhouse' as const, label: `🛏️ ${t('pms.fd.inHouseNow')}`, rows: inHouse, tone: 'border-sky-300 bg-sky-50 text-sky-900 hover:bg-sky-100 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-100', active: 'ring-2 ring-sky-500' },
        { key: 'unassigned' as const, label: `${unassignedUrgent ? '❓' : '🌊'} ${floatingTitle}`, rows: unassigned, tone: 'border-violet-300 bg-violet-50 text-violet-900 hover:bg-violet-100 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-100', active: 'ring-2 ring-violet-500' },
      ]).map((stat) => (
        <button key={stat.key} type="button" title={t('pms.fd.todayChipTip')}
          aria-expanded={statPanel === stat.key}
          onClick={() => setStatPanel(statPanel === stat.key ? null : stat.key)}
          className={`h-8 shrink-0 rounded-md border px-2.5 flex items-center gap-1.5 text-xs font-medium transition-colors ${stat.tone} ${statPanel === stat.key ? stat.active : ''}`}>
          <span>{stat.label}</span><span className="rounded-full bg-white/70 dark:bg-black/30 px-1.5 text-[11px] font-bold tabular-nums">{loadingData || loadError ? '—' : stat.rows.length}</span>
        </button>
      ))}
      <div className="h-8 shrink-0 rounded-md border border-dashed border-border px-2.5 flex items-center gap-2 text-[11px] text-muted-foreground" aria-hidden="true">
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" />{t('pms.status.checkedIn')}</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-blue-500" />{t('pms.status.confirmed')}</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-slate-400" />{t('pms.status.checkedOut')}</span>
      </div>
    </div>

    {statPanel && (() => {
      const rows = statPanel === 'arrivals' ? arrivals : statPanel === 'departures' ? departures : statPanel === 'inhouse' ? inHouse : unassigned;
      return <div className="rounded-xl border border-border bg-card divide-y divide-border/60 overflow-hidden" data-training="fd-today-panel">
        {rows.length === 0 && <div className="px-4 py-3 text-sm text-muted-foreground">{t('pms.fd.nothingHere')}</div>}
        {rows.slice(0, 12).map((row) => (
          <div key={row.id} className="flex items-center gap-3 px-4 py-2 hover:bg-accent/30">
            <button type="button" className="min-w-0 flex-1 text-left" onClick={() => openReservation(row)}>
              <div className="flex items-center gap-1.5 min-w-0 text-sm font-medium"><span className="truncate">{reservationGuestLabel(row)}</span><GuestSignalBadge signal={guestSignals.get(row.id)} /><span className="shrink-0 text-xs font-normal text-muted-foreground">· {row.rooms?.room_number || t('pms.unified.unassigned')}</span></div>
              <div className="text-xs text-muted-foreground truncate">{row.check_in_date} → {row.check_out_date}</div>
            </button>
            <Badge className={`${RESERVATION_STATUS_COLORS[row.status] || 'bg-muted'} text-[10px]`}>{String(row.status).replace('_', ' ')}</Badge>
            {['pending', 'confirmed'].includes(row.status) && (
              <Button type="button" size="sm" className="h-8 shrink-0" onClick={() => setActioned({ row, dialog: 'checkin' })}>{t('pms.checkIn')}</Button>
            )}
            {row.status === 'checked_in' && statPanel !== 'inhouse' && (
              <Button type="button" size="sm" variant="outline" className="h-8 shrink-0" onClick={() => setActioned({ row, dialog: 'checkout' })}>{t('pms.checkOut')}</Button>
            )}
          </div>
        ))}
        {rows.length > 12 && <div className="px-4 py-2 text-xs text-muted-foreground">+{rows.length - 12}…</div>}
      </div>;
    })()}

    {!loadError && <div className="grid grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_310px] gap-3 items-start"><div className="min-w-0">
      {view === 'planner' ? <ReservationCalendar rooms={rooms} reservations={filtered} basePath={basePath} showUnassigned editable={nativeHotel} onChanged={fetchAll} pmsName={nativeHotel ? null : 'Previo'} onQuickAction={(row, action) => setActioned({ row, dialog: action })} onRoomStatusChange={changeRoomStatus} onRoomPeriodManage={(room) => setPeriodRoom(room)} /> : <Card><CardContent className="p-0"><div className="overflow-auto max-h-[720px]"><table className="w-full text-sm">
        <thead className="sticky top-0 bg-card z-10 border-b border-border"><tr className="text-left text-xs text-muted-foreground">
          <th className="px-3 py-2 font-medium">{t('pms.reservations.guest')}</th><th className="px-3 py-2 font-medium">{t('pms.res.room')}</th><th className="px-3 py-2 font-medium">{t('pms.reservations.checkInDate')}</th><th className="px-3 py-2 font-medium">{t('pms.reservations.status')}</th><th className="px-3 py-2 font-medium">{t('pms.reservations.source')}</th>
        </tr></thead><tbody className="divide-y divide-border">{filtered.map((row) => <tr key={row.id} onClick={() => openReservation(row)} className={isSnapshotOnly(row) ? 'bg-muted/15' : 'cursor-pointer hover:bg-accent/30'}>
          <td className="px-3 py-2 font-medium">{reservationGuestLabel(row)}</td><td className="px-3 py-2">{row.rooms?.room_number || row.room_label || t('pms.res.unassigned')}</td>
          <td className="px-3 py-2 whitespace-nowrap">{row.check_in_date} → {row.check_out_date}</td><td className="px-3 py-2"><Badge className={RESERVATION_STATUS_COLORS[row.status] || 'bg-muted'}>{String(row.status).replace('_', ' ')}</Badge></td>
          <td className="px-3 py-2 capitalize" title={isSnapshotOnly(row) ? `Read-only snapshot captured ${new Date(row.captured_at).toLocaleString()}; not an independently verified booking` : undefined}>{isSnapshotOnly(row) ? 'Previo snapshot · read-only' : reservationChannel(row).label}</td>
        </tr>)}</tbody></table></div></CardContent></Card>}
    </div>
      <aside className="border border-border rounded-lg overflow-hidden bg-card 2xl:sticky 2xl:top-3">
        <SideSection signals={guestSignals} title={unassignedUrgent ? `${floatingTitle} · ${unassignedUrgent} ${t('pms.cal.floatingUrgent')}` : floatingTitle} icon={unassignedUrgent ? AlertTriangle : Waves} items={unassigned} onOpen={openReservation} />
        <SideSection signals={guestSignals} title={t('pms.fd.arrivalsRemaining')} icon={LogIn} items={arrivals} onOpen={openReservation}
          actionAnchor="fd-checkin-button" actionLabel={t('pms.checkIn')} onAction={(row) => setActioned({ row, dialog: 'checkin' })} />
        <SideSection signals={guestSignals} title={t('pms.fd.departuresRemaining')} icon={LogOut} items={departures} onOpen={openReservation}
          actionAnchor="fd-checkout-button" actionLabel={t('pms.checkOut')} onAction={(row) => setActioned({ row, dialog: 'checkout' })} />
        <SideSection signals={guestSignals} title={t('pms.fd.inHouseNow')} icon={Users} items={inHouse} onOpen={openReservation} />
        {newOnline.length > 0 && <SideSection signals={guestSignals} title={t('pms.fd.newOnline')} icon={Sparkles} items={newOnline} onOpen={openReservation} />}
        {expiringOptions.length > 0 && <SideSection signals={guestSignals} title={t('pms.fd.expiringOptions')} icon={Hourglass} items={expiringOptions} onOpen={openReservation} />}
        {waitingList.length > 0 && <SideSection signals={guestSignals} title={t('pms.fd.waitingList')} icon={ListOrdered} items={waitingList} onOpen={openReservation} />}
        {isOttofiori && <SideSection signals={guestSignals} title={`Tomorrow check-ins · ${tomorrow}${importStale ? ' · unverified' : ''}`} icon={LogIn} items={importStale ? [] : tomorrowCheckIns} onOpen={openReservation} />}
        <SideSection signals={guestSignals} title={t('pms.unified.futureReservations')} icon={CalendarDays} items={isOttofiori && importStale ? [] : upcomingOnline} onOpen={openReservation} />
      </aside>
    </div>}
    <Dialog open={!!periodRoom} onOpenChange={(isOpen) => { if (!isOpen) setPeriodRoom(null); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader><DialogTitle>{t('ntak.phase4.title')}</DialogTitle></DialogHeader>
        {periodRoom && <RoomStatePeriodManager hotelId={hotelId} roomId={periodRoom.id}
          roomNumber={periodRoom.room_number} active onChanged={() => void fetchAll()} />}
      </DialogContent>
    </Dialog>
    {hotelId && organizationSlug && !isPortfolio && <WalkInSaleDialog key={hotelId} open={walkInOpen} onOpenChange={setWalkInOpen} hotelId={hotelId} organizationSlug={organizationSlug} />}
    <CreateReservationDialog open={createOpen} onOpenChange={setCreateOpen} onSuccess={() => { setCreateOpen(false); void fetchAll(); }} />
    {actioned?.dialog === 'checkin' && (
      <CheckInDialog reservation={actioned.row} open onOpenChange={(next) => { if (!next) setActioned(null); }}
        onSuccess={() => { setActioned(null); void fetchAll(); }} />
    )}
    {actioned?.dialog === 'checkout' && (
      <CheckOutDialog reservation={actioned.row} open onOpenChange={(next) => { if (!next) setActioned(null); }}
        onSuccess={() => { setActioned(null); void fetchAll(); }} />
    )}
  </div>;
}
