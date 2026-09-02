import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { GuestSearchSelect } from '@/components/guests/GuestSearchSelect';
import { useTranslation } from '@/hooks/useTranslation';
import { useOperationalHotel } from '@/hooks/useOperationalHotel';
import { getLocalDateString } from '@/lib/utils';
import { createReservation, fetchAvailableRooms, LifecycleError, type AvailableRoom } from '@/lib/pmsLifecycle';
import { nightsBetween, RESERVATION_SOURCES, formatMoney } from '@/lib/reservations';

const UNASSIGNED = '__none__';
const CURRENCIES = ['HUF', 'EUR', 'CZK', 'USD', 'GBP'];

interface CreateReservationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function CreateReservationDialog({ open, onOpenChange, onSuccess }: CreateReservationDialogProps) {
  const { t } = useTranslation();
  const { hotelId, hotelKeys, orgSlug } = useOperationalHotel();
  const [submitting, setSubmitting] = useState(false);
  const [rooms, setRooms] = useState<AvailableRoom[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(false);
  const [form, setForm] = useState({
    guest_id: '',
    check_in_date: '',
    check_out_date: '',
    adults: 1,
    children: 0,
    room_id: UNASSIGNED,
    room_type_requested: '',
    rate_per_night: 0,
    currency: 'HUF',
    source: 'direct',
    special_requests: '',
    internal_notes: '',
  });

  const nights = nightsBetween(form.check_in_date, form.check_out_date);
  const datesValid = !!form.check_in_date && !!form.check_out_date && form.check_out_date > form.check_in_date;

  // Walk-in defaults to arriving today.
  useEffect(() => {
    if (form.source === 'walk_in' && !form.check_in_date) {
      setForm((f) => ({ ...f, check_in_date: getLocalDateString() }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.source]);

  // Availability check whenever the dates are valid.
  useEffect(() => {
    if (!open || !hotelId || !datesValid) { setRooms([]); return; }
    let alive = true;
    setLoadingRooms(true);
    fetchAvailableRooms(hotelId, form.check_in_date, form.check_out_date)
      .then((data) => { if (alive) setRooms(data); })
      .catch(() => { if (alive) setRooms([]); })
      .finally(() => { if (alive) setLoadingRooms(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, hotelId, form.check_in_date, form.check_out_date]);

  const freeRooms = rooms.filter((r) => !r.has_conflict);

  const handleCreate = async () => {
    if (!hotelId) {
      toast.error(t('pms.err.hotelRequired'));
      return;
    }
    if (!datesValid) {
      toast.error(t('pms.createReservation.checkOutAfterCheckIn'));
      return;
    }
    setSubmitting(true);
    try {
      const result = await createReservation({
        hotelId,
        guestId: form.guest_id || null,
        checkIn: form.check_in_date,
        checkOut: form.check_out_date,
        adults: Math.max(1, Number(form.adults)),
        children: Math.max(0, Number(form.children)),
        roomId: form.room_id === UNASSIGNED ? null : form.room_id,
        roomTypeRequested: form.room_type_requested || null,
        ratePerNight: Number(form.rate_per_night) || 0,
        currency: form.currency,
        source: form.source,
        specialRequests: form.special_requests || null,
        internalNotes: form.internal_notes || null,
        status: 'confirmed',
      });
      toast.success(`${t('pms.createReservation.reservationCreated')} · ${result.reservation_number ?? ''}`);
      setForm({
        guest_id: '', check_in_date: '', check_out_date: '', adults: 1, children: 0,
        room_id: UNASSIGNED, room_type_requested: '', rate_per_night: 0, currency: form.currency,
        source: 'direct', special_requests: '', internal_notes: '',
      });
      onSuccess();
    } catch (err) {
      const key = err instanceof LifecycleError ? err.translationKey : null;
      toast.error(key ? t(key) : t('pms.createReservation.failedToCreate'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto" data-training="res-create-dialog">
        <DialogHeader>
          <DialogTitle>{t('pms.createReservation.newReservation')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <GuestSearchSelect
            value={form.guest_id}
            onChange={(id) => setForm({ ...form, guest_id: id })}
            hotelKeys={hotelKeys}
            hotelId={hotelId}
            orgSlug={orgSlug}
          />

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{t('pms.createReservation.checkInDate')}</Label>
              <Input type="date" value={form.check_in_date} onChange={(e) => setForm({ ...form, check_in_date: e.target.value })} />
            </div>
            <div>
              <Label>{t('pms.createReservation.checkOutDate')}</Label>
              <Input type="date" value={form.check_out_date} onChange={(e) => setForm({ ...form, check_out_date: e.target.value })} />
            </div>
            <div>
              <Label>{t('pms.createReservation.adults')}</Label>
              <Input type="number" min={1} value={form.adults} onChange={(e) => setForm({ ...form, adults: Number(e.target.value) })} />
            </div>
            <div>
              <Label>{t('pms.createReservation.children')}</Label>
              <Input type="number" min={0} value={form.children} onChange={(e) => setForm({ ...form, children: Number(e.target.value) })} />
            </div>
          </div>

          <div>
            <Label>{t('pms.res.room')}</Label>
            <Select
              value={form.room_id}
              onValueChange={(v) => setForm({ ...form, room_id: v })}
              disabled={!datesValid || loadingRooms}
            >
              <SelectTrigger>
                <SelectValue placeholder={datesValid ? undefined : t('pms.res.pickDatesFirst')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNASSIGNED}>{t('pms.res.unassigned')}</SelectItem>
                {freeRooms.map((room) => (
                  <SelectItem key={room.room_id} value={room.room_id}>
                    {room.room_number} {room.room_type ? `(${room.room_type})` : ''} · {room.capacity}P
                    {room.room_status !== 'clean' ? ` · ${t('pms.fd.readyDirty')}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {datesValid && !loadingRooms && (
              <p className="text-[11px] text-muted-foreground mt-1">
                {t('pms.res.freeRoomsForDates')}: {freeRooms.length}
              </p>
            )}
          </div>

          {form.room_id === UNASSIGNED && (
            <div>
              <Label>{t('pms.createReservation.roomType')}</Label>
              <Input placeholder={t('pms.createReservation.roomTypePlaceholder')} value={form.room_type_requested} onChange={(e) => setForm({ ...form, room_type_requested: e.target.value })} />
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>{t('pms.createReservation.ratePerNight')}</Label>
              <Input type="number" min={0} value={form.rate_per_night} onChange={(e) => setForm({ ...form, rate_per_night: Number(e.target.value) })} />
            </div>
            <div>
              <Label>{t('pms.res.currency')}</Label>
              <Select value={form.currency} onValueChange={(v) => setForm({ ...form, currency: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{t('pms.createReservation.source')}</Label>
              <Select value={form.source} onValueChange={(v) => setForm({ ...form, source: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {RESERVATION_SOURCES.map((s) => (
                    <SelectItem key={s} value={s} className="capitalize">{s.replace('_', ' ')}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {nights > 0 && Number(form.rate_per_night) > 0 && (
            <p className="text-xs text-muted-foreground">
              {nights}N × {formatMoney(form.rate_per_night, form.currency)} = <strong>{formatMoney(nights * Number(form.rate_per_night), form.currency)}</strong>
            </p>
          )}

          <div>
            <Label>{t('pms.createReservation.specialRequests')}</Label>
            <Textarea value={form.special_requests} onChange={(e) => setForm({ ...form, special_requests: e.target.value })} placeholder={t('pms.createReservation.guestPreferences')} />
          </div>

          <div>
            <Label>{t('pms.createReservation.internalNotes')}</Label>
            <Textarea value={form.internal_notes} onChange={(e) => setForm({ ...form, internal_notes: e.target.value })} placeholder={t('pms.createReservation.staffNotes')} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button onClick={handleCreate} disabled={submitting || !datesValid}>
            {submitting ? t('pms.createReservation.creating') : t('pms.createReservation.createReservation')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
