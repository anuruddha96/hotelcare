import { useEffect, useMemo, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
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

  const today = getLocalDateString();
  const pax = (reservation.adults ?? 1) + (reservation.children ?? 0);
  const balance = balanceOf(reservation);
  const guest = reservation.guests;
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
    const base = rooms.filter((r) => r.room_status !== 'occupied');
    return showAll ? base : base.filter((r) => r.room_status === 'clean');
  }, [rooms, showAll]);

  const selected = rooms.find((r) => r.room_id === selectedRoom);
  const capacityWarn = !!selected && selected.capacity > 0 && pax > selected.capacity;
  const notCleanWarn = !!selected && selected.room_status !== 'clean';
  const needsOverride = capacityWarn || notCleanWarn;

  const handleCheckIn = async () => {
    if (!selectedRoom) {
      toast.error(t('pms.checkIn.pleaseSelectRoom'));
      return;
    }
    setSubmitting(true);
    try {
      const result = await checkInReservation(reservation.id, selectedRoom, override);
      toast.success(`${reservationGuestLabel(reservation)} ${t('pms.checkIn.checkedIn')} · ${t('pms.res.room')} ${result.room_number ?? ''}`);
      onSuccess();
    } catch (err) {
      const key = err instanceof LifecycleError ? err.translationKey : null;
      toast.error(key ? t(key) : t('pms.checkIn.failedCheckIn'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-training="fd-checkin-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LogIn className="h-5 w-5 text-primary" /> {t('pms.checkIn.checkInGuest')}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="p-3 rounded-lg bg-accent/30 border border-border">
            <p className="font-semibold">{reservationGuestLabel(reservation)}</p>
            <p className="text-sm text-muted-foreground">{reservation.reservation_number}</p>
            <p className="text-sm text-muted-foreground">
              {reservation.check_in_date} → {reservation.check_out_date} · {reservation.total_nights}N · {reservation.adults}A {reservation.children > 0 ? `${reservation.children}C` : ''}
            </p>
          </div>

          {(reservation.special_requests || balance > 0 || missingContact) && (
            <div className="space-y-1.5">
              {reservation.special_requests && (
                <p className="text-sm text-amber-600 flex items-start gap-1.5">
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" /> {reservation.special_requests}
                </p>
              )}
              {balance > 0 && (
                <p className="text-sm text-amber-600 flex items-center gap-1.5">
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
              <Select value={selectedRoom} onValueChange={setSelectedRoom}>
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

          {(needsOverride || reservation.check_in_date !== today) && (
            <div className="flex items-start gap-2">
              <Checkbox id="override" checked={override} onCheckedChange={(c) => setOverride(!!c)} className="mt-0.5" />
              <label htmlFor="override" className="text-xs text-muted-foreground">
                {t('pms.ci.overrideLabel')}
                {capacityWarn && ` · ${t('pms.err.capacityExceeded')}`}
                {notCleanWarn && ` · ${t('pms.err.roomNotClean')}`}
              </label>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button
            onClick={handleCheckIn}
            disabled={submitting || !selectedRoom}
            className="gap-1"
            data-training="fd-checkin-confirm"
          >
            <LogIn className="h-4 w-4" /> {submitting ? t('pms.checkIn.processing') : t('pms.checkIn')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
