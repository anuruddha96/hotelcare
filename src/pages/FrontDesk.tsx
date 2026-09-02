import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, Link, useParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { usePMSHotelContext } from '@/hooks/usePMSHotelContext';
import { Header } from '@/components/layout/Header';
import { PMSNavigation } from '@/components/layout/PMSNavigation';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getLocalDateString } from '@/lib/utils';
import {
  AlertCircle, BedDouble, FileSpreadsheet, LogIn, LogOut, Plus, RefreshCw, Search, Sparkles, Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { CheckInDialog } from '@/components/frontdesk/CheckInDialog';
import { CheckOutDialog } from '@/components/frontdesk/CheckOutDialog';
import { CreateReservationDialog } from '@/components/reservations/CreateReservationDialog';

const statusClass: Record<string, string> = {
  pending: 'bg-muted text-muted-foreground',
  confirmed: 'bg-primary/10 text-primary',
  checked_in: 'bg-green-500/10 text-green-700',
  checked_out: 'bg-secondary text-secondary-foreground',
  cancelled: 'bg-destructive/10 text-destructive',
  no_show: 'bg-destructive/10 text-destructive',
};

function guestLabel(reservation: any) {
  const name = `${reservation.guests?.first_name || ''} ${reservation.guests?.last_name || ''}`.trim();
  if (name) return name;
  return reservation.source === 'previo'
    ? `Previo · ${reservation.source_reservation_id || reservation.reservation_number}`
    : reservation.reservation_number;
}

const FrontDesk = () => {
  const { user, loading } = useAuth();
  const { organizationSlug } = useParams<{ organizationSlug: string }>();
  const { t } = useTranslation();
  const { hotels, selectedHotelId, selectedHotel, setSelectedHotelId, canSelectProperty, loadingHotels } = usePMSHotelContext();
  const [reservations, setReservations] = useState<any[]>([]);
  const [rooms, setRooms] = useState<any[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [checkInReservation, setCheckInReservation] = useState<any>(null);
  const [checkOutReservation, setCheckOutReservation] = useState<any>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncInfo, setSyncInfo] = useState<any>(null);
  const today = getLocalDateString();

  const fetchData = useCallback(async () => {
    if (!selectedHotelId) return;
    setLoadingData(true);
    const [resResult, roomsResult, syncResult] = await Promise.all([
      (supabase as any)
        .from('reservations')
        .select('*, guests(*), rooms:room_id(id, room_number, room_type, status, actual_status, is_checkout_room)')
        .eq('hotel_id', selectedHotelId)
        .in('status', ['pending', 'confirmed', 'checked_in', 'checked_out', 'no_show'])
        .order('check_in_date', { ascending: true })
        .limit(1500),
      (supabase as any)
        .from('rooms')
        .select('id, room_number, room_type, status, actual_status, is_checkout_room, guest_count')
        .in('hotel', [selectedHotelId, selectedHotel?.hotel_name || selectedHotelId])
        .order('room_number'),
      (supabase as any)
        .from('pms_configurations')
        .select('pms_type, is_active, sync_enabled, last_sync_at, last_sync_status, last_sync_error')
        .eq('hotel_id', selectedHotelId)
        .eq('pms_type', 'previo')
        .maybeSingle(),
    ]);
    if (resResult.error) toast.error(resResult.error.message);
    setReservations(resResult.data || []);
    setRooms(roomsResult.data || []);
    setSyncInfo(syncResult.data || null);
    setLoadingData(false);
  }, [selectedHotelId, selectedHotel?.hotel_name]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const syncFromPms = async () => {
    if (!selectedHotelId) return;
    setSyncing(true);
    const { data, error } = await supabase.functions.invoke('previo-sync-reservations', {
      body: { hotelId: selectedHotelId, pastDays: 7, futureDays: 365 },
    });
    setSyncing(false);
    if (error || data?.ok === false) {
      toast.error(data?.error || error?.message || 'PMS sync failed');
      return;
    }
    toast.success(`PMS: ${data?.inserted || 0} + ${data?.updated || 0}`);
    fetchData();
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;
  if (!user) return <Navigate to={`/${organizationSlug || 'rdhotels'}/auth`} replace />;

  const arrivals = reservations.filter((r) => r.check_in_date === today && ['confirmed', 'pending'].includes(r.status));
  const departures = reservations.filter((r) => r.check_out_date === today && r.status === 'checked_in');
  const inHouse = reservations.filter((r) => r.status === 'checked_in');
  const lateCandidates = reservations.filter((r) => r.check_in_date < today && ['pending', 'confirmed'].includes(r.status));
  const availableClean = rooms.filter((r) => String(r.status).toLowerCase() === 'clean' && !['occupied', 'in_progress'].includes(String(r.actual_status || '').toLowerCase())).length;
  const dirtyTurnover = rooms.filter((r) => r.is_checkout_room || ['untidy', 'dirty', 'ready to clean'].includes(String(r.status || '').toLowerCase())).length;

  const matches = (r: any) => {
    if (!searchTerm.trim()) return true;
    const term = searchTerm.trim().toLowerCase();
    return [guestLabel(r), r.reservation_number, r.source_reservation_id, r.rooms?.room_number]
      .some((value) => String(value || '').toLowerCase().includes(term));
  };

  const markNoShow = async (reservation: any) => {
    const reason = window.prompt(`${t('pms.reservations.noShow')} · ${reservation.reservation_number}`);
    if (!reason?.trim()) return;
    const { error } = await (supabase as any).rpc('pms_set_reservation_status', {
      p_reservation_id: reservation.id,
      p_new_status: 'no_show',
      p_reason: reason.trim(),
    });
    if (error) toast.error(error.message);
    else { toast.success(t('pms.reservations.noShow')); fetchData(); }
  };

  const ReservationRow = ({ reservation, action }: { reservation: any; action: 'checkin' | 'checkout' | 'none' | 'noshow' }) => (
    <div className="rounded-xl border bg-card p-3 hover:bg-accent/20 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <Link to={`/${organizationSlug}/reservations/${reservation.id}`} className="min-w-0 flex-1" data-training="reception-reservation-detail">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm truncate">{guestLabel(reservation)}</span>
            <Badge className={statusClass[reservation.status] || statusClass.pending}>{String(reservation.status).replace('_', ' ')}</Badge>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="font-mono">{reservation.reservation_number}</span>
            <span>{reservation.rooms?.room_number ? `${t('common.room')} ${reservation.rooms.room_number}` : t('pms.reservationDetail.notSpecified')}</span>
            <span>{reservation.total_nights || '-'}N</span>
            <span>{reservation.adults || 0}A{reservation.children > 0 ? ` ${reservation.children}C` : ''}</span>
            {Number(reservation.balance_due || 0) > 0 && <span className="text-amber-700 font-medium">{t('pms.reservationDetail.balance')}: {Number(reservation.balance_due).toLocaleString()} {reservation.currency || 'HUF'}</span>}
            {reservation.special_requests && <span className="text-amber-700 inline-flex items-center gap-1"><AlertCircle className="h-3 w-3" />{t('pms.notes')}</span>}
          </div>
        </Link>
        {action === 'checkin' && <Button data-training="reception-check-in" size="sm" onClick={() => setCheckInReservation(reservation)}><LogIn className="h-4 w-4 mr-1" />{t('pms.checkIn')}</Button>}
        {action === 'checkout' && <Button data-training="reception-checkout" size="sm" variant="outline" onClick={() => setCheckOutReservation(reservation)}><LogOut className="h-4 w-4 mr-1" />{t('pms.checkOut')}</Button>}
        {action === 'noshow' && <Button size="sm" variant="destructive" onClick={() => markNoShow(reservation)}>{t('pms.reservations.noShow')}</Button>}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <PMSNavigation />
      <main className="container mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><BedDouble className="h-6 w-6 text-primary" />{t('pms.frontDesk')}</h1>
            <p className="text-sm text-muted-foreground">{today} · {selectedHotel?.hotel_name || selectedHotelId || ''}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canSelectProperty && hotels.length > 1 && (
              <Select value={selectedHotelId || ''} onValueChange={setSelectedHotelId}>
                <SelectTrigger className="w-[210px]"><SelectValue /></SelectTrigger>
                <SelectContent>{hotels.map((hotel) => <SelectItem key={hotel.hotel_id} value={hotel.hotel_id}>{hotel.hotel_name}</SelectItem>)}</SelectContent>
              </Select>
            )}
            <Button data-training="reception-pms-sync" variant="outline" onClick={syncFromPms} disabled={syncing || !selectedHotelId || syncInfo?.is_active === false}>
              <RefreshCw className={`h-4 w-4 mr-1 ${syncing ? 'animate-spin' : ''}`} />PMS
            </Button>
            <Button data-training="reception-new-reservation" onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4 mr-1" />{t('pms.reservations.newReservation')}</Button>
            <Link to={`/${organizationSlug}/reception/breakfast-upload`}><Button variant="ghost" size="icon" title="Daily Overview"><FileSpreadsheet className="h-4 w-4" /></Button></Link>
          </div>
        </div>

        {syncInfo?.last_sync_at && <div className="text-xs text-muted-foreground">PMS · {syncInfo.last_sync_status || '-'} · {new Date(syncInfo.last_sync_at).toLocaleString()}</div>}

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
          {[
            { label: t('pms.arrivals'), count: arrivals.length, icon: LogIn },
            { label: t('pms.departures'), count: departures.length, icon: LogOut },
            { label: t('pms.inHouse'), count: inHouse.length, icon: Users },
            { label: t('pms.available'), count: availableClean, icon: BedDouble },
            { label: t('rooms.dirty'), count: dirtyTurnover, icon: Sparkles },
          ].map(({ label, count, icon: Icon }) => <Card key={label}><CardContent className="p-3 flex items-center justify-between"><div><p className="text-xs text-muted-foreground">{label}</p><p className="text-2xl font-bold">{count}</p></div><Icon className="h-7 w-7 text-primary/25" /></CardContent></Card>)}
        </div>

        <div className="relative" data-training="reception-search">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder={t('pms.searchGuestReservation')} value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-10" />
        </div>

        <div className="grid xl:grid-cols-3 gap-4">
          <Card data-training="reception-arrivals"><CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><LogIn className="h-4 w-4 text-primary" />{t('pms.todaysArrivals')}<Badge variant="secondary" className="ml-auto">{arrivals.length}</Badge></CardTitle></CardHeader><CardContent className="space-y-2 max-h-[58vh] overflow-auto">{loadingData || loadingHotels ? <p className="py-6 text-center text-sm text-muted-foreground">{t('pms.loading')}</p> : arrivals.filter(matches).length ? arrivals.filter(matches).map((r) => <ReservationRow key={r.id} reservation={r} action="checkin" />) : <p className="py-6 text-center text-sm text-muted-foreground">{t('pms.noArrivalsToday')}</p>}</CardContent></Card>
          <Card data-training="reception-departures"><CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><LogOut className="h-4 w-4 text-amber-600" />{t('pms.todaysDepartures')}<Badge variant="secondary" className="ml-auto">{departures.length}</Badge></CardTitle></CardHeader><CardContent className="space-y-2 max-h-[58vh] overflow-auto">{departures.filter(matches).length ? departures.filter(matches).map((r) => <ReservationRow key={r.id} reservation={r} action="checkout" />) : <p className="py-6 text-center text-sm text-muted-foreground">{t('pms.noDeparturesToday')}</p>}</CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Users className="h-4 w-4 text-green-600" />{t('pms.inHouseGuests')}<Badge variant="secondary" className="ml-auto">{inHouse.length}</Badge></CardTitle></CardHeader><CardContent className="space-y-2 max-h-[58vh] overflow-auto">{inHouse.filter(matches).length ? inHouse.filter(matches).map((r) => <ReservationRow key={r.id} reservation={r} action="none" />) : <p className="py-6 text-center text-sm text-muted-foreground">{t('pms.noGuestsInHouse')}</p>}</CardContent></Card>
        </div>

        {lateCandidates.length > 0 && <Card><CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><AlertCircle className="h-4 w-4 text-destructive" />{t('pms.reservations.noShow')}<Badge variant="secondary">{lateCandidates.length}</Badge></CardTitle></CardHeader><CardContent className="grid md:grid-cols-2 gap-2">{lateCandidates.filter(matches).map((r) => <ReservationRow key={r.id} reservation={r} action="noshow" />)}</CardContent></Card>}
      </main>

      {checkInReservation && <CheckInDialog reservation={checkInReservation} hotelId={selectedHotelId} open onOpenChange={(value) => !value && setCheckInReservation(null)} onSuccess={() => { setCheckInReservation(null); fetchData(); }} />}
      {checkOutReservation && <CheckOutDialog reservation={checkOutReservation} open onOpenChange={(value) => !value && setCheckOutReservation(null)} onSuccess={() => { setCheckOutReservation(null); fetchData(); }} />}
      {selectedHotelId && <CreateReservationDialog open={createOpen} onOpenChange={setCreateOpen} onSuccess={fetchData} hotelId={selectedHotelId} />}
    </div>
  );
};

export default FrontDesk;
