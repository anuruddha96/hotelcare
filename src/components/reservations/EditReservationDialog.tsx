import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { toast } from 'sonner';
import { useTranslation } from '@/hooks/useTranslation';

interface Props { reservation: any; open: boolean; onOpenChange: (open: boolean) => void; onSuccess: () => void; }

export function EditReservationDialog({ reservation, open, onOpenChange, onSuccess }: Props) {
  const { t } = useTranslation();
  const external = reservation.source === 'previo';
  const [rooms, setRooms] = useState<any[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    check_in_date: reservation.check_in_date,
    check_out_date: reservation.check_out_date,
    adults: reservation.adults || 1,
    children: reservation.children || 0,
    room_id: reservation.room_id || '',
    room_type_requested: reservation.room_type_requested || '',
    rate_per_night: Number(reservation.rate_per_night || reservation.room_rate || 0),
    source: reservation.source || 'direct',
    special_requests: reservation.special_requests || '',
    internal_notes: reservation.internal_notes || '',
  });

  useEffect(() => {
    if (!open || !reservation.hotel_id || !form.check_in_date || !form.check_out_date) return;
    (supabase as any).rpc('pms_available_rooms', { _hotel_id: reservation.hotel_id, _from: form.check_in_date, _to: form.check_out_date, _exclude_reservation: reservation.id })
      .then(({ data }: any) => setRooms((data || []).filter((r: any) => !r.has_conflict)));
  }, [open, reservation.hotel_id, reservation.id, form.check_in_date, form.check_out_date]);

  const save = async () => {
    if (form.check_out_date <= form.check_in_date) { toast.error(t('pms.createReservation.checkOutAfterCheckIn')); return; }
    setSubmitting(true);
    const { error } = await (supabase as any).rpc('pms_update_reservation', {
      _reservation_id: reservation.id,
      _check_in: external ? reservation.check_in_date : form.check_in_date,
      _check_out: external ? reservation.check_out_date : form.check_out_date,
      _adults: external ? reservation.adults : form.adults,
      _children: external ? reservation.children : form.children,
      _room_id: external ? reservation.room_id : (form.room_id || null),
      _clear_room: !external && !form.room_id,
      _rate_per_night: external ? Number(reservation.rate_per_night || reservation.room_rate || 0) : form.rate_per_night,
      _source: reservation.source,
      _room_type_requested: external ? reservation.room_type_requested : (form.room_type_requested || null),
      _special_requests: form.special_requests || null,
      _internal_notes: form.internal_notes || null,
    });
    setSubmitting(false);
    if (error) { toast.error(error.message || t('pms.reservationDetail.failedToUpdate')); return; }
    toast.success(t('common.success')); onOpenChange(false); onSuccess();
  };

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
    <DialogHeader><DialogTitle>{t('common.edit')} · {reservation.reservation_number}</DialogTitle></DialogHeader>
    <div className="space-y-4">
      {external && <Alert><AlertDescription>Previo · {reservation.source_reservation_id || reservation.reservation_number}. PMS is authoritative for dates, room, pax and rate; HotelCare notes remain editable.</AlertDescription></Alert>}
      <div className="grid grid-cols-2 gap-3"><div><Label>{t('pms.createReservation.checkInDate')}</Label><Input disabled={external} type="date" value={form.check_in_date} onChange={(e) => setForm({ ...form, check_in_date: e.target.value })} /></div><div><Label>{t('pms.createReservation.checkOutDate')}</Label><Input disabled={external} type="date" value={form.check_out_date} onChange={(e) => setForm({ ...form, check_out_date: e.target.value })} /></div><div><Label>{t('pms.createReservation.adults')}</Label><Input disabled={external} type="number" min={1} value={form.adults} onChange={(e) => setForm({ ...form, adults: Number(e.target.value) })} /></div><div><Label>{t('pms.createReservation.children')}</Label><Input disabled={external} type="number" min={0} value={form.children} onChange={(e) => setForm({ ...form, children: Number(e.target.value) })} /></div></div>
      <div><Label>{t('pms.checkIn.assignRoom')}</Label><Select disabled={external} value={form.room_id || 'unassigned'} onValueChange={(v) => setForm({ ...form, room_id: v === 'unassigned' ? '' : v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="unassigned">{t('pms.reservationDetail.notSpecified')}</SelectItem>{rooms.map((r) => <SelectItem key={r.room_id} value={r.room_id}>{t('common.room')} {r.room_number}{r.room_type ? ` · ${r.room_type}` : ''}</SelectItem>)}</SelectContent></Select></div>
      <div><Label>{t('pms.createReservation.ratePerNight')}</Label><Input disabled={external} type="number" value={form.rate_per_night} onChange={(e) => setForm({ ...form, rate_per_night: Number(e.target.value) })} /></div>
      <div><Label>{t('pms.createReservation.specialRequests')}</Label><Textarea value={form.special_requests} onChange={(e) => setForm({ ...form, special_requests: e.target.value })} /></div>
      <div><Label>{t('pms.createReservation.internalNotes')}</Label><Textarea value={form.internal_notes} onChange={(e) => setForm({ ...form, internal_notes: e.target.value })} /></div>
    </div>
    <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button><Button onClick={save} disabled={submitting}>{submitting ? t('common.updating') : t('common.save')}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
