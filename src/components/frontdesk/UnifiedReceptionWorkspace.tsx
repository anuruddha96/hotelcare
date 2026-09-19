import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  CalendarDays, Coffee, List, LogIn, LogOut, Plus, RefreshCw, Search,
  Users, BedDouble, AlertTriangle, Radio,
} from 'lucide-react';
import { ReservationCalendar } from '@/components/reservations/ReservationCalendar';
import { CreateReservationDialog } from '@/components/reservations/CreateReservationDialog';
import { PmsSyncButton } from '@/components/frontdesk/PmsSyncButton';
import { useOperationalHotel } from '@/hooks/useOperationalHotel';
import { useTranslation } from '@/hooks/useTranslation';
import { getLocalDateString } from '@/lib/utils';
import { auditReceptionSnapshots, type ReceptionSnapshot } from '@/lib/receptionSnapshotAudit';
import { reservationGuestLabel, reservationSearchText, RESERVATION_STATUS_COLORS } from '@/lib/reservations';

const RES_SELECT = '*, guests(first_name, last_name, email, phone, vip_status), rooms:room_id(id, room_number, room_type, status)';
type ViewMode = 'planner' | 'list';

type SnapshotRow = ReceptionSnapshot & {
  room_type_code: string | null;
  pax: number | null;
  source: string | null;
};

type ImportHistory = { created_at: string; sync_status: string | null };

function snapshotStatus(value: string | null): string {
  const status = String(value ?? '').trim().toLowerCase();
  if (['ongoing', 'departing', 'in house', 'inhouse'].includes(status)) return 'checked_in';
  if (['cancelled', 'canceled'].includes(status)) return 'cancelled';
  if (['no show', 'no_show'].includes(status)) return 'no_show';
  // An unrecognised snapshot status does not establish a confirmed booking.
  return 'pending';
}

function isSnapshotOnly(row: any): boolean { return row?.snapshotOnly === true; }

function SideSection({ title, icon: Icon, items, onOpen }: {
  title: string;
  icon: typeof Users;
  items: any[];
  onOpen: (row: any) => void;
}) {
  const { t } = useTranslation();
  return <details open className="border-b border-border last:border-b-0 group">
    <summary className="list-none cursor-pointer select-none px-3 py-2 bg-muted/45 hover:bg-muted/70 flex items-center justify-between gap-2">
      <span className="flex items-center gap-2 min-w-0 text-xs font-semibold uppercase tracking-wide"><Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" /><span className="truncate">{title}</span></span>
      <Badge variant="secondary" className="h-5 min-w-5 justify-center px-1.5 text-[10px]">{items.length}</Badge>
    </summary>
    <div className="divide-y divide-border/70">
      {items.length === 0 ? <div className="px-3 py-3 text-xs text-muted-foreground">—</div> : items.slice(0, 12).map((row) =>
        <button type="button" key={row.id} onClick={() => onOpen(row)} disabled={isSnapshotOnly(row)}
          className="w-full text-left px-3 py-2 hover:bg-accent/40 disabled:hover:bg-transparent transition-colors disabled:cursor-default"
          title={isSnapshotOnly(row) ? t('pms.unified.snapshotReadOnly') : undefined}>
          <div className="flex items-start justify-between gap-2"><div className="min-w-0">
            <div className="text-xs font-semibold truncate">{reservationGuestLabel(row)}</div>
            <div className="text-[10px] text-muted-foreground truncate mt-0.5">{row.rooms?.room_number || row.room_label || t('pms.unified.unassigned')} · {row.check_in_date?.slice(5)} → {row.check_out_date?.slice(5)}</div>
          </div><span className="text-[10px] text-primary shrink-0 font-medium">{String(row.source || '').replace('_', ' ')}</span></div>
        </button>,
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
  const [importHistory, setImportHistory] = useState<ImportHistory | null>(null);
  const [loadingData, setLoadingData] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [search, setSearch] = useState('');
  const [view, setView] = useState<ViewMode>('planner');
  const [createOpen, setCreateOpen] = useState(false);
  const today = getLocalDateString();
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
      const [res, rm, snap, history] = await Promise.all([
        supabase.from('reservations').select(RES_SELECT).in('hotel_id', keys)
          .gte('check_out_date', from.toISOString().slice(0, 10)).lte('check_in_date', to.toISOString().slice(0, 10))
          .order('check_in_date', { ascending: true }).limit(2000),
        supabase.from('rooms').select('id, room_number, room_type, status, hotel').in('hotel', keys).limit(1500),
        supabase.from('daily_overview_snapshots')
          .select('id, hotel_id, business_date, room_label, room_number, room_type_code, arrival_date, departure_date, status, guest_names, pax, source, captured_at')
          .eq('hotel_id', hotelId).order('captured_at', { ascending: false }).limit(5000),
        supabase.from('pms_sync_history').select('created_at, sync_status').eq('hotel_id', hotelId)
          .eq('sync_type', 'reservations').order('created_at', { ascending: false }).limit(1),
      ]);
      if (seq !== requestId.current) return; // Ignore responses from a previously selected property.
      if (res.error || rm.error || snap.error || history.error) {
        setReservations([]); setRooms([]); setSnapshots([]); setImportHistory(null);
        setLoadError(true); // Never show previous-property data when a read fails.
        return;
      }
      setReservations(res.data ?? []);
      setRooms(rm.data ?? []);
      setSnapshots((snap.data ?? []) as SnapshotRow[]);
      setImportHistory(history.data?.[0] ?? null);
    } catch {
      if (seq !== requestId.current) return;
      setReservations([]); setRooms([]); setSnapshots([]); setImportHistory(null);
      setLoadError(true);
    } finally {
      if (seq === requestId.current) setLoadingData(false);
    }
  }, [ready, hotelId, isPortfolio, keysKey]);

  useEffect(() => { void fetchAll(); return () => { requestId.current += 1; }; }, [fetchAll]);

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
  const arrivals = useMemo(() => reservations.filter((row) => row.check_in_date === today && ['pending', 'confirmed'].includes(row.status)), [reservations, today]);
  const departures = useMemo(() => reservations.filter((row) => row.check_out_date === today && row.status === 'checked_in'), [reservations, today]);
  const inHouse = useMemo(() => reservations.filter((row) => row.status === 'checked_in' && row.check_in_date <= today && row.check_out_date > today), [reservations, today]);
  const unassigned = useMemo(() => reservations.filter((row) => !row.room_id && ['pending', 'confirmed', 'checked_in'].includes(row.status)), [reservations]);
  const upcomingOnline = useMemo(() => reservations
    .filter((row) => row.check_in_date > today && ['pending', 'confirmed'].includes(row.status) && !['walk_in', 'direct', 'phone', 'email'].includes(String(row.source || '')))
    .sort((a, b) => String(a.check_in_date).localeCompare(String(b.check_in_date))).slice(0, 20), [reservations, today]);
  const lastImportTime = importHistory?.created_at ? Date.parse(importHistory.created_at) : NaN;
  const importStale = !Number.isFinite(lastImportTime) || lastImportTime > Date.now() || Date.now() - lastImportTime > 24 * 60 * 60 * 1000 || importHistory?.sync_status !== 'success';

  const openReservation = (row: any) => { if (!isSnapshotOnly(row)) navigate(`${basePath}/reservations/${row.id}`); };
  if (ready && !hotelId && !isPortfolio) return <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">{t('pms.fd.noPropertyAssigned')}</CardContent></Card>;
  if (ready && !hotelId && isPortfolio) return <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">{t('pms.fd.selectProperty')}</CardContent></Card>;

  return <div className="space-y-3" data-training="reception-workspace">
    <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
      <div className="min-w-0"><div className="flex items-center gap-2 flex-wrap">
        <h1 className="text-xl font-bold">{t('pms.fd.title')}</h1>
        {snapshotAudit?.latestCapture && <Badge variant="outline" className="text-[10px] gap-1 text-muted-foreground"><Radio className="h-3 w-3" />Previo snapshot · {new Date(snapshotAudit.latestCapture).toLocaleString()} · read-only</Badge>}
      </div><p className="text-xs text-muted-foreground mt-0.5">{hotelId} · {today}</p></div>
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative min-w-[210px] flex-1 xl:flex-none"><Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('pms.fd.searchPlaceholder')} className="h-9 pl-8 xl:w-64" />
        </div>
        <div className="flex border border-border rounded-md overflow-hidden">
          <Button type="button" size="sm" variant={view === 'planner' ? 'default' : 'ghost'} className="rounded-none h-9 gap-1" onClick={() => setView('planner')}><CalendarDays className="h-4 w-4" /><span className="hidden sm:inline">{t('pms.planner.title')}</span></Button>
          <Button type="button" size="sm" variant={view === 'list' ? 'default' : 'ghost'} className="rounded-none h-9 gap-1" onClick={() => setView('list')}><List className="h-4 w-4" /><span className="hidden sm:inline">{t('pms.reservations.title')}</span></Button>
        </div>
        {breakfastUploadPath && <Link to={breakfastUploadPath}><Button type="button" size="sm" variant="outline" className="h-9 gap-1.5"><Coffee className="h-4 w-4" /><span className="hidden lg:inline">{t('pms.fd.breakfastUpload')}</span></Button></Link>}
        <Button type="button" size="icon" variant="outline" className="h-9 w-9" onClick={() => void fetchAll()} aria-label={t('pms.fd.refresh')} disabled={loadingData}><RefreshCw className={`h-4 w-4 ${loadingData ? 'animate-spin' : ''}`} /></Button>
        {canSync && hotelId && <PmsSyncButton hotelId={hotelId} onSynced={fetchAll} compact />}
        <Button type="button" size="sm" className="h-9 gap-1" onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" />{t('pms.fd.newReservation')}</Button>
      </div>
    </div>

    {loadError && <div role="alert" className="rounded-md border border-destructive/50 p-3 text-xs text-destructive flex items-center gap-2"><AlertTriangle className="h-4 w-4" />Reception data could not be verified. Previous property data has been cleared. Retry refresh.</div>}
    {!loadingData && !loadError && (importStale || snapshotReservations.length > 0 || (snapshotAudit?.ambiguousRooms ?? 0) > 0) &&
      <div role="status" className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-3 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0" /><span>
          <strong>Reception totals are HotelCare database records, not verified Previo totals.</strong>{' '}
          {importStale ? `Latest reservation import: ${importHistory?.created_at ? new Date(importHistory.created_at).toLocaleString() : 'not recorded'} (${importHistory?.sync_status ?? 'unknown'}). ` : ''}
          {snapshotReservations.length > 0 ? `${snapshotReservations.length} unmatched read-only snapshot observations appear on the planner but do not count as bookings. ` : ''}
          {snapshotAudit?.stale && snapshotAudit.latestCapture ? 'The last snapshot is stale and is not overlaid. ' : ''}
          {(snapshotAudit?.ambiguousRooms ?? 0) > 0 ? `${snapshotAudit?.ambiguousRooms} room labels could not be mapped uniquely. ` : ''}
          Verify arrivals, availability and reservation IDs in Previo before acting on a mismatch.
        </span>
      </div>}

    <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide pb-1" aria-label="HotelCare records only; not validated against Previo">
      {[
        { label: t('pms.fd.arrivalsRemaining'), value: arrivals.length, icon: LogIn },
        { label: t('pms.fd.departuresRemaining'), value: departures.length, icon: LogOut },
        { label: t('pms.fd.inHouseNow'), value: inHouse.length, icon: Users },
        { label: t('pms.planner.unassignedSection'), value: unassigned.length, icon: AlertTriangle },
        { label: `${t('pms.reservations.title')} (loaded)`, value: reservations.length, icon: BedDouble },
      ].map((stat) => <div key={stat.label} title="HotelCare database only; not independently confirmed by Previo" className="h-8 shrink-0 rounded-md border border-border bg-card px-2.5 flex items-center gap-1.5 text-xs">
        <stat.icon className="h-3.5 w-3.5 text-muted-foreground" /><span className="text-muted-foreground">{stat.label}</span><span className="font-semibold">{loadingData || loadError ? '—' : stat.value}</span>
      </div>)}
    </div>

    <div className="grid grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_310px] gap-3 items-start"><div className="min-w-0">
      {view === 'planner' ? <ReservationCalendar rooms={rooms} reservations={filtered} basePath={basePath} showUnassigned={false} /> : <Card><CardContent className="p-0"><div className="overflow-auto max-h-[720px]"><table className="w-full text-sm">
        <thead className="sticky top-0 bg-card z-10 border-b border-border"><tr className="text-left text-xs text-muted-foreground">
          <th className="px-3 py-2 font-medium">{t('pms.reservations.guest')}</th><th className="px-3 py-2 font-medium">{t('pms.res.room')}</th><th className="px-3 py-2 font-medium">{t('pms.reservations.checkInDate')}</th><th className="px-3 py-2 font-medium">{t('pms.reservations.status')}</th><th className="px-3 py-2 font-medium">{t('pms.reservations.source')}</th>
        </tr></thead><tbody className="divide-y divide-border">{filtered.map((row) => <tr key={row.id} onClick={() => openReservation(row)} className={isSnapshotOnly(row) ? 'bg-muted/15' : 'cursor-pointer hover:bg-accent/30'}>
          <td className="px-3 py-2 font-medium">{reservationGuestLabel(row)}</td><td className="px-3 py-2">{row.rooms?.room_number || row.room_label || t('pms.res.unassigned')}</td>
          <td className="px-3 py-2 whitespace-nowrap">{row.check_in_date} → {row.check_out_date}</td><td className="px-3 py-2"><Badge className={RESERVATION_STATUS_COLORS[row.status] || 'bg-muted'}>{String(row.status).replace('_', ' ')}</Badge></td>
          <td className="px-3 py-2 capitalize" title={isSnapshotOnly(row) ? `Read-only snapshot captured ${new Date(row.captured_at).toLocaleString()}; not an independently verified booking` : undefined}>{isSnapshotOnly(row) ? 'Previo snapshot · read-only' : String(row.source || '').replace('_', ' ')}</td>
        </tr>)}</tbody></table></div></CardContent></Card>}
    </div>
      <aside className="border border-border rounded-lg overflow-hidden bg-card 2xl:sticky 2xl:top-3">
        <SideSection title={t('pms.planner.unassignedSection')} icon={AlertTriangle} items={unassigned} onOpen={openReservation} />
        <SideSection title={t('pms.fd.arrivalsRemaining')} icon={LogIn} items={arrivals} onOpen={openReservation} />
        <SideSection title={t('pms.fd.departuresRemaining')} icon={LogOut} items={departures} onOpen={openReservation} />
        <SideSection title={t('pms.fd.inHouseNow')} icon={Users} items={inHouse} onOpen={openReservation} />
        <SideSection title={t('pms.unified.futureReservations')} icon={CalendarDays} items={upcomingOnline} onOpen={openReservation} />
      </aside>
    </div>
    <CreateReservationDialog open={createOpen} onOpenChange={setCreateOpen} onSuccess={() => { setCreateOpen(false); void fetchAll(); }} />
  </div>;
}
