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
import { Lock, Pencil } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { fetchAvailableRooms, updateReservation, LifecycleError, type AvailableRoom } from '@/lib/pmsLifecycle';
import { isPmsManaged, RESERVATION_SOURCES } from '@/lib/reservations';

const UNASSIGNED = '__none__';

interface EditReservationDialogProps {
  reservation: any;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function EditReservationDialog({ reservation, open, onOpenChange, onSuccess }: EditReservationDialogProps) {
  const { t } = useTranslation();
  const pmsManaged = isPmsManaged(reservation);
  const checkedIn = reservation.status === 'checked_in';
  const [submitting, setSubmitting] = useState(false);
  const [rooms, setRooms] = useState<AvailableRoom[]>([]);
  const [form, setForm] = useState({
    check_in_date: reservation.check_in_date ?? '',
    check_out_date: reservation.check_out_date ?? '',
    adults: reservation.adults ?? 1,
    children: reservation.children ?? 0,
    room_id: reservation.room_id ?? UNASSIGNED,
    rate_per_night: Number(reservation.rate_per_night ?? 0),
    source: reservation.source ?? 'direct',
    room_type_requested: reservation.room_type_requested ?? '',
    special_requests: reservation.special_requests ?? '',
    internal_notes: reservation.internal_notes ?? '',
  });

  useEffect(() => {
    if (!open) return;
    setForm({
      check_in_date: reservation.check_in_date ?? '',
      check_out_date: reservation.check_out_date ?? '',
      adults: reservation.adults ?? 1,
      children: reservation.children ?? 0,
      room_id: reservation.room_id ?? UNASSIGNED,
      rate_per_night: Number(reservation.rate_per_night ?? 0),
      source: reservation.source ?? 'direct',
      room_type_requested: reservation.room_type_requested ?? '',
      special_requests: reservation.special_requests ?? '',
      internal_notes: reservation.internal_notes ?? '',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reservation.id]);

  useEffect(() => {
    if (!open || pmsManaged || checkedIn) return;
    if (!reservation.hotel_id || !form.check_in_date || !form.check_out_date) return;
    if (form.check_out_date <= form.check_in_date) return;
    let alive = true;
    fetchAvailableRooms(reservation.hotel_id, form.check_in_date, form.check_out_date, reservation.id)
      .then((data) => { if (alive) setRooms(data); })
      .catch(() => { if (alive) setRooms([]); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, form.check_in_date, form.check_out_date]);

  const submit = async () => {
    if (!pmsManaged) {
      if (!form.check_in_date || !form.check_out_date || form.check_out_date <= form.check_in_date) {
        toast.error(t('pms.err.invalidDates'));
        return;
      }
    }
    setSubmitting(true);
    try {
      await updateReservation({
        reservationId: reservation.id,
        checkIn: pmsManaged ? null : form.check_in_date,
        checkOut: pmsManaged ? null : form.check_out_date,
        adults: pmsManaged ? null : Number(form.adults),
        children: pmsManaged ? null : Number(form.children),
        roomId: pmsManaged || checkedIn || form.room_id === UNASSIGNED ? null : form.room_id,
        clearRoom: !pmsManaged && !checkedIn && form.room_id === UNASSIGNED && !!reservation.room_id,
        ratePerNight: pmsManaged ? null : Number(form.rate_per_night),
        source: pmsManaged ? null : form.source,
        roomTypeRequested: pmsManaged ? null : (form.room_type_requested || null),
        specialRequests: form.special_requests || null,
        internalNotes: form.internal_notes || null,
      });
      toast.success(t('pms.res.updatedOk'));
      onSuccess();
      onOpenChange(false);
    } catch (err) {
      const key = err instanceof LifecycleError ? err.translationKey : null;
      toast.error(key ? t(key) : (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto" data-training="res-edit-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-5 w-5 text-primary" /> {t('pms.res.editTitle')} · {reservation.reservation_number}
          </DialogTitle>
        </DialogHeader>

        {pmsManaged && (
          <div className="flex items-start gap-2 rounded-md border border-border bg-accent/30 p-2.5 text-xs text-muted-foreground">
            <Lock className="h-4 w-4 mt-0.5 shrink-0" />
            {t('pms.res.pmsManagedHint')}
          </div>
        )}

        <div className="space-y-4">
          {!pmsManaged && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>{t('pms.createReservation.checkInDate')}</Label>
                  <Input type="date" value={form.check_in_date} disabled={checkedIn} onChange={(e) => setForm({ ...form, check_in_date: e.target.value })} />
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

              {!checkedIn && (
                <div>
                  <Label>{t('pms.res.room')}</Label>
                  <Select value={form.room_id} onValueChange={(v) => setForm({ ...form, room_id: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={UNASSIGNED}>{t('pms.res.unassigned')}</SelectItem>
                      {rooms.map((room) => (
                        <SelectItem key={room.room_id} value={room.room_id} disabled={room.has_conflict && room.room_id !== reservation.room_id}>
                          {room.room_number} {room.room_type ? `(${room.room_type})` : ''}
                          {room.has_conflict && room.room_id !== reservation.room_id ? ` · ${t('pms.ci.conflict')}` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>{t('pms.res.ratePerNight')} ({reservation.currency})</Label>
                  <Input type="number" min={0} value={form.rate_per_night} onChange={(e) => setForm({ ...form, rate_per_night: Number(e.target.value) })} />
                </div>
                <div>
                  <Label>{t('pms.res.source')}</Label>
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

              <div>
                <Label>{t('pms.res.roomTypeRequested')}</Label>
                <Input value={form.room_type_requested} onChange={(e) => setForm({ ...form, room_type_requested: e.target.value })} />
              </div>
            </>
          )}

          <div>
            <Label>{t('pms.res.specialRequests')}</Label>
            <Textarea value={form.special_requests} onChange={(e) => setForm({ ...form, special_requests: e.target.value })} />
          </div>
          <div>
            <Label>{t('pms.res.internalNotes')}</Label>
            <Textarea value={form.internal_notes} onChange={(e) => setForm({ ...form, internal_notes: e.target.value })} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? t('pms.checkIn.processing') : t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
