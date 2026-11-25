import { useCallback, useEffect, useState } from 'react';
import { displayRoomType } from '@/lib/roomTypeDisplay';
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
  ArrowLeft, User, CalendarDays, BedDouble, CreditCard, Edit,
  History, Lock, AlertTriangle, Hash, ArrowLeftRight, LogOut,
} from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from '@/hooks/useTranslation';
import { useLocaleFormat } from '@/lib/i18n/localeFormat';
import { bookingSourceLabel, documentTypeLabel, paymentStatusLabel, reservationEventLabel, reservationStatusLabel, roomStatusLabel } from '@/lib/i18n/receptionLabels';
import { CheckInDialog } from '@/components/frontdesk/CheckInDialog';
import { CheckOutDialog } from '@/components/frontdesk/CheckOutDialog';
import { NtakBookingNumberField } from '@/components/ntak/NtakBookingNumberField';
import { RoomChangeDialog } from '@/components/frontdesk/RoomChangeDialog';
import { EditReservationDialog } from '@/components/reservations/EditReservationDialog';
import { ReservationNotesPanel } from '@/components/reservations/ReservationNotesPanel';
import { PrevioWritebackStatus } from '@/components/reservations/PrevioWritebackStatus';
import { ReservationAccountPanel } from '@/components/reservations/ReservationAccountPanel';
import { PciCardPanel } from '@/components/reservations/PciCardPanel';
import { VccDetailsPanel } from '@/components/reservations/VccDetailsPanel';
import { ReservationGuestIfa } from '@/components/ntak/ReservationGuestIfa';
import { GuestWelcomeCard } from '@/components/guests/GuestWelcomeCard';
import { useGuestSignals } from '@/hooks/useGuestSignals';
import { guestProfilePath } from '@/lib/guestJourney';
import { LifecycleError, setReservationStatus } from '@/lib/pmsLifecycle';
import {
  formatMoney, isPmsManaged, pmsHoldKind, pmsPaymentNote, reservationChannel, reservationGuestLabel, RESERVATION_STATUS_COLORS,
} from '@/lib/reservations';

const RES_SELECT = `
  *,
  guests!reservations_guest_id_fkey(id, first_name, last_name, email, phone, nationality, vip_status, company_name, id_document_type, id_document_number),
  rooms:room_id(id, room_number, room_type, status, room_capacity)
`;

type StatusAction = 'cancelled' | 'no_show' | null;

const ReservationDetail = () => {
  const { user, loading } = useAuth();
  const { organizationSlug, id } = useParams<{ organizationSlug: string; id: string }>();
  const { t, language } = useTranslation();
  const locale = useLocaleFormat();
  const [reservation, setReservation] = useState<any>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [ntakActive, setNtakActive] = useState(false);
  const [loadingData, setLoadingData] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [checkInOpen, setCheckInOpen] = useState(false);
  const [checkOutOpen, setCheckOutOpen] = useState(false);
  const [roomChangeOpen, setRoomChangeOpen] = useState(false);
  const [statusAction, setStatusAction] = useState<StatusAction>(null);
  const [statusReason, setStatusReason] = useState('');
  const [statusBusy, setStatusBusy] = useState(false);
  const basePath = `/${organizationSlug || 'rdhotels'}`;
  const guestSignal = useGuestSignals(id ? [id] : []).get(id ?? '');

  const fetchData = useCallback(async () => {
    if (!id) return;
    setLoadingData(true);
    const [resResult, eventResult] = await Promise.all([
      supabase.from('reservations').select(RES_SELECT).eq('id', id).single(),
      supabase.from('reservation_events').select('*').eq('reservation_id', id).order('created_at', { ascending: false }).limit(100),
    ]);

    if (resResult.error) {
      setReservation(null);
    } else {
      setReservation(resResult.data);
    }
    setEvents(eventResult.data ?? []);
    if (resResult.data?.hotel_id) {
      const { data: enabled, error: availabilityError } = await (supabase.rpc as CallableFunction)(
        'pms_guest_lifecycle_available',
        { _reservation_id: resResult.data.id, _room_id: resResult.data.room_id ?? null },
      );
      // Availability is not guessed if the new schema has not been applied.
      setNtakActive(!availabilityError && enabled === true);
    } else setNtakActive(false);
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
  // Once the first guest arrives, another expected guest may arrive later.
  // NTAK-enabled hotels keep the check-in action available to add/select them.
  const canCheckIn = ['confirmed', 'pending'].includes(reservation.status)
    || (ntakActive && reservation.status === 'checked_in');
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

        <div className="flex w-full min-w-0 flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold truncate">{guestLabel}</h1>
              <Badge className={RESERVATION_STATUS_COLORS[reservation.status] || 'bg-muted'}>
                {language === 'hu' ? reservationStatusLabel(reservation.status, t) : t(`pms.reservations.${reservation.status === 'no_show' ? 'noShow' : reservation.status === 'checked_in' ? 'checkedIn' : reservation.status === 'checked_out' ? 'checkedOut' : reservation.status}`)}
              </Badge>
              {pmsHoldKind(reservation) === 'option' && (
                <Badge variant="outline">
                  {t('pms.res.option')}{reservation.pms_option_expires_at ? ` · ${t('pms.res.optionExpires')} ${locale.formatDateTime(reservation.pms_option_expires_at)}` : ''}
                </Badge>
              )}
              {pmsHoldKind(reservation) === 'waiting_list' && <Badge variant="outline">{t('pms.res.waitingList')}</Badge>}
              {reservation.pms_missing_since && (
                <Badge variant="destructive" title={locale.formatDateTime(reservation.pms_missing_since)}>{t('pms.res.notInPrevio')}</Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
              <span className="font-mono">{reservation.reservation_number}</span>
              <span>·</span>
              <span>{language === 'hu' ? bookingSourceLabel(reservationChannel(reservation).label, t) : reservationChannel(reservation).label}</span>
              {reservation.pms_voucher && (
                <><span>·</span><span className="text-xs">{t('pms.res.voucher')} <span className="font-mono">{reservation.pms_voucher}</span></span></>
              )}
              {reservation.source_reservation_id && (
                <><span>·</span><span className="font-mono text-xs">{reservation.source_reservation_id}</span></>
              )}
            </p>
            {reservation.source === 'previo' && (
              <div className="mt-2 max-w-xl">
                <PrevioWritebackStatus reservationId={reservation.id} refreshKey={`${reservation.status}|${reservation.actual_check_in ?? ''}|${reservation.actual_check_out ?? ''}`} />
              </div>
            )}
          </div>
          <div className="grid w-full min-w-0 grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap">
            <Button size="sm" variant="outline" className="min-w-0 w-full gap-1 sm:w-auto" onClick={() => setEditOpen(true)}>
              <Edit className="h-3.5 w-3.5" /> {t('common.edit')}
            </Button>
            {reservation.status === 'pending' && (
              <Button size="sm" className="min-w-0 w-full sm:w-auto" onClick={confirmReservation} disabled={statusBusy}>{t('pms.reservationDetail.confirm')}</Button>
            )}
            {canCheckIn && (
              <Button size="sm" className="min-w-0 w-full sm:w-auto" onClick={() => setCheckInOpen(true)} data-training="fd-checkin-button">
                {t('pms.checkIn')}
              </Button>
            )}
            {reservation.status === 'checked_in' && reservation.room_id && (
              <Button size="sm" variant="outline" className="h-auto min-h-9 w-full min-w-0 gap-1.5 whitespace-normal border-blue-300 bg-blue-50 text-blue-800 hover:border-blue-400 hover:bg-blue-100 hover:text-blue-900 dark:border-blue-500/70 dark:bg-blue-950 dark:text-blue-200 dark:hover:bg-blue-900 dark:hover:text-blue-100 sm:w-auto" onClick={() => setRoomChangeOpen(true)} data-training="fd-room-change-button">
                <ArrowLeftRight className="h-4 w-4 shrink-0" /> {t('pms.businessMoment.changeRoom')}
              </Button>
            )}
            {ntakActive && reservation.status === 'checked_out' && (
              <Button size="sm" variant="outline" className="min-w-0 w-full sm:w-auto" onClick={() => setCheckOutOpen(true)} data-training="fd-undo-checkout-button">
                {t('pms.stayGuest.undoDeparture')}
              </Button>
            )}
            {reservation.status === 'checked_in' && (
              <Button size="sm" variant="outline" className="h-auto min-h-9 w-full min-w-0 gap-1.5 whitespace-normal border-amber-500 bg-amber-500 text-amber-950 hover:border-amber-400 hover:bg-amber-400 hover:text-amber-950 dark:border-amber-400 dark:bg-amber-400 dark:text-amber-950 dark:hover:bg-amber-300 dark:hover:text-amber-950 sm:w-auto" onClick={() => setCheckOutOpen(true)} data-training="fd-checkout-button">
                <LogOut className="h-4 w-4 shrink-0" /> {t('pms.checkOut')}
              </Button>
            )}
            {canCancelOrNoShow && (
              <Button size="sm" variant="outline" className="min-w-0 w-full sm:w-auto" onClick={() => setStatusAction('no_show')}>
                {t('pms.res.markNoShow')}
              </Button>
            )}
            {active && reservation.status !== 'checked_in' && (
              <Button size="sm" variant="destructive" className="min-w-0 w-full sm:w-auto" onClick={() => setStatusAction('cancelled')}>
                {t('pms.reservationDetail.cancel')}
              </Button>
            )}
          </div>
        </div>

        <GuestWelcomeCard reservationId={reservation.id} signal={guestSignal ?? null} hotelId={reservation.hotel_id} basePath={basePath} />

        {ntakActive && <ReservationGuestIfa key={reservation.id} reservationId={reservation.id} night={reservation.check_in_date} />}

        <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><User className="h-4 w-4" /> {t('pms.reservationDetail.guestInfo')}</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div><span className="text-muted-foreground">{t('pms.reservationDetail.name')}:</span> <strong>{guestLabel}</strong></div>
              {guest?.email && <div><span className="text-muted-foreground">{t('pms.guests.email')}:</span> {guest.email}</div>}
              {guest?.phone && <div><span className="text-muted-foreground">{t('pms.guests.phone')}:</span> {guest.phone}</div>}
              {guest?.nationality && <div><span className="text-muted-foreground">{t('pms.guests.nationality')}:</span> {guest.nationality}</div>}
              {guest?.company_name && <div><span className="text-muted-foreground">{t('pms.guests.company')}:</span> {guest.company_name}</div>}
              {guest?.id_document_number && <div><span className="text-muted-foreground">{t('reception.home.documentId')}</span> <span title={guest.id_document_type ?? undefined}>{language === 'hu' ? documentTypeLabel(guest.id_document_type, t) : guest.id_document_type}</span> · {guest.id_document_number}</div>}
              {!guest && reservation.pms_guest_name && <p className="text-xs text-muted-foreground">{t('pms.res.pmsGuestOnly')}</p>}
              {guestSignal?.profile_key && reservation.hotel_id && (
                <Link to={guestProfilePath(basePath, reservation.hotel_id, guestSignal.profile_key)} className="inline-block text-xs font-medium text-primary hover:underline">
                  {t('pms.guest.profileAndHistory')} →
                </Link>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><BedDouble className="h-4 w-4" /> {t('pms.res.room')}</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div><span className="text-muted-foreground">{t('pms.res.room')}:</span> <strong>{room?.room_number || t('pms.res.unassigned')}</strong></div>
              <div><span className="text-muted-foreground">{t('pms.reservationDetail.roomType')}:</span> {displayRoomType(room?.room_type || reservation.room_type_requested) || t('pms.reservationDetail.notSpecified')}</div>
              {room?.status && <div><span className="text-muted-foreground">{t('common.status')}:</span> <span className={language === 'hu' ? undefined : 'capitalize'} title={room.status}>{language === 'hu' ? roomStatusLabel(room.status, t) : room.status.replaceAll('_', ' ')}</span></div>}
              <NtakBookingNumberField reservation={reservation} onSaved={() => void fetchData()} />
              {room?.room_capacity ? <div><span className="text-muted-foreground">{t('pms.res.capacity')}:</span> {room.room_capacity}</div> : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><CalendarDays className="h-4 w-4" /> {t('pms.reservationDetail.stayDetails')}</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div><span className="text-muted-foreground">{t('pms.reservations.checkInDate')}:</span> <strong>{locale.formatDate(reservation.check_in_date)}</strong></div>
              <div><span className="text-muted-foreground">{t('pms.reservations.checkOutDate')}:</span> <strong>{locale.formatDate(reservation.check_out_date)}</strong></div>
              <div><span className="text-muted-foreground">{t('pms.reservations.nights')}:</span> {reservation.total_nights || '—'}</div>
              <div><span className="text-muted-foreground">{t('pms.res.pax')}:</span> {t('reception.home.detailPax').replace('{adults}', String(reservation.adults)).replace('{children}', reservation.children ? t('reception.home.detailChildren').replace('{count}', String(reservation.children)) : '')}</div>
              {reservation.actual_check_in && <div className="text-xs"><span className="text-muted-foreground">{t('pms.reservationDetail.actualCheckIn')}:</span> {locale.formatDateTime(reservation.actual_check_in)}</div>}
              {reservation.actual_check_out && <div className="text-xs"><span className="text-muted-foreground">{t('pms.reservationDetail.actualCheckOut')}:</span> {locale.formatDateTime(reservation.actual_check_out)}</div>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><CreditCard className="h-4 w-4" /> {t('pms.reservationDetail.financialSummary')}</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div><span className="text-muted-foreground">{t('pms.reservationDetail.ratePerNight')}:</span> {(language === 'hu' ? locale.formatMoney : formatMoney)(reservation.rate_per_night, reservation.currency)}</div>
              <div><span className="text-muted-foreground">{t('pms.reservationDetail.total')}:</span> <strong>{(language === 'hu' ? locale.formatMoney : formatMoney)(reservation.total_amount, reservation.currency)}</strong></div>
              <div><span className="text-muted-foreground">{t('pms.reservationDetail.payment')}:</span> <Badge variant="outline" className={language === 'hu' ? undefined : 'capitalize'} title={reservation.payment_status ?? undefined}>{language === 'hu' && reservation.payment_status ? paymentStatusLabel(reservation.payment_status, t) : reservation.payment_status?.replaceAll('_', ' ') || '—'}</Badge></div>
              <div><span className="text-muted-foreground">{t('pms.reservationDetail.balance')}:</span> <strong>{(language === 'hu' ? locale.formatMoney : formatMoney)(reservation.balance_due, reservation.currency)}</strong></div>
              {pmsPaymentNote(reservation) === 'paid' && <p className="text-xs text-green-700 dark:text-green-400">{t('pms.res.paidInPrevio')}</p>}
              {pmsPaymentNote(reservation) === 'partial' && <p className="text-xs text-amber-700 dark:text-amber-400">{t('pms.res.partiallyPaidInPrevio')}</p>}
            </CardContent>
          </Card>
        </div>

        <ReservationNotesPanel specialRequests={reservation.special_requests} internalNotes={reservation.internal_notes} />

        <div className="grid xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)] gap-4 items-start">
          <ReservationAccountPanel reservation={reservation} onFinancialChanged={fetchData} />
          <VccDetailsPanel reservation={reservation} />
          {reservation.hotel_id && <PciCardPanel hotelId={reservation.hotel_id} reservationId={reservation.id} />}

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
                          <p className={language === 'hu' ? 'font-medium' : 'font-medium capitalize'} title={String(event.event_type ?? '')}>{language === 'hu' ? reservationEventLabel(event.event_type, t) : String(event.event_type || '').replace(/_/g, ' ')}</p>
                          {reason && <p className="text-xs text-muted-foreground mt-0.5">{reason}</p>}
                          <p className="text-[11px] text-muted-foreground mt-0.5">{locale.formatDateTime(event.created_at)}</p>
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
      {reservation.room_id && <RoomChangeDialog
        reservation={reservation}
        open={roomChangeOpen}
        onOpenChange={setRoomChangeOpen}
        onSuccess={() => { setRoomChangeOpen(false); void fetchData(); }}
      />}
      <CheckOutDialog
        reservation={reservation}
        open={checkOutOpen}
        onOpenChange={setCheckOutOpen}
        onSuccess={() => { setCheckOutOpen(false); fetchData(); }}
      />
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
