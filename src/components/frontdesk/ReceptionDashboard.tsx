import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  DoorOpen, LogIn, LogOut, Users, BedDouble, Search, AlertCircle,
  Plus, RefreshCw, Clock, Coffee, CalendarDays, Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import { getLocalDateString } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';
import { useOperationalHotel } from '@/hooks/useOperationalHotel';
import { CheckInDialog } from '@/components/frontdesk/CheckInDialog';
import { CheckOutDialog } from '@/components/frontdesk/CheckOutDialog';
import { PmsSyncButton } from '@/components/frontdesk/PmsSyncButton';
import { CreateReservationDialog } from '@/components/reservations/CreateReservationDialog';
import { setReservationStatus, LifecycleError } from '@/lib/pmsLifecycle';
import {
  balanceOf, formatMoney, isLateArrivalCandidate, reservationGuestLabel,
  reservationSearchText, RESERVATION_STATUS_COLORS, roomReadiness,
} from '@/lib/reservations';

const RES_SELECT = '*, guests(first_name, last_name, email, phone, vip_status), rooms:room_id(id, room_number, room_type, status)';

interface ReceptionDashboardProps {
  /** When set, show a secondary link to the breakfast Daily Overview uploader. */
  breakfastUploadPath?: string;
}

export function ReceptionDashboard({ breakfastUploadPath }: ReceptionDashboardProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { organizationSlug } = useParams<{ organizationSlug: string }>();
  const basePath = `/${organizationSlug || 'rdhotels'}`;
  const { hotelId, hotelKeys, isPortfolio, orgSlug, canSync, ready } = useOperationalHotel();

  const [operational, setOperational] = useState<any[]>([]);
  const [upcoming, setUpcoming] = useState<any[]>([]);
  const [rooms, setRooms] = useState<any[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [checkInRes, setCheckInRes] = useState<any>(null);
  const [checkOutRes, setCheckOutRes] = useState<any>(null);
  const [noShowRes, setNoShowRes] = useState<any>(null);
  const [noShowReason, setNoShowReason] = useState('');
  const [noShowBusy, setNoShowBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const today = getLocalDateString();
  const keysKey = hotelKeys.join('|');

  const fetchAll = useCallback(async () => {
    if (!ready) return;
    if (!hotelId && !isPortfolio) { setLoadingData(false); return; }
    setLoadingData(true);
    const in14 = new Date();
    in14.setDate(in14.getDate() + 14);
    const upTo = in14.toISOString().slice(0, 10);

    let opQ = supabase
      .from('reservations')
      .select(RES_SELECT)
      .in('status', ['pending', 'confirmed', 'checked_in'])
      .lte('check_in_date', today)
      .gte('check_out_date', today)
      .order('check_in_date', { ascending: true })
      .limit(500);
    let upQ = supabase
      .from('reservations')
      .select(RES_SELECT)
      .in('status', ['pending', 'confirmed'])
      .gt('check_in_date', today)
      .lte('check_in_date', upTo)
      .order('check_in_date', { ascending: true })
      .limit(300);
    let roomQ = supabase
      .from('rooms')
      .select('id, room_number, room_type, status')
      .limit(1000);
    if (hotelKeys.length > 0) {
      opQ = opQ.in('hotel_id', hotelKeys);
      upQ = upQ.in('hotel_id', hotelKeys);
      roomQ = roomQ.in('hotel', hotelKeys);
    }
    const [op, up, rm] = await Promise.all([opQ, upQ, roomQ]);
    if (!op.error && op.data) setOperational(op.data);
    if (!up.error && up.data) setUpcoming(up.data);
    if (!rm.error && rm.data) setRooms(rm.data);
    setLoadingData(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, hotelId, isPortfolio, keysKey, today]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const arrivals = useMemo(
    () => operational.filter((r) => r.check_in_date === today && ['pending', 'confirmed'].includes(r.status)),
    [operational, today],
  );
  const departures = useMemo(
    () => operational.filter((r) => r.status === 'checked_in' && r.check_out_date === today),
    [operational, today],
  );
  const inHouse = useMemo(() => operational.filter((r) => r.status === 'checked_in'), [operational]);
  const lateArrivals = useMemo(
    () => operational.filter((r) => isLateArrivalCandidate(r, today)),
    [operational, today],
  );
  const cleanRooms = useMemo(() => rooms.filter((r) => r.status === 'clean').length, [rooms]);
  const dirtyRooms = useMemo(() => rooms.filter((r) => r.status === 'dirty').length, [rooms]);

  const searchResults = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (term.length < 2) return [];
    const all = [...operational, ...upcoming];
    const seen = new Set<string>();
    return all
      .filter((r) => {
        if (seen.has(r.id)) return false;
        seen.add(r.id);
        return reservationSearchText(r).includes(term);
      })
      .slice(0, 20);
  }, [searchTerm, operational, upcoming]);

  const markNoShow = async () => {
    if (!noShowRes) return;
    setNoShowBusy(true);
    try {
      await setReservationStatus(noShowRes.id, 'no_show', noShowReason || undefined);
      toast.success(t('pms.res.noShowOk'));
      setNoShowRes(null);
      setNoShowReason('');
      fetchAll();
    } catch (err) {
      const key = err instanceof LifecycleError ? err.translationKey : null;
      toast.error(key ? t(key) : (err as Error).message);
    } finally {
      setNoShowBusy(false);
    }
  };

  const StatusBadge = ({ status }: { status: string }) => (
    <Badge className={RESERVATION_STATUS_COLORS[status] || 'bg-muted text-muted-foreground'}>
      {t(`pms.reservations.${status === 'no_show' ? 'noShow' : status === 'checked_in' ? 'checkedIn' : status === 'checked_out' ? 'checkedOut' : status}`)}
    </Badge>
  );

  const ReadinessChip = ({ r }: { r: any }) => {
    const readiness = roomReadiness(r.rooms);
    const label = r.rooms?.room_number
      ? `${t('pms.res.room')} ${r.rooms.room_number}`
      : t('pms.res.unassigned');
    const cls = readiness === 'clean'
      ? 'bg-green-500/10 text-green-700 dark:text-green-400'
      : readiness === 'dirty'
        ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
        : readiness === 'occupied'
          ? 'bg-destructive/10 text-destructive'
          : 'bg-muted text-muted-foreground';
    return <Badge variant="outline" className={`text-[10px] ${cls}`}>{label}</Badge>;
  };

  const Row = ({ r, action }: { r: any; action: 'checkin' | 'checkout' | 'open' | 'noshow' }) => {
    const balance = balanceOf(r);
    return (
      <div
        className="flex items-center justify-between p-3 rounded-lg border border-border bg-card hover:bg-accent/30 transition-colors gap-3 cursor-pointer"
        onClick={() => navigate(`${basePath}/reservations/${r.id}`)}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm truncate">{reservationGuestLabel(r)}</span>
            {r.guests?.vip_status === 'vip' && (
              <Badge className="bg-amber-500/10 text-amber-700 text-[10px]">VIP</Badge>
            )}
            <ReadinessChip r={r} />
            {balance > 0 && (
              <Badge variant="outline" className="text-[10px] text-amber-700 dark:text-amber-400">
                {formatMoney(balance, r.currency)}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1 flex-wrap">
            <span className="font-mono">{r.reservation_number}</span>
            <span>{r.check_in_date} → {r.check_out_date}</span>
            <span>{r.adults}A{r.children > 0 ? ` ${r.children}C` : ''}</span>
            {r.special_requests && (
              <span className="text-amber-600 flex items-center gap-0.5">
                <AlertCircle className="h-3 w-3" /> {t('pms.notes')}
              </span>
            )}
          </div>
        </div>
        {action === 'checkin' && (
          <Button
            size="sm"
            onClick={(e) => { e.stopPropagation(); setCheckInRes(r); }}
            className="shrink-0 gap-1"
            data-training="fd-checkin-button"
          >
            <LogIn className="h-3.5 w-3.5" /> {t('pms.checkIn')}
          </Button>
        )}
        {action === 'checkout' && (
          <Button
            size="sm"
            variant="outline"
            onClick={(e) => { e.stopPropagation(); setCheckOutRes(r); }}
            className="shrink-0 gap-1"
            data-training="fd-checkout-button"
          >
            <LogOut className="h-3.5 w-3.5" /> {t('pms.checkOut')}
          </Button>
        )}
        {action === 'noshow' && (
          <Button
            size="sm"
            variant="destructive"
            onClick={(e) => { e.stopPropagation(); setNoShowRes(r); }}
            className="shrink-0"
          >
            {t('pms.fd.markNoShow')}
          </Button>
        )}
      </div>
    );
  };

  if (ready && !hotelId && !isPortfolio) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          {t('pms.fd.noPropertyAssigned')}
        </CardContent>
      </Card>
    );
  }
  if (ready && !hotelId && isPortfolio) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          {t('pms.fd.selectProperty')}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <DoorOpen className="h-5 w-5 text-primary" /> {t('pms.fd.title')}
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {hotelId} · {today}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {breakfastUploadPath && (
            <Link to={breakfastUploadPath}>
              <Button size="sm" variant="ghost" className="gap-1.5 text-muted-foreground">
                <Coffee className="h-3.5 w-3.5" /> {t('pms.fd.breakfastUpload')}
              </Button>
            </Link>
          )}
          <Button size="sm" variant="ghost" onClick={fetchAll} className="gap-1.5 text-muted-foreground">
            <RefreshCw className={`h-3.5 w-3.5 ${loadingData ? 'animate-spin' : ''}`} /> {t('pms.fd.refresh')}
          </Button>
          {canSync && hotelId && <PmsSyncButton hotelId={hotelId} onSynced={fetchAll} compact />}
          <Button
            size="sm"
            onClick={() => setCreateOpen(true)}
            className="gap-1"
            data-training="fd-new-reservation"
          >
            <Plus className="h-4 w-4" /> {t('pms.fd.newReservation')}
          </Button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: t('pms.fd.arrivalsRemaining'), count: arrivals.length, icon: LogIn, color: 'text-primary' },
          { label: t('pms.fd.departuresRemaining'), count: departures.length, icon: LogOut, color: 'text-amber-600' },
          { label: t('pms.fd.inHouseNow'), count: inHouse.length, icon: Users, color: 'text-green-600' },
          { label: t('pms.fd.cleanRoomsAvailable'), count: cleanRooms, icon: Sparkles, color: 'text-emerald-600' },
          { label: t('pms.fd.turnoverRooms'), count: dirtyRooms, icon: BedDouble, color: 'text-orange-600' },
        ].map((stat) => (
          <Card key={stat.label} className="relative overflow-hidden">
            <CardContent className="p-3.5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[11px] text-muted-foreground leading-tight">{stat.label}</p>
                  <p className={`text-2xl font-bold ${stat.color}`}>{loadingData ? '…' : stat.count}</p>
                </div>
                <stat.icon className={`h-7 w-7 ${stat.color} opacity-20`} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Global search */}
      <div className="relative" data-training="fd-search">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder={t('pms.fd.searchPlaceholder')}
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-10"
        />
        {searchTerm.trim().length >= 2 && (
          <div className="absolute z-40 top-full mt-1 w-full bg-popover border border-border rounded-md shadow-lg max-h-72 overflow-y-auto">
            {searchResults.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground text-center">{t('pms.fd.searchNoResults')}</p>
            ) : (
              searchResults.map((r) => (
                <button
                  key={r.id}
                  className="w-full text-left px-3 py-2 hover:bg-accent/50 transition-colors flex items-center justify-between gap-2"
                  onClick={() => navigate(`${basePath}/reservations/${r.id}`)}
                >
                  <div className="min-w-0">
                    <span className="text-sm font-medium">{reservationGuestLabel(r)}</span>
                    <span className="text-xs text-muted-foreground ml-2 font-mono">{r.reservation_number}</span>
                    <div className="text-xs text-muted-foreground">
                      {r.check_in_date} → {r.check_out_date}
                      {r.rooms?.room_number ? ` · ${t('pms.res.room')} ${r.rooms.room_number}` : ''}
                    </div>
                  </div>
                  <StatusBadge status={r.status} />
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* Late arrivals / no-show candidates */}
      {lateArrivals.length > 0 && (
        <Card className="border-amber-300/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4 w-4 text-amber-600" />
              {t('pms.fd.lateArrivals')}
              <Badge variant="secondary" className="ml-auto">{lateArrivals.length}</Badge>
            </CardTitle>
            <p className="text-xs text-muted-foreground">{t('pms.fd.lateArrivalsHint')}</p>
          </CardHeader>
          <CardContent className="space-y-2">
            {lateArrivals.map((r) => <Row key={r.id} r={r} action="noshow" />)}
          </CardContent>
        </Card>
      )}

      {/* Boards */}
      <div className="grid lg:grid-cols-3 gap-4">
        <Card data-training="fd-arrivals">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <LogIn className="h-4 w-4 text-primary" />
              {t('pms.todaysArrivals')}
              <Badge variant="secondary" className="ml-auto">{arrivals.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 max-h-[55vh] overflow-y-auto">
            {loadingData ? (
              <div className="text-center py-8 text-muted-foreground text-sm">{t('pms.loading')}</div>
            ) : arrivals.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">{t('pms.noArrivalsToday')}</div>
            ) : (
              arrivals.map((r) => <Row key={r.id} r={r} action="checkin" />)
            )}
          </CardContent>
        </Card>

        <Card data-training="fd-departures">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <LogOut className="h-4 w-4 text-amber-600" />
              {t('pms.todaysDepartures')}
              <Badge variant="secondary" className="ml-auto">{departures.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 max-h-[55vh] overflow-y-auto">
            {loadingData ? (
              <div className="text-center py-8 text-muted-foreground text-sm">{t('pms.loading')}</div>
            ) : departures.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">{t('pms.noDeparturesToday')}</div>
            ) : (
              departures.map((r) => <Row key={r.id} r={r} action="checkout" />)
            )}
          </CardContent>
        </Card>

        <Card data-training="fd-inhouse">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4 text-green-600" />
              {t('pms.inHouseGuests')}
              <Badge variant="secondary" className="ml-auto">{inHouse.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 max-h-[55vh] overflow-y-auto">
            {loadingData ? (
              <div className="text-center py-8 text-muted-foreground text-sm">{t('pms.loading')}</div>
            ) : inHouse.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">{t('pms.noGuestsInHouse')}</div>
            ) : (
              inHouse.map((r) => <Row key={r.id} r={r} action="open" />)
            )}
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-end">
        <Link to={`${basePath}/reservations`} className="text-xs text-primary hover:underline flex items-center gap-1">
          <CalendarDays className="h-3.5 w-3.5" /> {t('pms.fd.openReservations')}
        </Link>
      </div>

      {/* Dialogs */}
      {checkInRes && (
        <CheckInDialog
          reservation={checkInRes}
          open={!!checkInRes}
          onOpenChange={(open) => !open && setCheckInRes(null)}
          onSuccess={() => { setCheckInRes(null); fetchAll(); }}
        />
      )}
      {checkOutRes && (
        <CheckOutDialog
          reservation={checkOutRes}
          open={!!checkOutRes}
          onOpenChange={(open) => !open && setCheckOutRes(null)}
          onSuccess={() => { setCheckOutRes(null); fetchAll(); }}
        />
      )}
      <CreateReservationDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSuccess={() => { setCreateOpen(false); fetchAll(); }}
      />

      {/* No-show confirm */}
      <Dialog open={!!noShowRes} onOpenChange={(open) => !open && setNoShowRes(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('pms.res.noShowTitle')}</DialogTitle>
          </DialogHeader>
          {noShowRes && (
            <div className="space-y-3">
              <p className="text-sm">
                <strong>{reservationGuestLabel(noShowRes)}</strong> · {noShowRes.check_in_date} → {noShowRes.check_out_date}
              </p>
              <Textarea
                placeholder={t('pms.res.noShowReason')}
                value={noShowReason}
                onChange={(e) => setNoShowReason(e.target.value)}
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setNoShowRes(null)}>{t('pms.res.keepReservation')}</Button>
            <Button variant="destructive" onClick={markNoShow} disabled={noShowBusy}>
              {noShowBusy ? t('pms.checkIn.processing') : t('pms.fd.markNoShow')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
