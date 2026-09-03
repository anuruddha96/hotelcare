import { useCallback, useEffect, useMemo, useState } from 'react';
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
import {
  reservationGuestLabel, reservationSearchText, RESERVATION_STATUS_COLORS,
} from '@/lib/reservations';

const RES_SELECT = '*, guests(first_name, last_name, email, phone, vip_status), rooms:room_id(id, room_number, room_type, status)';

type ViewMode = 'planner' | 'list';

type SnapshotRow = {
  id: string;
  hotel_id: string;
  business_date: string;
  room_label: string | null;
  room_number: string | null;
  room_type_code: string | null;
  arrival_date: string | null;
  departure_date: string | null;
  status: string | null;
  guest_names: string | null;
  pax: number | null;
  source: string | null;
  captured_at: string;
};

const normalize = (value: unknown) => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const compact = (value: unknown) => normalize(value).replace(/[^a-z0-9]/g, '');

function snapshotStatus(status?: string | null): string {
  const s = normalize(status);
  if (s === 'ongoing' || s === 'departing' || s === 'in house' || s === 'inhouse') return 'checked_in';
  if (s === 'cancelled' || s === 'canceled') return 'cancelled';
  if (s === 'no show' || s === 'no_show') return 'no_show';
  return 'confirmed';
}

function reservationSignature(r: any): string {
  return [
    compact(r.rooms?.room_number ?? r.room_label ?? r.room_number),
    r.check_in_date,
    r.check_out_date,
  ].join('|');
}

function isSnapshotOnly(r: any): boolean {
  return r?.snapshotOnly === true;
}

function SideSection({
  title,
  icon: Icon,
  items,
  onOpen,
}: {
  title: string;
  icon: typeof Users;
  items: any[];
  onOpen: (r: any) => void;
}) {
  const { t } = useTranslation();
  return (
    <details open className="border-b border-border last:border-b-0 group">
      <summary className="list-none cursor-pointer select-none px-3 py-2 bg-muted/45 hover:bg-muted/70 flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 min-w-0 text-xs font-semibold uppercase tracking-wide">
          <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="truncate">{title}</span>
        </span>
        <Badge variant="secondary" className="h-5 min-w-5 justify-center px-1.5 text-[10px]">{items.length}</Badge>
      </summary>
      <div className="divide-y divide-border/70">
        {items.length === 0 ? (
          <div className="px-3 py-3 text-xs text-muted-foreground">—</div>
        ) : items.slice(0, 12).map((r) => (
          <button
            type="button"
            key={r.id}
            onClick={() => onOpen(r)}
            disabled={isSnapshotOnly(r)}
            className="w-full text-left px-3 py-2 hover:bg-accent/40 disabled:hover:bg-transparent transition-colors disabled:cursor-default"
            title={isSnapshotOnly(r) ? t('pms.unified.snapshotReadOnly') : undefined}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-xs font-semibold truncate">{reservationGuestLabel(r)}</div>
                <div className="text-[10px] text-muted-foreground truncate mt-0.5">
                  {r.rooms?.room_number || r.room_label || t('pms.unified.unassigned')} · {r.check_in_date?.slice(5)} → {r.check_out_date?.slice(5)}
                </div>
              </div>
              {isSnapshotOnly(r) ? (
                <Radio className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
              ) : (
                <span className="text-[10px] text-primary shrink-0 font-medium">{String(r.source || '').replace('_', ' ')}</span>
              )}
            </div>
          </button>
        ))}
      </div>
    </details>
  );
}

export function UnifiedReceptionWorkspace({ breakfastUploadPath }: { breakfastUploadPath?: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { organizationSlug } = useParams<{ organizationSlug: string }>();
  const basePath = `/${organizationSlug || 'rdhotels'}`;
  const { hotelId, hotelKeys, isPortfolio, canSync, ready } = useOperationalHotel();

  const [reservations, setReservations] = useState<any[]>([]);
  const [snapshots, setSnapshots] = useState<SnapshotRow[]>([]);
  const [rooms, setRooms] = useState<any[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [search, setSearch] = useState('');
  const [view, setView] = useState<ViewMode>('planner');
  const [createOpen, setCreateOpen] = useState(false);

  const today = getLocalDateString();
  const keysKey = hotelKeys.join('|');

  const fetchAll = useCallback(async () => {
    if (!ready) return;
    if (!hotelId && !isPortfolio) { setLoadingData(false); return; }
    if (!hotelId && isPortfolio) { setLoadingData(false); return; }

    setLoadingData(true);
    const from = new Date();
    from.setDate(from.getDate() - 45);
    const to = new Date();
    to.setDate(to.getDate() + 210);

    let resQ = supabase
      .from('reservations')
      .select(RES_SELECT)
      .gte('check_out_date', from.toISOString().slice(0, 10))
      .lte('check_in_date', to.toISOString().slice(0, 10))
      .order('check_in_date', { ascending: true })
      .limit(2000);
    let roomQ = supabase
      .from('rooms')
      .select('id, room_number, room_type, status, hotel')
      .limit(1500);
    let snapQ = supabase
      .from('daily_overview_snapshots')
      .select('id, hotel_id, business_date, room_label, room_number, room_type_code, arrival_date, departure_date, status, guest_names, pax, source, captured_at')
      .order('captured_at', { ascending: false })
      .limit(5000);

    if (hotelKeys.length > 0) {
      resQ = resQ.in('hotel_id', hotelKeys);
      roomQ = roomQ.in('hotel', hotelKeys);
      snapQ = snapQ.in('hotel_id', hotelKeys);
    }

    const [res, rm, snap] = await Promise.all([resQ, roomQ, snapQ]);
    if (!res.error) setReservations(res.data ?? []);
    if (!rm.error) setRooms(rm.data ?? []);
    if (!snap.error) setSnapshots((snap.data ?? []) as SnapshotRow[]);
    setLoadingData(false);
  }, [ready, hotelId, isPortfolio, keysKey]);

  useEffect(() => { void fetchAll(); }, [fetchAll]);

  const roomIndexes = useMemo(() => {
    const exact = new Map<string, any>();
    const numeric = new Map<string, any>();
    for (const room of rooms) {
      exact.set(compact(room.room_number), room);
      const nums = String(room.room_number ?? '').match(/\d+/g);
      if (nums?.length) numeric.set(nums[nums.length - 1], room);
    }
    return { exact, numeric };
  }, [rooms]);

  const snapshotReservations = useMemo(() => {
    if (!snapshots.length) return [];
    const newest = snapshots[0]?.captured_at;
    const currentBatch = snapshots.filter((s) => s.captured_at === newest && s.arrival_date && s.departure_date);
    const deduped = new Map<string, SnapshotRow>();
    for (const s of currentBatch) {
      const key = [compact(s.room_label || s.room_number), s.arrival_date, s.departure_date, normalize(s.guest_names)].join('|');
      if (!deduped.has(key)) deduped.set(key, s);
    }

    return [...deduped.values()].map((s) => {
      const roomKey = compact(s.room_label || s.room_number);
      const nums = String(s.room_number || s.room_label || '').match(/\d+/g);
      const room = roomIndexes.exact.get(roomKey) || (nums?.length ? roomIndexes.numeric.get(nums[nums.length - 1]) : null) || null;
      return {
        id: `snapshot:${s.id}`,
        snapshotOnly: true,
        reservation_number: 'PREVIO',
        hotel_id: s.hotel_id,
        status: snapshotStatus(s.status),
        check_in_date: s.arrival_date,
        check_out_date: s.departure_date,
        source: 'previo',
        pms_guest_name: s.guest_names,
        adults: s.pax ?? 0,
        children: 0,
        total_nights: s.arrival_date && s.departure_date
          ? Math.max(0, Math.round((Date.parse(`${s.departure_date}T00:00:00Z`) - Date.parse(`${s.arrival_date}T00:00:00Z`)) / 86400000))
          : 0,
        room_id: room?.id ?? null,
        room_label: s.room_label,
        rooms: room ? { id: room.id, room_number: room.room_number, room_type: room.room_type, status: room.status } : null,
      };
    });
  }, [snapshots, roomIndexes]);

  const mergedReservations = useMemo(() => {
    const normalizedByStay = new Set(reservations.map(reservationSignature));
    const fallbackOnly = snapshotReservations.filter((r) => !normalizedByStay.has(reservationSignature(r)));
    return [...reservations, ...fallbackOnly];
  }, [reservations, snapshotReservations]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return mergedReservations;
    return mergedReservations.filter((r) => reservationSearchText(r).includes(term));
  }, [mergedReservations, search]);

  const arrivals = useMemo(
    () => mergedReservations.filter((r) => r.check_in_date === today && ['pending', 'confirmed'].includes(r.status)),
    [mergedReservations, today],
  );
  const departures = useMemo(
    () => mergedReservations.filter((r) => r.check_out_date === today && r.status === 'checked_in'),
    [mergedReservations, today],
  );
  const inHouse = useMemo(
    () => mergedReservations.filter((r) => r.status === 'checked_in' && r.check_in_date <= today && r.check_out_date >= today),
    [mergedReservations, today],
  );
  const unassigned = useMemo(
    () => mergedReservations.filter((r) => !r.room_id && ['pending', 'confirmed', 'checked_in'].includes(r.status)),
    [mergedReservations],
  );
  const upcomingOnline = useMemo(
    () => mergedReservations
      .filter((r) => r.check_in_date > today && ['pending', 'confirmed'].includes(r.status) && !['walk_in', 'direct', 'phone', 'email'].includes(String(r.source || '')))
      .sort((a, b) => String(a.check_in_date).localeCompare(String(b.check_in_date)))
      .slice(0, 20),
    [mergedReservations, today],
  );

  const openReservation = (r: any) => {
    if (isSnapshotOnly(r)) return;
    navigate(`${basePath}/reservations/${r.id}`);
  };

  if (ready && !hotelId && !isPortfolio) {
    return <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">{t('pms.fd.noPropertyAssigned')}</CardContent></Card>;
  }
  if (ready && !hotelId && isPortfolio) {
    return <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">{t('pms.fd.selectProperty')}</CardContent></Card>;
  }

  return (
    <div className="space-y-3" data-training="reception-workspace">
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold">{t('pms.fd.title')}</h1>
            {snapshotReservations.length > 0 && (
              <Badge variant="outline" className="text-[10px] gap-1 text-muted-foreground">
                <Radio className="h-3 w-3" /> {t('pms.unified.liveSnapshotFallback')}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{hotelId} · {today}</p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative min-w-[210px] flex-1 xl:flex-none">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('pms.fd.searchPlaceholder')}
              className="h-9 pl-8 xl:w-64"
            />
          </div>
          <div className="flex border border-border rounded-md overflow-hidden">
            <Button type="button" size="sm" variant={view === 'planner' ? 'default' : 'ghost'} className="rounded-none h-9 gap-1" onClick={() => setView('planner')}>
              <CalendarDays className="h-4 w-4" /> <span className="hidden sm:inline">{t('pms.planner.title')}</span>
            </Button>
            <Button type="button" size="sm" variant={view === 'list' ? 'default' : 'ghost'} className="rounded-none h-9 gap-1" onClick={() => setView('list')}>
              <List className="h-4 w-4" /> <span className="hidden sm:inline">{t('pms.reservations.title')}</span>
            </Button>
          </div>
          {breakfastUploadPath && (
            <Link to={breakfastUploadPath}>
              <Button type="button" size="sm" variant="outline" className="h-9 gap-1.5">
                <Coffee className="h-4 w-4" /> <span className="hidden lg:inline">{t('pms.fd.breakfastUpload')}</span>
              </Button>
            </Link>
          )}
          <Button type="button" size="icon" variant="outline" className="h-9 w-9" onClick={() => void fetchAll()} aria-label={t('pms.fd.refresh')}>
            <RefreshCw className={`h-4 w-4 ${loadingData ? 'animate-spin' : ''}`} />
          </Button>
          {canSync && hotelId && <PmsSyncButton hotelId={hotelId} onSynced={fetchAll} compact />}
          <Button type="button" size="sm" className="h-9 gap-1" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> {t('pms.fd.newReservation')}
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide pb-1">
        {[
          { label: t('pms.fd.arrivalsRemaining'), value: arrivals.length, icon: LogIn },
          { label: t('pms.fd.departuresRemaining'), value: departures.length, icon: LogOut },
          { label: t('pms.fd.inHouseNow'), value: inHouse.length, icon: Users },
          { label: t('pms.planner.unassignedSection'), value: unassigned.length, icon: AlertTriangle },
          { label: t('pms.reservations.title'), value: mergedReservations.length, icon: BedDouble },
        ].map((stat) => (
          <div key={stat.label} className="h-8 shrink-0 rounded-md border border-border bg-card px-2.5 flex items-center gap-1.5 text-xs">
            <stat.icon className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">{stat.label}</span>
            <span className="font-semibold">{loadingData ? '…' : stat.value}</span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_310px] gap-3 items-start">
        <div className="min-w-0">
          {view === 'planner' ? (
            <ReservationCalendar rooms={rooms} reservations={filtered} basePath={basePath} showUnassigned={false} />
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="overflow-auto max-h-[720px]">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-card z-10 border-b border-border">
                      <tr className="text-left text-xs text-muted-foreground">
                        <th className="px-3 py-2 font-medium">{t('pms.reservations.guest')}</th>
                        <th className="px-3 py-2 font-medium">{t('pms.res.room')}</th>
                        <th className="px-3 py-2 font-medium">{t('pms.reservations.checkInDate')}</th>
                        <th className="px-3 py-2 font-medium">{t('pms.reservations.status')}</th>
                        <th className="px-3 py-2 font-medium">{t('pms.reservations.source')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {filtered.map((r) => (
                        <tr
                          key={r.id}
                          onClick={() => openReservation(r)}
                          className={isSnapshotOnly(r) ? 'bg-muted/15' : 'cursor-pointer hover:bg-accent/30'}
                        >
                          <td className="px-3 py-2 font-medium">{reservationGuestLabel(r)}</td>
                          <td className="px-3 py-2">{r.rooms?.room_number || r.room_label || t('pms.res.unassigned')}</td>
                          <td className="px-3 py-2 whitespace-nowrap">{r.check_in_date} → {r.check_out_date}</td>
                          <td className="px-3 py-2"><Badge className={RESERVATION_STATUS_COLORS[r.status] || 'bg-muted'}>{String(r.status).replace('_', ' ')}</Badge></td>
                          <td className="px-3 py-2 capitalize">{isSnapshotOnly(r) ? t('pms.unified.previoLive') : String(r.source || '').replace('_', ' ')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <aside className="border border-border rounded-lg overflow-hidden bg-card 2xl:sticky 2xl:top-3">
          <SideSection title={t('pms.planner.unassignedSection')} icon={AlertTriangle} items={unassigned} onOpen={openReservation} />
          <SideSection title={t('pms.fd.arrivalsRemaining')} icon={LogIn} items={arrivals} onOpen={openReservation} />
          <SideSection title={t('pms.fd.departuresRemaining')} icon={LogOut} items={departures} onOpen={openReservation} />
          <SideSection title={t('pms.fd.inHouseNow')} icon={Users} items={inHouse} onOpen={openReservation} />
          <SideSection title={t('pms.unified.futureReservations')} icon={CalendarDays} items={upcomingOnline} onOpen={openReservation} />
        </aside>
      </div>

      <CreateReservationDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSuccess={() => { setCreateOpen(false); void fetchAll(); }}
      />
    </div>
  );
}
