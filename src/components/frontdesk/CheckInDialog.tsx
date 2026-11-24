import { useEffect, useMemo, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { LogIn, AlertCircle, Loader2 } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { getLocalDateString } from '@/lib/utils';
import {
  fetchAvailableRooms, checkInReservation, LifecycleError, type AvailableRoom,
} from '@/lib/pmsLifecycle';
import { balanceOf, formatMoney, reservationGuestLabel } from '@/lib/reservations';
import { summarizeReservationNote } from '@/lib/previoReservationNote';
import { GuestDetailsSection } from '@/components/frontdesk/GuestDetailsSection';
import { BusinessMomentField, useBusinessMoment } from '@/components/frontdesk/BusinessMomentField';
import { StayGuestRoster, useStayGuestRoster } from '@/components/frontdesk/StayGuestRoster';
import { GuestWelcomeCard } from '@/components/guests/GuestWelcomeCard';
import { useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { formatVizaArrivalError } from '@/lib/idScan/vizaArrivalError';

interface CheckInDialogProps {
  reservation: any;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function CheckInDialog({ reservation, open, onOpenChange, onSuccess }: CheckInDialogProps) {
  const { t } = useTranslation();
  const [rooms, setRooms] = useState<AvailableRoom[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(false);
  const [selectedRoom, setSelectedRoom] = useState<string>(reservation.room_id || '');
  const [showAll, setShowAll] = useState(false);
  const [override, setOverride] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [savePending, setSavePending] = useState(false);
  const requestClose = (next: boolean) => {
    if (!next && savePending) { toast.error(t('pms.guest.autosaveWait')); return; }
    onOpenChange(next);
  };
  useEffect(() => {
    if (!savePending) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [savePending]);
  const [vizaMissing, setVizaMissing] = useState<string[] | null>(null);
  const [arrivalError, setArrivalError] = useState<string | null>(null);
  const [vizaRequired, setVizaRequired] = useState(false);
  const [vizaLoading, setVizaLoading] = useState(true);
  const [vizaLoadFailed, setVizaLoadFailed] = useState(false);
  useEffect(() => {
    let active=true; setVizaRequired(false); setVizaMissing(null); setArrivalError(null);
    setVizaLoading(open); setVizaLoadFailed(false);
    if(open) void (supabase.rpc as CallableFunction)('pms_viza_registration_required',{_reservation_id:reservation.id})
      .then(({data,error}: {data:unknown;error:unknown}) => {if(active) { setVizaRequired(data===true); setVizaLoadFailed(!!error); setVizaLoading(false); }})
      .catch(()=>{if(active) {setVizaLoadFailed(true); setVizaLoading(false);}});
    return ()=>{active=false;};
  },[open,reservation.id]);
  const businessMoment = useBusinessMoment(reservation.hotel_id, open);
  const roster = useStayGuestRoster(reservation.id, reservation.hotel_id, open && !vizaLoading && !vizaLoadFailed, 'arrive', selectedRoom || reservation.room_id, vizaRequired, businessMoment.occurredAt);

  const today = getLocalDateString();
  const pax = (reservation.adults ?? 1) + (reservation.children ?? 0);
  const balance = balanceOf(reservation);
  // Previo/OTA notes arrive as a block of markup: show only what reception must act on.
  const noteSummary = summarizeReservationNote(reservation.special_requests);
  const guest = reservation.guests;
  const { organizationSlug } = useParams<{ organizationSlug?: string }>();
  const missingContact = !guest?.email && !guest?.phone;

  useEffect(() => {
    if (!open || !reservation.hotel_id) return;
    let alive = true;
    setLoadingRooms(true);
    const from = today < reservation.check_out_date ? today : reservation.check_in_date;
    const to = reservation.check_out_date > from ? reservation.check_out_date : from;
    fetchAvailableRooms(reservation.hotel_id, from, to === from ? from : to, reservation.id)
      .then((data) => { if (alive) setRooms(data); })
      .catch(() => { if (alive) setRooms([]); })
      .finally(() => { if (alive) setLoadingRooms(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reservation.id]);

  const visibleRooms = useMemo(() => {
    const base = rooms.filter((r) => r.room_status !== 'occupied' || r.room_id === reservation.room_id);
    return showAll ? base : base.filter((r) => r.room_status === 'clean');
  }, [rooms, showAll]);

  const selected = rooms.find((r) => r.room_id === selectedRoom);
  const capacityWarn = !!selected && selected.capacity > 0 && pax > selected.capacity;
  const notCleanWarn = !!selected && selected.room_status !== 'clean'
    && !(reservation.status === 'checked_in' && selected.room_id === reservation.room_id);
  const guestDetailsLoading = !roster.enabled && !!reservation.guest_id && vizaMissing === null;
  const vizaWarn = !!reservation.guest_id && (vizaMissing?.length ?? 0) > 0;
  const needsOverride = capacityWarn || notCleanWarn || (vizaWarn && !vizaRequired);
  const rosterCountMismatch = vizaRequired && roster.enabled && roster.guests.filter(g => g.stay_state !== 'void').length !== pax;
  const vizaBlocked = vizaRequired && (roster.enabled ? roster.incompleteSelected > 0 || rosterCountMismatch : vizaWarn || !reservation.guest_id || pax > 1);

  const handleCheckIn = async () => {
    if (savePending) return;
    if (!selectedRoom) {
      toast.error(t('pms.checkIn.pleaseSelectRoom'));
      return;
    }
    setSubmitting(true);
    setArrivalError(null);
    try {
      const result = await checkInReservation(reservation.id, selectedRoom, override, businessMoment.occurredAt,
        roster.perGuestLifecycle ? roster.selectedIds : null);
      toast.success(`${reservationGuestLabel(reservation)} ${t('pms.checkIn.checkedIn')} · ${t('pms.res.room')} ${result.room_number ?? ''}`);
      onSuccess();
    } catch (err) {
      const key = err instanceof LifecycleError ? err.translationKey : null;
      const registrationError = formatVizaArrivalError((err as Error).message ?? '', t);
      if (registrationError) setArrivalError(registrationError);
      toast.error(registrationError ?? (key ? t(key) : (err as Error).message || t('pms.checkIn.failedCheckIn')));

    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={requestClose}>
      <DialogContent className="w-[calc(100%-0.75rem)] max-w-xl max-h-[94dvh] overflow-hidden gap-0 rounded-2xl bg-background px-0 py-0 sm:!h-auto sm:max-h-[90dvh]" data-training="fd-checkin-dialog">
        <DialogHeader className="shrink-0 border-b border-border/70 px-4 py-4 pr-12 text-left sm:px-5 sm:pr-12">
          <DialogTitle className="flex items-center gap-2">
            <LogIn className="h-5 w-5 text-primary" /> {t('pms.checkIn.checkInGuest')}
          </DialogTitle>
        </DialogHeader>
        <div className="min-h-0 min-w-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-3 py-4 sm:px-5" data-training="fd-checkin-scroll">
          <div className="p-3 rounded-lg bg-accent/30 border border-border">
            <p className="text-xs text-muted-foreground">{t('pms.express.bookingContact')}</p>
            <p className="font-semibold">{reservationGuestLabel(reservation)}</p>
            <p className="text-sm text-muted-foreground">{reservation.reservation_number}</p>
            <p className="text-sm text-muted-foreground">
              {reservation.check_in_date} → {reservation.check_out_date} · {reservation.total_nights}N · {reservation.adults}A {reservation.children > 0 ? `${reservation.children}C` : ''}
            </p>
          </div>

          {/* Returning guest, VIP and saved preferences, before anything else. */}
          <GuestWelcomeCard reservationId={reservation.id} hotelId={reservation.hotel_id}
            basePath={organizationSlug ? `/${organizationSlug}` : undefined} />

          {!vizaLoading && !vizaRequired && !roster.enabled && reservation.guest_id && (
            <GuestDetailsSection occurredAt={businessMoment.occurredAt} vizaReservationId={vizaRequired ? reservation.id : undefined} guestId={reservation.guest_id} onCompletenessChange={setVizaMissing} autoSave onSavePendingChange={setSavePending}
              onSaved={() => setArrivalError(null)} />
          )}

          <StayGuestRoster expectedGuests={pax} bookingGuestId={reservation.guest_id} vizaRequired={vizaRequired} control={roster} mode="arrive" reservationId={reservation.id} hotelId={reservation.hotel_id}
            orgSlug={reservation.organization_slug} occurredAt={businessMoment.occurredAt} onChanged={onSuccess} savePending={savePending} onSavePendingChange={setSavePending} />
          {vizaLoadFailed && <p role="alert" className="text-sm text-destructive">{t('pms.guest.vizaStatusFailed')}</p>}
          {arrivalError && <p role="alert" className="text-sm text-destructive break-words">{arrivalError}</p>}

          {(noteSummary || balance > 0 || missingContact) && (
            <div className="space-y-1.5">
              {noteSummary && (
                <p className="text-sm text-amber-700 dark:text-amber-300 flex items-start gap-1.5 break-words">
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" /> {noteSummary}
                </p>
              )}
              {balance > 0 && (
                <p className="text-sm text-amber-700 dark:text-amber-300 flex items-center gap-1.5">
                  <AlertCircle className="h-4 w-4 shrink-0" /> {t('pms.ci.balanceOutstanding')}: {formatMoney(balance, reservation.currency)}
                </p>
              )}
              {missingContact && (
                <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                  <AlertCircle className="h-4 w-4 shrink-0" /> {t('pms.ci.missingContact')}
                </p>
              )}
            </div>
          )}

          <div>
            <Label>{t('pms.checkIn.assignRoom')}</Label>
            {loadingRooms ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                <Loader2 className="h-4 w-4 animate-spin" /> {t('pms.loading')}
              </div>
            ) : (
              <Select value={selectedRoom} onValueChange={setSelectedRoom} disabled={savePending}>
                <SelectTrigger data-training="fd-checkin-room-select">
                  <SelectValue placeholder={t('pms.checkIn.selectCleanRoom')} />
                </SelectTrigger>
                <SelectContent>
                  {visibleRooms.length === 0 && (
                    <div className="px-3 py-2 text-sm text-muted-foreground">{t('pms.planner.noRooms')}</div>
                  )}
                  {visibleRooms.map((room) => (
                    <SelectItem key={room.room_id} value={room.room_id} disabled={room.has_conflict}>
                      {room.room_number} {room.room_type ? `(${room.room_type})` : ''} · {room.capacity}P
                      {room.room_status !== 'clean' ? ` · ${t('pms.fd.readyDirty')}` : ''}
                      {room.has_conflict ? ` · ${t('pms.ci.conflict')}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <button
              type="button"
              className="text-xs text-muted-foreground underline mt-1"
              onClick={() => setShowAll((v) => !v)}
            >
              {showAll ? t('pms.ci.onlyCleanShown') : t('pms.ci.showAllRooms')}
            </button>
          </div>

          <BusinessMomentField control={businessMoment} />

          {(rosterCountMismatch || (vizaRequired && !roster.enabled && pax > 1)) && <p role="alert" className="text-sm text-destructive">{t('pms.guest.occupantCount')}</p>}
          {vizaBlocked && <p role="alert" className="text-sm text-destructive">{t('pms.guest.vizaArrivalBlocked')}</p>}
          {(needsOverride || reservation.check_in_date !== today) && (
            <div className="flex items-start gap-2">
              <Checkbox id="override" checked={override} onCheckedChange={(c) => setOverride(!!c)} className="mt-0.5" />
              <label htmlFor="override" className="text-xs text-muted-foreground">
                {t('pms.ci.overrideLabel')}
                {capacityWarn && ` · ${t('pms.err.capacityExceeded')}`}
                {notCleanWarn && ` · ${t('pms.err.roomNotClean')}`}
                {vizaWarn && !vizaRequired && ` · ${t('pms.guest.incompleteWarn')}`}
              </label>
            </div>
          )}
        </div>
        <DialogFooter className="shrink-0 gap-2 border-t border-border/70 bg-card px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:gap-2 sm:px-5">
          <Button variant="outline" className="min-h-11 text-muted-foreground sm:min-h-10" onClick={() => requestClose(false)}>{t('common.cancel')}</Button>
          <Button
            onClick={handleCheckIn}
            disabled={savePending || vizaLoading || vizaLoadFailed || submitting || businessMoment.invalid || !selectedRoom || roster.loading || guestDetailsLoading
              || (roster.perGuestLifecycle && roster.selectedIds.length === 0)
              || vizaBlocked || (vizaWarn && !vizaRequired && !override)}
            className="min-h-11 h-auto gap-2 whitespace-normal py-2 disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100 sm:min-h-10"
            data-training="fd-checkin-confirm"
          >
            <LogIn className="h-4 w-4" /> {submitting ? t('pms.checkIn.processing') : `${t('pms.checkIn')} · ${businessMoment.display}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
