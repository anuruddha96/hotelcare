import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { Header } from '@/components/layout/Header';
import { PMSNavigation } from '@/components/layout/PMSNavigation';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { CalendarDays, List, Plus, Search, RefreshCw } from 'lucide-react';
import { CreateReservationDialog } from '@/components/reservations/CreateReservationDialog';
import { ReservationCalendar } from '@/components/reservations/ReservationCalendar';
import { PmsSyncButton } from '@/components/frontdesk/PmsSyncButton';
import { useTranslation } from '@/hooks/useTranslation';
import { useOperationalHotel } from '@/hooks/useOperationalHotel';
import { getLocalDateString } from '@/lib/utils';
import {
  balanceOf, formatMoney, matchesQuickFilter, reservationGuestLabel,
  reservationSearchText, RESERVATION_SOURCES, RESERVATION_STATUS_COLORS,
  type QuickFilter,
} from '@/lib/reservations';

const RES_SELECT = '*, guests(first_name, last_name, email, phone, vip_status), rooms:room_id(id, room_number, room_type, status)';

const QUICK_FILTERS: QuickFilter[] = ['all', 'today', 'arrivals', 'departures', 'inhouse', 'future', 'cancelled', 'no_show'];

const Reservations = () => {
  const { user, loading } = useAuth();
  const { organizationSlug } = useParams<{ organizationSlug: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { hotelId, hotelKeys, isPortfolio, canSync, ready } = useOperationalHotel();
  const [reservations, setReservations] = useState<any[]>([]);
  const [rooms, setRooms] = useState<any[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('all');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [view, setView] = useState<'list' | 'planner'>('list');

  const today = getLocalDateString();
  const basePath = `/${organizationSlug || 'rdhotels'}`;
  const keysKey = hotelKeys.join('|');

  const fetchAll = useCallback(async () => {
    if (!ready) return;
    if (!hotelId && !isPortfolio) { setLoadingData(false); return; }
    setLoadingData(true);
    const past = new Date();
    past.setDate(past.getDate() - 30);
    let resQ = supabase
      .from('reservations')
      .select(RES_SELECT)
      .gte('check_out_date', past.toISOString().slice(0, 10))
      .order('check_in_date', { ascending: true })
      .limit(1000);
    let roomQ = supabase
      .from('rooms')
      .select('id, room_number, room_type, status')
      .limit(1000);
    if (hotelKeys.length > 0) {
      resQ = resQ.in('hotel_id', hotelKeys);
      roomQ = roomQ.in('hotel', hotelKeys);
    }
    const [res, rm] = await Promise.all([resQ, roomQ]);
    if (!res.error && res.data) setReservations(res.data);
    if (!rm.error && rm.data) setRooms(rm.data);
    setLoadingData(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, hotelId, isPortfolio, keysKey]);

  useEffect(() => {
    if (user) fetchAll();
  }, [user, fetchAll]);

  const filtered = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return reservations.filter((r) => {
      if (!matchesQuickFilter(r, quickFilter, today)) return false;
      if (sourceFilter !== 'all' && (r.source ?? '') !== sourceFilter) return false;
      if (term && !reservationSearchText(r).includes(term)) return false;
      return true;
    });
  }, [reservations, quickFilter, sourceFilter, searchTerm, today]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }
  if (!user) return <Navigate to={`${basePath}/auth`} replace />;

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <PMSNavigation />
      <main className="container mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-4">
        {/* Toolbar */}
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-3">
          <h1 className="text-xl font-bold">{t('pms.reservations.title')}</h1>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t('pms.reservations.search')}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-8 w-48 h-9"
                data-training="res-search"
              />
            </div>
            <Select value={sourceFilter} onValueChange={setSourceFilter}>
              <SelectTrigger className="w-32 h-9">
                <SelectValue placeholder={t('pms.reservations.source')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('pms.res.sourceAll')}</SelectItem>
                <SelectItem value="previo">Previo</SelectItem>
                {RESERVATION_SOURCES.map((s) => (
                  <SelectItem key={s} value={s} className="capitalize">{s.replace('_', ' ')}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex border border-border rounded-md overflow-hidden">
              <Button variant={view === 'list' ? 'default' : 'ghost'} size="sm" onClick={() => setView('list')} className="rounded-none">
                <List className="h-4 w-4" />
              </Button>
              <Button variant={view === 'planner' ? 'default' : 'ghost'} size="sm" onClick={() => setView('planner')} className="rounded-none">
                <CalendarDays className="h-4 w-4" />
              </Button>
            </div>
            <Button size="sm" variant="ghost" onClick={fetchAll} className="text-muted-foreground">
              <RefreshCw className={`h-4 w-4 ${loadingData ? 'animate-spin' : ''}`} />
            </Button>
            {canSync && hotelId && <PmsSyncButton hotelId={hotelId} onSynced={fetchAll} compact />}
            <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-1" data-training="res-new">
              <Plus className="h-4 w-4" /> {t('pms.reservations.newReservation')}
            </Button>
          </div>
        </div>

        {/* Quick filters */}
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide pb-1">
          {QUICK_FILTERS.map((f) => (
            <Button
              key={f}
              size="sm"
              variant={quickFilter === f ? 'default' : 'outline'}
              className="h-7 text-xs shrink-0"
              onClick={() => setQuickFilter(f)}
            >
              {t(`pms.res.quick_${f}`)}
            </Button>
          ))}
        </div>

        {ready && !hotelId && isPortfolio && (
          <p className="text-xs text-muted-foreground">{t('pms.fd.selectProperty')}</p>
        )}

        {view === 'list' ? (
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('pms.reservations.reservationNumber')}</TableHead>
                      <TableHead>{t('pms.reservations.guest')}</TableHead>
                      <TableHead>{t('pms.res.room')}</TableHead>
                      <TableHead>{t('pms.reservations.checkInDate')}</TableHead>
                      <TableHead>{t('pms.reservations.nights')}</TableHead>
                      <TableHead>{t('pms.res.pax')}</TableHead>
                      <TableHead>{t('pms.reservations.status')}</TableHead>
                      <TableHead>{t('pms.reservations.source')}</TableHead>
                      <TableHead className="text-right">{t('pms.reservations.amount')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadingData ? (
                      <TableRow>
                        <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                          {t('pms.reservations.loadingReservations')}
                        </TableCell>
                      </TableRow>
                    ) : filtered.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                          {t('pms.reservations.noReservationsFound')}
                        </TableCell>
                      </TableRow>
                    ) : (
                      filtered.map((r) => {
                        const balance = balanceOf(r);
                        return (
                          <TableRow
                            key={r.id}
                            className="cursor-pointer hover:bg-accent/50"
                            onClick={() => navigate(`${basePath}/reservations/${r.id}`)}
                          >
                            <TableCell className="font-mono text-sm text-primary">{r.reservation_number}</TableCell>
                            <TableCell className="font-medium">{reservationGuestLabel(r)}</TableCell>
                            <TableCell className="text-sm">
                              {r.rooms?.room_number ?? <span className="text-muted-foreground">{t('pms.res.unassigned')}</span>}
                            </TableCell>
                            <TableCell className="text-sm whitespace-nowrap">
                              {r.check_in_date} → {r.check_out_date}
                            </TableCell>
                            <TableCell>{r.total_nights || '-'}</TableCell>
                            <TableCell className="text-sm">{r.adults}A{r.children > 0 ? ` ${r.children}C` : ''}</TableCell>
                            <TableCell>
                              <Badge className={RESERVATION_STATUS_COLORS[r.status] || 'bg-muted'}>
                                {r.status.replace('_', ' ')}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-sm capitalize">{r.source?.replace('_', ' ')}</TableCell>
                            <TableCell className="text-sm font-medium text-right whitespace-nowrap">
                              {r.total_amount ? formatMoney(r.total_amount, r.currency) : '-'}
                              {balance > 0 && (
                                <div className="text-[10px] text-amber-600">
                                  {t('pms.res.balance')}: {formatMoney(balance, r.currency)}
                                </div>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        ) : (
          <ReservationCalendar rooms={rooms} reservations={reservations} basePath={basePath} />
        )}
      </main>

      <CreateReservationDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSuccess={() => { setCreateOpen(false); fetchAll(); }}
      />
    </div>
  );
};

export default Reservations;
