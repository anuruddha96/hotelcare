import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, Link, useParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { usePMSHotelContext } from '@/hooks/usePMSHotelContext';
import { Header } from '@/components/layout/Header';
import { PMSNavigation } from '@/components/layout/PMSNavigation';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CalendarDays, List, Plus, RefreshCw, Search } from 'lucide-react';
import { CreateReservationDialog } from '@/components/reservations/CreateReservationDialog';
import { ReservationCalendar } from '@/components/reservations/ReservationCalendar';
import { toast } from 'sonner';
import { getLocalDateString } from '@/lib/utils';

const statusColors: Record<string, string> = { pending: 'bg-muted text-muted-foreground', confirmed: 'bg-primary/10 text-primary', checked_in: 'bg-green-500/10 text-green-700', checked_out: 'bg-secondary text-secondary-foreground', cancelled: 'bg-destructive/10 text-destructive', no_show: 'bg-destructive/10 text-destructive' };
function guestLabel(r: any) { const n = `${r.guests?.first_name || ''} ${r.guests?.last_name || ''}`.trim(); return n || (r.source === 'previo' ? `Previo · ${r.source_reservation_id || r.reservation_number}` : r.reservation_number); }
type QuickFilter = 'all' | 'today' | 'arrivals' | 'departures' | 'in_house' | 'future' | 'cancelled' | 'no_show';

const Reservations = () => {
  const { user, loading } = useAuth();
  const { organizationSlug } = useParams<{ organizationSlug: string }>();
  const { t } = useTranslation();
  const { hotels, selectedHotelId, selectedHotel, setSelectedHotelId, canSelectProperty } = usePMSHotelContext();
  const [reservations, setReservations] = useState<any[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [view, setView] = useState<'list' | 'calendar'>('list');
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<any>(null);
  const today = getLocalDateString();

  const fetchReservations = useCallback(async () => {
    if (!selectedHotelId) return;
    setLoadingData(true);
    const [res, sync] = await Promise.all([
      (supabase as any).from('reservations').select('*, guests(*), rooms:room_id(id, room_number, room_type, status)').eq('hotel_id', selectedHotelId).order('check_in_date', { ascending: false }).limit(2000),
      (supabase as any).from('pms_configurations').select('last_sync_at,last_sync_status,last_sync_error,is_active').eq('hotel_id', selectedHotelId).eq('pms_type', 'previo').maybeSingle(),
    ]);
    if (res.error) toast.error(res.error.message);
    setReservations(res.data || []); setLastSync(sync.data || null); setLoadingData(false);
  }, [selectedHotelId]);
  useEffect(() => { fetchReservations(); }, [fetchReservations]);

  const syncFromPms = async () => {
    if (!selectedHotelId) return; setSyncing(true);
    const { data, error } = await supabase.functions.invoke('previo-sync-reservations', { body: { hotelId: selectedHotelId, pastDays: 7, futureDays: 365 } });
    setSyncing(false);
    if (error || data?.ok === false) { toast.error(data?.error || error?.message || 'PMS sync failed'); return; }
    toast.success(`PMS: ${data?.inserted || 0} + ${data?.updated || 0}`); fetchReservations();
  };

  const filtered = useMemo(() => reservations.filter((r) => {
    const term = searchTerm.trim().toLowerCase();
    if (term && ![guestLabel(r), r.reservation_number, r.source_reservation_id, r.rooms?.room_number].some((v) => String(v || '').toLowerCase().includes(term))) return false;
    if (statusFilter !== 'all' && r.status !== statusFilter) return false;
    if (sourceFilter !== 'all' && r.source !== sourceFilter) return false;
    if (quickFilter === 'today' && !(r.check_in_date <= today && r.check_out_date >= today)) return false;
    if (quickFilter === 'arrivals' && r.check_in_date !== today) return false;
    if (quickFilter === 'departures' && r.check_out_date !== today) return false;
    if (quickFilter === 'in_house' && r.status !== 'checked_in') return false;
    if (quickFilter === 'future' && !(r.check_in_date > today && !['cancelled','no_show'].includes(r.status))) return false;
    if (quickFilter === 'cancelled' && r.status !== 'cancelled') return false;
    if (quickFilter === 'no_show' && r.status !== 'no_show') return false;
    return true;
  }), [reservations, searchTerm, statusFilter, sourceFilter, quickFilter, today]);
  const sources = Array.from(new Set(reservations.map((r) => r.source).filter(Boolean)));

  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;
  if (!user) return <Navigate to={`/${organizationSlug || 'rdhotels'}/auth`} replace />;
  const basePath = `/${organizationSlug || 'rdhotels'}`;

  return <div className="min-h-screen bg-background"><Header /><PMSNavigation /><main className="container mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-4">
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <div><h1 className="text-xl font-bold">{t('pms.reservations.title')}</h1><p className="text-xs text-muted-foreground">{selectedHotel?.hotel_name || selectedHotelId || ''}{lastSync?.last_sync_at ? ` · PMS ${new Date(lastSync.last_sync_at).toLocaleString()}` : ''}</p></div>
      <div className="flex flex-wrap gap-2">
        {canSelectProperty && hotels.length > 1 && <Select value={selectedHotelId || ''} onValueChange={setSelectedHotelId}><SelectTrigger className="w-[210px]"><SelectValue /></SelectTrigger><SelectContent>{hotels.map((h) => <SelectItem key={h.hotel_id} value={h.hotel_id}>{h.hotel_name}</SelectItem>)}</SelectContent></Select>}
        <Button data-training="pms-sync" variant="outline" onClick={syncFromPms} disabled={syncing || !selectedHotelId || lastSync?.is_active === false}><RefreshCw className={`h-4 w-4 mr-1 ${syncing ? 'animate-spin' : ''}`} />PMS</Button>
        <Button data-training="pms-new-reservation" onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4 mr-1" />{t('pms.reservations.newReservation')}</Button>
      </div>
    </div>

    <div className="flex gap-1 overflow-x-auto pb-1">{(['all','today','arrivals','departures','in_house','future','cancelled','no_show'] as QuickFilter[]).map((f) => <Button key={f} size="sm" variant={quickFilter === f ? 'default' : 'outline'} onClick={() => setQuickFilter(f)} className="shrink-0 capitalize">{f === 'all' ? t('pms.reservations.allStatus') : f === 'arrivals' ? t('pms.arrivals') : f === 'departures' ? t('pms.departures') : f === 'in_house' ? t('pms.inHouse') : f === 'cancelled' ? t('pms.reservations.cancelled') : f === 'no_show' ? t('pms.reservations.noShow') : f}</Button>)}</div>

    <div className="flex flex-wrap gap-2 items-center">
      <div className="relative flex-1 min-w-[220px]" data-training="pms-reservation-search"><Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" /><Input placeholder={t('pms.reservations.search')} value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-8" /></div>
      <Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger className="w-36"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">{t('pms.reservations.allStatus')}</SelectItem>{['pending','confirmed','checked_in','checked_out','cancelled','no_show'].map((s) => <SelectItem key={s} value={s}>{s.replace('_',' ')}</SelectItem>)}</SelectContent></Select>
      <Select value={sourceFilter} onValueChange={setSourceFilter}><SelectTrigger className="w-36"><SelectValue placeholder={t('pms.reservations.source')} /></SelectTrigger><SelectContent><SelectItem value="all">{t('pms.reservations.source')}</SelectItem>{sources.map((s) => <SelectItem key={s} value={s}>{String(s).replace('_',' ')}</SelectItem>)}</SelectContent></Select>
      <div className="flex rounded-md border overflow-hidden"><Button variant={view === 'list' ? 'default' : 'ghost'} size="icon" className="rounded-none" onClick={() => setView('list')}><List className="h-4 w-4" /></Button><Button variant={view === 'calendar' ? 'default' : 'ghost'} size="icon" className="rounded-none" onClick={() => setView('calendar')}><CalendarDays className="h-4 w-4" /></Button></div>
    </div>

    {view === 'calendar' && selectedHotelId ? <ReservationCalendar reservations={reservations} hotelId={selectedHotelId} days={14} /> : <Card><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>{t('pms.reservations.reservationNumber')}</TableHead><TableHead>{t('pms.reservations.guest')}</TableHead><TableHead>{t('common.room')}</TableHead><TableHead>{t('pms.reservations.checkInDate')}</TableHead><TableHead>{t('pms.reservations.checkOutDate')}</TableHead><TableHead>{t('pms.reservations.status')}</TableHead><TableHead>{t('pms.reservations.source')}</TableHead><TableHead>{t('pms.reservations.amount')}</TableHead></TableRow></TableHeader><TableBody>{loadingData ? <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">{t('pms.reservations.loadingReservations')}</TableCell></TableRow> : filtered.length === 0 ? <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">{t('pms.reservations.noReservationsFound')}</TableCell></TableRow> : filtered.map((r) => <TableRow key={r.id} className="hover:bg-accent/40"><TableCell><Link data-training="pms-reservation-detail" to={`${basePath}/reservations/${r.id}`} className="font-mono text-primary hover:underline">{r.reservation_number}</Link></TableCell><TableCell className="font-medium">{guestLabel(r)}</TableCell><TableCell>{r.rooms?.room_number || '—'}</TableCell><TableCell>{r.check_in_date}</TableCell><TableCell>{r.check_out_date}<span className="ml-1 text-xs text-muted-foreground">({r.total_nights || '-'}N)</span></TableCell><TableCell><Badge className={statusColors[r.status] || 'bg-muted'}>{String(r.status).replace('_',' ')}</Badge></TableCell><TableCell className="capitalize">{String(r.source || '').replace('_',' ')}</TableCell><TableCell><div className="font-medium">{Number(r.total_amount || 0).toLocaleString()} {r.currency || 'HUF'}</div>{Number(r.balance_due || 0) > 0 && <div className="text-xs text-amber-700">{t('pms.reservationDetail.balance')}: {Number(r.balance_due).toLocaleString()}</div>}</TableCell></TableRow>)}</TableBody></Table></div></CardContent></Card>}
  </main>{selectedHotelId && <CreateReservationDialog open={createOpen} onOpenChange={setCreateOpen} onSuccess={fetchReservations} hotelId={selectedHotelId} />}</div>;
};
export default Reservations;
