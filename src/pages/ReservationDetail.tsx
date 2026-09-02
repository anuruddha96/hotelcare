import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useParams, Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Header } from '@/components/layout/Header';
import { PMSNavigation } from '@/components/layout/PMSNavigation';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  ArrowLeft, User, CalendarDays, BedDouble, CreditCard, FileText, Edit,
  History, Lock, Receipt, Plus, Banknote, AlertTriangle, Hash,
} from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from '@/hooks/useTranslation';
import { CheckInDialog } from '@/components/frontdesk/CheckInDialog';
import { CheckOutDialog } from '@/components/frontdesk/CheckOutDialog';
import { EditReservationDialog } from '@/components/reservations/EditReservationDialog';
import { FolioItemDialog } from '@/components/reservations/FolioItemDialog';
import { LifecycleError, setReservationStatus } from '@/lib/pmsLifecycle';
import {
  formatMoney, isPmsManaged, reservationGuestLabel, RESERVATION_STATUS_COLORS,
} from '@/lib/reservations';

const RES_SELECT = `
  *,
  guests(id, first_name, last_name, email, phone, nationality, vip_status, company_name, id_document_type, id_document_number),
  rooms:room_id(id, room_number, room_type, status, capacity)
`;

type StatusAction = 'cancelled' | 'no_show' | null;

const ReservationDetail = () => {
  const { user, loading } = useAuth();
  const { organizationSlug, id } = useParams<{ organizationSlug: string; id: string }>();
  const { t } = useTranslation();
  const [reservation, setReservation] = useState<any>(null);
  const [folioItems, setFolioItems] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [checkInOpen, setCheckInOpen] = useState(false);
  const [checkOutOpen, setCheckOutOpen] = useState(false);
  const [folioMode, setFolioMode] = useState<'charge' | 'payment' | null>(null);
  const [statusAction, setStatusAction] = useState<StatusAction>(null);
  const [statusReason, setStatusReason] = useState('');
  const [statusBusy, setStatusBusy] = useState(false);
  const basePath = `/${organizationSlug || 'rdhotels'}`;

  const fetchData = useCallback(async () => {
    if (!id) return;
    setLoadingData(true);
    const [resResult, folioResult, eventResult] = await Promise.all([
      supabase.from('reservations').select(RES_SELECT).eq('id', id).single(),
      supabase.from('guest_folios').select('*').eq('reservation_id', id).order('charge_date', { ascending: false }),
      supabase.from('reservation_events').select('*').eq('reservation_id', id).order('created_at', { ascending: false }).limit(100),
    ]);

    if (resResult.error) {
      setReservation(null);
    } else {
      setReservation(resResult.data);
    }
    setFolioItems(folioResult.data ?? []);
    setEvents(eventResult.data ?? []);
    setLoadingData(false);
  }, [id]);

  useEffect(() => {
    if (user && id) fetchData();
  }, [user, id, fetchData]);

  const confirmReservation = async () => {
    if (!reservation) return;
    setStatusBusy(true);
    try {
      await setReservationStatus(reservation.id, 'confirmed');
      toast.success(t('pms.res.confirmedOk'));
      await fetchData();
    } catch (err) {
      const key = err instanceof LifecycleError ? err.translationKey : null;
      toast.error(key ? t(key) : (err as Error).message);
    } finally {
      setStatusBusy(false);
    }
  };

  const submitStatusAction = async () => {
    if (!reservation || !statusAction) return;
    setStatusBusy(true);
    try {
      await setReservationStatus(reservation.id, statusAction, statusReason.trim() || undefined);
      toast.success(statusAction === 'no_show' ? t('pms.res.noShowOk') : t('pms.res.cancelledOk'));
      setStatusAction(null);
      setStatusReason('');
      await fetchData();
    } catch (err) {
      const key = err instanceof LifecycleError ? err.translationKey : null;
      toast.error(key ? t(key) : (err as Error).message);
    } finally {
      setStatusBusy(false);
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
  const room = reservation.rooms;
  const pmsManaged = isPmsManaged(reservation);
  const guestLabel = reservationGuestLabel(reservation);
  const active = !['cancelled', 'checked_out', 'no_show'].includes(reservation.status);
  const canCheckIn = ['confirmed', 'pending'].includes(reservation.status);
  const canCancelOrNoShow = ['confirmed', 'pending'].includes(reservation.status);

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <PMSNavigation />
      <main
        className="container mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-4"
        data-training="res-detail"
      >
        <div className="flex items-center gap-2">
          <Link to={`${basePath}/reservations`}>
            <Button variant="ghost" size="sm" className="gap-1">
              <ArrowLeft className="h-4 w-4" /> {t('pms.reservations')}
            </Button>
          </Link>
          <span className="text-muted-foreground">/</span>
          <span className="font-mono text-sm">{reservation.reservation_number}</span>
        </div>

        {pmsManaged && (
          <div className="flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5 text-sm">
            <Lock className="h-4 w-4 text-primary mt-0.5 shrink-0" />
            <div>
              <p className="font-medium">{t('pms.res.pmsManagedTitle')}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{t('pms.res.pmsManagedHint')}</p>
            </div>
          </div>
        )}

        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold truncate">{guestLabel}</h1>
              <Badge className={RESERVATION_STATUS_COLORS[reservation.status] || 'bg-muted'}>
                {t(`pms.reservations.${reservation.status === 'no_show' ? 'noShow' : reservation.status === 'checked_in' ? 'checkedIn' : reservation.status === 'checked_out' ? 'checkedOut' : reservation.status}`)}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
              <span className="font-mono">{reservation.reservation_number}</span>
              <span>·</span>
              <span className="capitalize">{reservation.source?.replaceAll('_', ' ') || '—'}</span>
              {reservation.source_reservation_id && (
                <><span>·</span><span className="font-mono text-xs">{reservation.source_reservation_id}</span></>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button size="sm" variant="outline" className="gap-1" onClick={() => setEditOpen(true)}>
              <Edit className="h-3.5 w-3.5" /> {t('common.edit')}
            </Button>
            {reservation.status === 'pending' && (
              <Button size="sm" onClick={confirmReservation} disabled={statusBusy}>{t('pms.reservationDetail.confirm')}</Button>
            )}
            {canCheckIn && (
              <Button size="sm" onClick={() => setCheckInOpen(true)} data-training="fd-checkin-button">
                {t('pms.checkIn')}
              </Button>
            )}
            {reservation.status === 'checked_in' && (
              <Button size="sm" variant="outline" onClick={() => setCheckOutOpen(true)} data-training="fd-checkout-button">
                {t('pms.checkOut')}
              </Button>
            )}
            {canCancelOrNoShow && (
              <Button size="sm" variant="outline" onClick={() => setStatusAction('no_show')}>
                {t('pms.res.markNoShow')}
              </Button>
            )}
            {active && reservation.status !== 'checked_in' && (
              <Button size="sm" variant="destructive" onClick={() => setStatusAction('cancelled')}>
                {t('pms.reservationDetail.cancel')}
              </Button>
            )}
          </div>
        </div>

        <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><User className="h-4 w-4" /> {t('pms.reservationDetail.guestInfo')}</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div><span className="text-muted-foreground">{t('pms.reservationDetail.name')}:</span> <strong>{guestLabel}</strong></div>
              {guest?.email && <div><span className="text-muted-foreground">{t('pms.guests.email')}:</span> {guest.email}</div>}
              {guest?.phone && <div><span className="text-muted-foreground">{t('pms.guests.phone')}:</span> {guest.phone}</div>}
              {guest?.nationality && <div><span className="text-muted-foreground">{t('pms.guests.nationality')}:</span> {guest.nationality}</div>}
              {guest?.company_name && <div><span className="text-muted-foreground">{t('pms.guests.company')}:</span> {guest.company_name}</div>}
              {guest?.id_document_number && <div><span className="text-muted-foreground">ID:</span> {guest.id_document_type} · {guest.id_document_number}</div>}
              {!guest && reservation.pms_guest_name && <p className="text-xs text-muted-foreground">{t('pms.res.pmsGuestOnly')}</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><BedDouble className="h-4 w-4" /> {t('pms.res.room')}</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div><span className="text-muted-foreground">{t('pms.res.room')}:</span> <strong>{room?.room_number || t('pms.res.unassigned')}</strong></div>
              <div><span className="text-muted-foreground">{t('pms.reservationDetail.roomType')}:</span> {room?.room_type || reservation.room_type_requested || t('pms.reservationDetail.notSpecified')}</div>
              {room?.status && <div><span className="text-muted-foreground">{t('common.status')}:</span> <span className="capitalize">{room.status.replaceAll('_', ' ')}</span></div>}
              {room?.capacity ? <div><span className="text-muted-foreground">{t('pms.res.capacity')}:</span> {room.capacity}</div> : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><CalendarDays className="h-4 w-4" /> {t('pms.reservationDetail.stayDetails')}</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div><span className="text-muted-foreground">{t('pms.reservations.checkInDate')}:</span> <strong>{reservation.check_in_date}</strong></div>
              <div><span className="text-muted-foreground">{t('pms.reservations.checkOutDate')}:</span> <strong>{reservation.check_out_date}</strong></div>
              <div><span className="text-muted-foreground">{t('pms.reservations.nights')}:</span> {reservation.total_nights || '—'}</div>
              <div><span className="text-muted-foreground">{t('pms.res.pax')}:</span> {reservation.adults}A{reservation.children ? ` · ${reservation.children}C` : ''}</div>
              {reservation.actual_check_in && <div className="text-xs"><span className="text-muted-foreground">{t('pms.reservationDetail.actualCheckIn')}:</span> {new Date(reservation.actual_check_in).toLocaleString()}</div>}
              {reservation.actual_check_out && <div className="text-xs"><span className="text-muted-foreground">{t('pms.reservationDetail.actualCheckOut')}:</span> {new Date(reservation.actual_check_out).toLocaleString()}</div>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><CreditCard className="h-4 w-4" /> {t('pms.reservationDetail.financialSummary')}</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div><span className="text-muted-foreground">{t('pms.reservationDetail.ratePerNight')}:</span> {formatMoney(reservation.rate_per_night, reservation.currency)}</div>
              <div><span className="text-muted-foreground">{t('pms.reservationDetail.total')}:</span> <strong>{formatMoney(reservation.total_amount, reservation.currency)}</strong></div>
              <div><span className="text-muted-foreground">{t('pms.reservationDetail.payment')}:</span> <Badge variant="outline" className="capitalize">{reservation.payment_status?.replaceAll('_', ' ') || '—'}</Badge></div>
              <div><span className="text-muted-foreground">{t('pms.reservationDetail.balance')}:</span> <strong>{formatMoney(reservation.balance_due, reservation.currency)}</strong></div>
            </CardContent>
          </Card>
        </div>

        {(reservation.special_requests || reservation.internal_notes) && (
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><FileText className="h-4 w-4" /> {t('pms.reservationDetail.notesRequests')}</CardTitle></CardHeader>
            <CardContent className="grid md:grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground font-medium">{t('pms.reservationDetail.specialRequests')}</span>
                <p className="mt-1 whitespace-pre-wrap">{reservation.special_requests || '—'}</p>
              </div>
              <div>
                <span className="text-muted-foreground font-medium">{t('pms.reservationDetail.internalNotes')}</span>
                <p className="mt-1 whitespace-pre-wrap">{reservation.internal_notes || '—'}</p>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid xl:grid-cols-2 gap-4">
          <Card data-training="res-folio">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-sm flex items-center gap-2"><Receipt className="h-4 w-4" /> {t('pms.reservationDetail.guestFolio')}</CardTitle>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="gap-1" onClick={() => setFolioMode('charge')} data-training="res-folio-add-charge">
                    <Plus className="h-3.5 w-3.5" /> {t('pms.res.addCharge')}
                  </Button>
                  <Button size="sm" className="gap-1" onClick={() => setFolioMode('payment')} data-training="res-folio-add-payment">
                    <Banknote className="h-3.5 w-3.5" /> {t('pms.res.addPayment')}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {folioItems.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">{t('pms.reservationDetail.noCharges')}</p>
              ) : (
                <div className="divide-y">
                  {folioItems.map((item) => (
                    <div key={item.id} className="flex items-center justify-between py-2 gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{item.description}</p>
                        <p className="text-xs text-muted-foreground capitalize">{item.charge_type?.replaceAll('_', ' ')} · {item.charge_date}</p>
                      </div>
                      <span className={`text-sm font-semibold ${item.charge_type === 'payment' ? 'text-green-600' : ''}`}>
                        {item.charge_type === 'payment' ? '−' : '+'}{formatMoney(Math.abs(Number(item.amount || 0)), reservation.currency)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><History className="h-4 w-4" /> {t('pms.res.auditTimeline')}</CardTitle></CardHeader>
            <CardContent>
              {events.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">{t('pms.res.noAuditEvents')}</p>
              ) : (
                <div className="space-y-3">
                  {events.map((event) => {
                    const reason = event.metadata && typeof event.metadata === 'object' ? event.metadata.reason : null;
                    return (
                      <div key={event.id} className="flex gap-3 text-sm">
                        <div className="mt-1 h-2 w-2 rounded-full bg-primary shrink-0" />
                        <div className="min-w-0">
                          <p className="font-medium capitalize">{String(event.event_type || '').replaceAll('_', ' ')}</p>
                          {reason && <p className="text-xs text-muted-foreground mt-0.5">{reason}</p>}
                          <p className="text-[11px] text-muted-foreground mt-0.5">{new Date(event.created_at).toLocaleString()}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {reservation.source_reservation_id && (
          <div className="text-xs text-muted-foreground flex items-center gap-1.5 px-1">
            <Hash className="h-3 w-3" /> {t('pms.res.sourceReference')}: <span className="font-mono">{reservation.source_reservation_id}</span>
          </div>
        )}
      </main>

      <EditReservationDialog
        reservation={reservation}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSuccess={fetchData}
      />
      <CheckInDialog
        reservation={reservation}
        open={checkInOpen}
        onOpenChange={setCheckInOpen}
        onSuccess={() => { setCheckInOpen(false); fetchData(); }}
      />
      <CheckOutDialog
        reservation={reservation}
        open={checkOutOpen}
        onOpenChange={setCheckOutOpen}
        onSuccess={() => { setCheckOutOpen(false); fetchData(); }}
      />
      {folioMode && (
        <FolioItemDialog
          reservationId={reservation.id}
          currency={reservation.currency}
          mode={folioMode}
          open={!!folioMode}
          onOpenChange={(open) => !open && setFolioMode(null)}
          onSuccess={fetchData}
        />
      )}

      <Dialog open={!!statusAction} onOpenChange={(open) => { if (!open) { setStatusAction(null); setStatusReason(''); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              {statusAction === 'no_show' ? t('pms.res.markNoShow') : t('pms.res.cancelReservation')}
            </DialogTitle>
            <DialogDescription>
              {statusAction === 'no_show' ? t('pms.res.noShowConfirm') : t('pms.res.cancelConfirm')}
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label>{t('pms.res.reasonOptional')}</Label>
            <Textarea value={statusReason} onChange={(e) => setStatusReason(e.target.value)} maxLength={500} placeholder={t('pms.res.reasonPlaceholder')} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStatusAction(null)}>{t('common.cancel')}</Button>
            <Button
              variant={statusAction === 'cancelled' ? 'destructive' : 'default'}
              onClick={submitStatusAction}
              disabled={statusBusy}
            >
              {statusBusy ? t('pms.checkIn.processing') : (statusAction === 'no_show' ? t('pms.res.markNoShow') : t('pms.res.cancelReservation'))}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ReservationDetail;
