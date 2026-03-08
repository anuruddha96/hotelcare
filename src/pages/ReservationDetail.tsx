import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Navigate, useParams, Link } from 'react-router-dom';
import { Header } from '@/components/layout/Header';
import { PMSNavigation } from '@/components/layout/PMSNavigation';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ArrowLeft, User, CalendarDays, BedDouble, CreditCard, FileText, Edit } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from '@/hooks/useTranslation';

const ReservationDetail = () => {
  const { user, loading } = useAuth();
  const { organizationSlug, id } = useParams<{ organizationSlug: string; id: string }>();
  const { t } = useTranslation();
  const [reservation, setReservation] = useState<any>(null);
  const [folioItems, setFolioItems] = useState<any[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const basePath = `/${organizationSlug || 'rdhotels'}`;

  useEffect(() => {
    if (user && id) fetchData();
  }, [user, id]);

  const fetchData = async () => {
    setLoadingData(true);
    const [resResult, folioResult] = await Promise.all([
      supabase.from('reservations').select('*, guests(*)').eq('id', id!).single(),
      supabase.from('guest_folios').select('*').eq('reservation_id', id!).order('charge_date', { ascending: false }),
    ]);
    if (resResult.data) setReservation(resResult.data);
    if (folioResult.data) setFolioItems(folioResult.data);
    setLoadingData(false);
  };

  const updateStatus = async (newStatus: string) => {
    const updates: any = { status: newStatus };
    if (newStatus === 'checked_in') updates.actual_check_in = new Date().toISOString();
    if (newStatus === 'checked_out') updates.actual_check_out = new Date().toISOString();
    if (newStatus === 'cancelled') updates.cancelled_at = new Date().toISOString();

    const { error } = await supabase.from('reservations').update(updates).eq('id', id!);
    if (error) {
      toast.error(t('pms.reservationDetail.failedToUpdate'));
    } else {
      toast.success(`${t('pms.reservationDetail.statusUpdated')} ${newStatus.replace('_', ' ')}`);
      fetchData();
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }
  if (!user) return <Navigate to={`${basePath}/auth`} replace />;

  const statusColors: Record<string, string> = {
    pending: 'bg-muted text-muted-foreground',
    confirmed: 'bg-primary/10 text-primary',
    checked_in: 'bg-green-500/10 text-green-700',
    checked_out: 'bg-secondary text-secondary-foreground',
    cancelled: 'bg-destructive/10 text-destructive',
    no_show: 'bg-destructive/10 text-destructive',
  };

  if (loadingData) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <PMSNavigation />
        <main className="container mx-auto px-3 sm:px-6 py-8">
          <div className="animate-pulse space-y-4">
            <div className="h-8 w-48 bg-muted rounded" />
            <div className="h-64 bg-muted rounded-lg" />
          </div>
        </main>
      </div>
    );
  }

  if (!reservation) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <PMSNavigation />
        <main className="container mx-auto px-3 sm:px-6 py-8 text-center text-muted-foreground">
          {t('pms.reservationDetail.reservationNotFound')}
          <br />
          <Link to={`${basePath}/reservations`} className="text-primary hover:underline mt-2 inline-block">
            {t('pms.reservationDetail.backToReservations')}
          </Link>
        </main>
      </div>
    );
  }

  const guest = reservation.guests;

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <PMSNavigation />
      <main className="container mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-4">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2">
          <Link to={`${basePath}/reservations`}>
            <Button variant="ghost" size="sm" className="gap-1">
              <ArrowLeft className="h-4 w-4" /> {t('pms.reservations')}
            </Button>
          </Link>
          <span className="text-muted-foreground">/</span>
          <span className="font-mono text-sm">{reservation.reservation_number}</span>
        </div>

        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              {reservation.reservation_number}
              <Badge className={statusColors[reservation.status] || 'bg-muted'}>
                {reservation.status.replace('_', ' ')}
              </Badge>
            </h1>
            <p className="text-sm text-muted-foreground">
              {t('pms.reservationDetail.created')} {new Date(reservation.created_at).toLocaleDateString()} · {t('pms.reservations.source')}: {reservation.source?.replace('_', ' ')}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {reservation.status === 'pending' && (
              <Button size="sm" onClick={() => updateStatus('confirmed')}>{t('pms.reservationDetail.confirm')}</Button>
            )}
            {['confirmed', 'pending'].includes(reservation.status) && (
              <Button size="sm" variant="default" onClick={() => updateStatus('checked_in')}>{t('pms.checkIn')}</Button>
            )}
            {reservation.status === 'checked_in' && (
              <Button size="sm" variant="outline" onClick={() => updateStatus('checked_out')}>{t('pms.checkOut')}</Button>
            )}
            {!['cancelled', 'checked_out', 'no_show'].includes(reservation.status) && (
              <Button size="sm" variant="destructive" onClick={() => updateStatus('cancelled')}>{t('pms.reservationDetail.cancel')}</Button>
            )}
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-4">
          {/* Guest Info */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <User className="h-4 w-4" /> {t('pms.reservationDetail.guestInfo')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {guest ? (
                <>
                  <div><span className="text-muted-foreground">{t('pms.reservationDetail.name')}:</span> <strong>{guest.first_name} {guest.last_name}</strong></div>
                  {guest.email && <div><span className="text-muted-foreground">{t('pms.guests.email')}:</span> {guest.email}</div>}
                  {guest.phone && <div><span className="text-muted-foreground">{t('pms.guests.phone')}:</span> {guest.phone}</div>}
                  {guest.nationality && <div><span className="text-muted-foreground">{t('pms.guests.nationality')}:</span> {guest.nationality}</div>}
                  {guest.id_document_number && <div><span className="text-muted-foreground">ID:</span> {guest.id_document_type} - {guest.id_document_number}</div>}
                  {guest.company_name && <div><span className="text-muted-foreground">{t('pms.guests.company')}:</span> {guest.company_name}</div>}
                </>
              ) : (
                <p className="text-muted-foreground">{t('pms.reservationDetail.noGuestLinked')}</p>
              )}
            </CardContent>
          </Card>

          {/* Stay Details */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <CalendarDays className="h-4 w-4" /> {t('pms.reservationDetail.stayDetails')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div><span className="text-muted-foreground">{t('pms.reservations.checkInDate')}:</span> <strong>{reservation.check_in_date}</strong></div>
              <div><span className="text-muted-foreground">{t('pms.reservations.checkOutDate')}:</span> <strong>{reservation.check_out_date}</strong></div>
              <div><span className="text-muted-foreground">{t('pms.reservations.nights')}:</span> {reservation.total_nights || '-'}</div>
              <div><span className="text-muted-foreground">{t('pms.reservations.guest')}:</span> {reservation.adults} {t('pms.reservationDetail.adults')}, {reservation.children} {t('pms.reservationDetail.children')}</div>
              <div><span className="text-muted-foreground">{t('pms.reservationDetail.roomType')}:</span> {reservation.room_type_requested || t('pms.reservationDetail.notSpecified')}</div>
              {reservation.actual_check_in && (
                <div><span className="text-muted-foreground">{t('pms.reservationDetail.actualCheckIn')}:</span> {new Date(reservation.actual_check_in).toLocaleString()}</div>
              )}
              {reservation.actual_check_out && (
                <div><span className="text-muted-foreground">{t('pms.reservationDetail.actualCheckOut')}:</span> {new Date(reservation.actual_check_out).toLocaleString()}</div>
              )}
            </CardContent>
          </Card>

          {/* Financial */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <CreditCard className="h-4 w-4" /> {t('pms.reservationDetail.financialSummary')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div><span className="text-muted-foreground">{t('pms.reservationDetail.ratePerNight')}:</span> {Number(reservation.rate_per_night).toLocaleString()} {reservation.currency}</div>
              <div><span className="text-muted-foreground">{t('pms.reservationDetail.total')}:</span> <strong>{Number(reservation.total_amount).toLocaleString()} {reservation.currency}</strong></div>
              <div><span className="text-muted-foreground">{t('pms.reservationDetail.payment')}:</span> <Badge variant="outline" className="capitalize">{reservation.payment_status}</Badge></div>
              <div><span className="text-muted-foreground">{t('pms.reservationDetail.balance')}:</span> {Number(reservation.balance_due).toLocaleString()} {reservation.currency}</div>
            </CardContent>
          </Card>
        </div>

        {/* Notes */}
        {(reservation.special_requests || reservation.internal_notes) && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <FileText className="h-4 w-4" /> {t('pms.reservationDetail.notesRequests')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {reservation.special_requests && (
                <div>
                  <span className="text-muted-foreground font-medium">{t('pms.reservationDetail.specialRequests')}:</span>
                  <p className="mt-1">{reservation.special_requests}</p>
                </div>
              )}
              {reservation.internal_notes && (
                <div>
                  <span className="text-muted-foreground font-medium">{t('pms.reservationDetail.internalNotes')}:</span>
                  <p className="mt-1">{reservation.internal_notes}</p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Folio */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">{t('pms.reservationDetail.guestFolio')}</CardTitle>
          </CardHeader>
          <CardContent>
            {folioItems.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">{t('pms.reservationDetail.noCharges')}</p>
            ) : (
              <div className="space-y-1">
                {folioItems.map((item) => (
                  <div key={item.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                    <div>
                      <span className="text-sm font-medium">{item.description}</span>
                      <span className="text-xs text-muted-foreground ml-2 capitalize">{item.charge_type}</span>
                    </div>
                    <span className="text-sm font-medium">{Number(item.amount).toLocaleString()} {reservation.currency}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default ReservationDetail;
