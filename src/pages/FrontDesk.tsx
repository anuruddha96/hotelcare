import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Navigate, useParams } from 'react-router-dom';
import { Header } from '@/components/layout/Header';
import { PMSNavigation } from '@/components/layout/PMSNavigation';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getLocalDateString } from '@/lib/utils';
import {
  DoorOpen,
  LogIn,
  LogOut,
  Users,
  BedDouble,
  Search,
  Clock,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { CheckInDialog } from '@/components/frontdesk/CheckInDialog';
import { CheckOutDialog } from '@/components/frontdesk/CheckOutDialog';

const FrontDesk = () => {
  const { user, profile, loading } = useAuth();
  const { organizationSlug } = useParams<{ organizationSlug: string }>();
  const [reservations, setReservations] = useState<any[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [checkInReservation, setCheckInReservation] = useState<any>(null);
  const [checkOutReservation, setCheckOutReservation] = useState<any>(null);
  const today = getLocalDateString();

  useEffect(() => {
    if (user) fetchReservations();
  }, [user]);

  const fetchReservations = async () => {
    setLoadingData(true);
    const { data, error } = await supabase
      .from('reservations')
      .select('*, guests(*)')
      .or(`check_in_date.eq.${today},check_out_date.eq.${today},and(status.eq.checked_in)`)
      .order('check_in_date', { ascending: true });

    if (!error && data) setReservations(data);
    setLoadingData(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }
  if (!user) return <Navigate to={`/${organizationSlug || 'rdhotels'}/auth`} replace />;

  const arrivals = reservations.filter(
    (r) => r.check_in_date === today && ['confirmed', 'pending'].includes(r.status)
  );
  const departures = reservations.filter(
    (r) => r.check_out_date === today && r.status === 'checked_in'
  );
  const inHouse = reservations.filter((r) => r.status === 'checked_in');

  const filtered = (list: any[]) =>
    list.filter((r) => {
      if (!searchTerm) return true;
      const term = searchTerm.toLowerCase();
      const guestName = `${r.guests?.first_name || ''} ${r.guests?.last_name || ''}`.toLowerCase();
      return (
        guestName.includes(term) ||
        r.reservation_number?.toLowerCase().includes(term) ||
        r.room_id?.toLowerCase().includes(term)
      );
    });

  const StatusBadge = ({ status }: { status: string }) => {
    const colors: Record<string, string> = {
      pending: 'bg-muted text-muted-foreground',
      confirmed: 'bg-primary/10 text-primary',
      checked_in: 'bg-green-500/10 text-green-700',
      checked_out: 'bg-secondary text-secondary-foreground',
      cancelled: 'bg-destructive/10 text-destructive',
      no_show: 'bg-destructive/10 text-destructive',
    };
    return (
      <Badge className={colors[status] || 'bg-muted text-muted-foreground'}>
        {status.replace('_', ' ')}
      </Badge>
    );
  };

  const ReservationRow = ({ reservation, showAction }: { reservation: any; showAction: 'checkin' | 'checkout' | 'none' }) => (
    <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-card hover:bg-accent/30 transition-colors gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-sm">
            {reservation.guests?.first_name} {reservation.guests?.last_name}
          </span>
          <StatusBadge status={reservation.status} />
          {reservation.vip_status === 'vip' && (
            <Badge className="bg-amber-500/10 text-amber-700 text-xs">VIP</Badge>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
          <span className="font-mono">{reservation.reservation_number}</span>
          <span>{reservation.total_nights || '-'}N</span>
          <span>{reservation.adults}A {reservation.children > 0 ? `${reservation.children}C` : ''}</span>
          {reservation.room_type_requested && <span>{reservation.room_type_requested}</span>}
          {reservation.special_requests && (
            <span className="text-amber-600 flex items-center gap-0.5">
              <AlertCircle className="h-3 w-3" />
              Notes
            </span>
          )}
        </div>
      </div>
      {showAction === 'checkin' && (
        <Button size="sm" onClick={() => setCheckInReservation(reservation)} className="shrink-0 gap-1">
          <LogIn className="h-3.5 w-3.5" /> Check In
        </Button>
      )}
      {showAction === 'checkout' && (
        <Button size="sm" variant="outline" onClick={() => setCheckOutReservation(reservation)} className="shrink-0 gap-1">
          <LogOut className="h-3.5 w-3.5" /> Check Out
        </Button>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <PMSNavigation />
      <main className="container mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Arrivals', count: arrivals.length, icon: LogIn, color: 'text-primary' },
            { label: 'Departures', count: departures.length, icon: LogOut, color: 'text-amber-600' },
            { label: 'In-House', count: inHouse.length, icon: Users, color: 'text-green-600' },
            { label: 'Available', count: '-', icon: BedDouble, color: 'text-muted-foreground' },
          ].map((stat) => (
            <Card key={stat.label} className="relative overflow-hidden">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">{stat.label}</p>
                    <p className={`text-2xl font-bold ${stat.color}`}>{stat.count}</p>
                  </div>
                  <stat.icon className={`h-8 w-8 ${stat.color} opacity-20`} />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by guest name, reservation number..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* Boards */}
        <div className="grid lg:grid-cols-3 gap-4">
          {/* Arrivals */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <LogIn className="h-4 w-4 text-primary" />
                Today's Arrivals
                <Badge variant="secondary" className="ml-auto">{arrivals.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 max-h-[60vh] overflow-y-auto">
              {loadingData ? (
                <div className="text-center py-8 text-muted-foreground text-sm">Loading...</div>
              ) : filtered(arrivals).length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm">No arrivals today</div>
              ) : (
                filtered(arrivals).map((r) => (
                  <ReservationRow key={r.id} reservation={r} showAction="checkin" />
                ))
              )}
            </CardContent>
          </Card>

          {/* Departures */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <LogOut className="h-4 w-4 text-amber-600" />
                Today's Departures
                <Badge variant="secondary" className="ml-auto">{departures.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 max-h-[60vh] overflow-y-auto">
              {loadingData ? (
                <div className="text-center py-8 text-muted-foreground text-sm">Loading...</div>
              ) : filtered(departures).length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm">No departures today</div>
              ) : (
                filtered(departures).map((r) => (
                  <ReservationRow key={r.id} reservation={r} showAction="checkout" />
                ))
              )}
            </CardContent>
          </Card>

          {/* In-House */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="h-4 w-4 text-green-600" />
                In-House Guests
                <Badge variant="secondary" className="ml-auto">{inHouse.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 max-h-[60vh] overflow-y-auto">
              {loadingData ? (
                <div className="text-center py-8 text-muted-foreground text-sm">Loading...</div>
              ) : filtered(inHouse).length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm">No guests in-house</div>
              ) : (
                filtered(inHouse).map((r) => (
                  <ReservationRow key={r.id} reservation={r} showAction="none" />
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </main>

      {checkInReservation && (
        <CheckInDialog
          reservation={checkInReservation}
          open={!!checkInReservation}
          onOpenChange={(open) => !open && setCheckInReservation(null)}
          onSuccess={() => { setCheckInReservation(null); fetchReservations(); }}
        />
      )}
      {checkOutReservation && (
        <CheckOutDialog
          reservation={checkOutReservation}
          open={!!checkOutReservation}
          onOpenChange={(open) => !open && setCheckOutReservation(null)}
          onSuccess={() => { setCheckOutReservation(null); fetchReservations(); }}
        />
      )}
    </div>
  );
};

export default FrontDesk;
