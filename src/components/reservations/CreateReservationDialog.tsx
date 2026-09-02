import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { useTranslation } from '@/hooks/useTranslation';

interface CreateReservationDialogProps { open: boolean; onOpenChange: (open: boolean) => void; onSuccess: () => void; hotelId: string; }

export function CreateReservationDialog({ open, onOpenChange, onSuccess, hotelId }: CreateReservationDialogProps) {
  const { profile } = useAuth();
  const { t } = useTranslation();
  const [submitting, setSubmitting] = useState(false);
  const [guests, setGuests] = useState<any[]>([]);
  const [rooms, setRooms] = useState<any[]>([]);
  const [guestMode, setGuestMode] = useState<'existing' | 'new'>('existing');
  const [newGuest, setNewGuest] = useState({ first_name: '', last_name: '', email: '', phone: '' });
  const [form, setForm] = useState({ guest_id: '', check_in_date: '', check_out_date: '', adults: 1, children: 0, room_id: '', room_type_requested: '', rate_per_night: 0, currency: 'HUF', source: 'direct', special_requests: '', internal_notes: '' });

  useEffect(() => {
    if (!open || !hotelId) return;
    (supabase as any).from('guests').select('id, first_name, last_name, email, phone').eq('hotel_id', hotelId).order('last_name').limit(500)
      .then(({ data }: any) => setGuests(data || []));
  }, [open, hotelId]);

  useEffect(() => {
    if (!open || !hotelId || !form.check_in_date || !form.check_out_date || form.check_out_date <= form.check_in_date) { setRooms([]); return; }
    (supabase as any).rpc('pms_available_rooms', { _hotel_id: hotelId, _from: form.check_in_date, _to: form.check_out_date, _exclude_reservation: null })
      .then(({ data, error }: any) => {
        if (error) { setRooms([]); return; }
        setRooms((data || []).filter((r: any) => !r.has_conflict));
      });
  }, [open, hotelId, form.check_in_date, form.check_out_date]);

  const nights = useMemo(() => {
    if (!form.check_in_date || !form.check_out_date) return 0;
    return Math.max(0, Math.round((new Date(`${form.check_out_date}T00:00:00`).getTime() - new Date(`${form.check_in_date}T00:00:00`).getTime()) / 86400000));
  }, [form.check_in_date, form.check_out_date]);

  const handleCreate = async () => {
    if (!form.check_in_date || !form.check_out_date || form.check_out_date <= form.check_in_date) { toast.error(t('pms.createReservation.checkOutAfterCheckIn')); return; }
    setSubmitting(true);
    let guestId = form.guest_id || null;
    if (guestMode === 'new') {
      if (!newGuest.first_name.trim() || !newGuest.last_name.trim()) { toast.error(t('pms.guests.firstLastRequired')); setSubmitting(false); return; }
      const { data, error } = await (supabase as any).from('guests').insert({
        hotel_id: hotelId,
        organization_slug: profile?.organization_slug,
        first_name: newGuest.first_name.trim(),
        last_name: newGuest.last_name.trim(),
        email: newGuest.email.trim() || null,
        phone: newGuest.phone.trim() || null,
      }).select('id').single();
      if (error) { toast.error(error.message || t('pms.guests.failedToCreate')); setSubmitting(false); return; }
      guestId = data.id;
    }
    if (!guestId) { toast.error(t('pms.createReservation.guestCheckInOutRequired')); setSubmitting(false); return; }

    const { error } = await (supabase as any).rpc('pms_create_reservation', {
      _hotel_id: hotelId,
      _guest_id: guestId,
      _check_in: form.check_in_date,
      _check_out: form.check_out_date,
      _adults: form.adults,
      _children: form.children,
      _room_id: form.room_id || null,
      _room_type_requested: form.room_type_requested.trim() || null,
      _rate_per_night: form.rate_per_night,
      _currency: form.currency,
      _source: form.source,
      _special_requests: form.special_requests.trim() || null,
      _internal_notes: form.internal_notes.trim() || null,
      _status: 'confirmed',
    });
    setSubmitting(false);
    if (error) { toast.error(error.message || t('pms.createReservation.failedToCreate')); return; }
    toast.success(t('pms.createReservation.reservationCreated'));
    onOpenChange(false);
    onSuccess();
  };

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="sm:max-w-xl max-h-[92vh] overflow-y-auto" data-training="pms-new-reservation-dialog">
      <DialogHeader><DialogTitle>{t('pms.createReservation.newReservation')}</DialogTitle></DialogHeader>
      <div className="space-y-4">
        <Tabs value={guestMode} onValueChange={(v) => setGuestMode(v as any)}>
          <TabsList className="grid grid-cols-2"><TabsTrigger value="existing">{t('pms.guests.guestLabel')}</TabsTrigger><TabsTrigger value="new">{t('pms.guests.addNewGuest')}</TabsTrigger></TabsList>
          <TabsContent value="existing"><Label>{t('pms.guests.guestLabel')}</Label><Select value={form.guest_id} onValueChange={(v) => setForm({ ...form, guest_id: v })}><SelectTrigger><SelectValue placeholder={t('pms.guests.searchGuestPlaceholder')} /></SelectTrigger><SelectContent>{guests.map((g) => <SelectItem key={g.id} value={g.id}>{g.first_name} {g.last_name}{g.email ? ` · ${g.email}` : ''}</SelectItem>)}</SelectContent></Select></TabsContent>
          <TabsContent value="new" className="grid grid-cols-2 gap-2"><div><Label>{t('pms.guests.firstName')}</Label><Input value={newGuest.first_name} onChange={(e) => setNewGuest({ ...newGuest, first_name: e.target.value })} /></div><div><Label>{t('pms.guests.lastName')}</Label><Input value={newGuest.last_name} onChange={(e) => setNewGuest({ ...newGuest, last_name: e.target.value })} /></div><div><Label>{t('auth.email')}</Label><Input type="email" value={newGuest.email} onChange={(e) => setNewGuest({ ...newGuest, email: e.target.value })} /></div><div><Label>{t('auth.phoneNumber')}</Label><Input value={newGuest.phone} onChange={(e) => setNewGuest({ ...newGuest, phone: e.target.value })} /></div></TabsContent>
        </Tabs>

        <div className="grid grid-cols-2 gap-3">
          <div><Label>{t('pms.createReservation.checkInDate')}</Label><Input type="date" value={form.check_in_date} onChange={(e) => setForm({ ...form, check_in_date: e.target.value, room_id: '' })} /></div>
          <div><Label>{t('pms.createReservation.checkOutDate')}</Label><Input type="date" value={form.check_out_date} onChange={(e) => setForm({ ...form, check_out_date: e.target.value, room_id: '' })} /></div>
          <div><Label>{t('pms.createReservation.adults')}</Label><Input type="number" min={1} value={form.adults} onChange={(e) => setForm({ ...form, adults: Math.max(1, Number(e.target.value)) })} /></div>
          <div><Label>{t('pms.createReservation.children')}</Label><Input type="number" min={0} value={form.children} onChange={(e) => setForm({ ...form, children: Math.max(0, Number(e.target.value)) })} /></div>
        </div>

        <div><Label>{t('pms.checkIn.assignRoom')}</Label><Select value={form.room_id || 'unassigned'} onValueChange={(v) => setForm({ ...form, room_id: v === 'unassigned' ? '' : v })}><SelectTrigger><SelectValue placeholder={t('pms.reservationDetail.notSpecified')} /></SelectTrigger><SelectContent><SelectItem value="unassigned">{t('pms.reservationDetail.notSpecified')}</SelectItem>{rooms.map((r) => <SelectItem key={r.room_id} value={r.room_id}>{t('common.room')} {r.room_number}{r.room_type ? ` · ${r.room_type}` : ''}{r.capacity ? ` · ${r.capacity} pax` : ''}</SelectItem>)}</SelectContent></Select></div>
        <div><Label>{t('pms.createReservation.roomType')}</Label><Input value={form.room_type_requested} onChange={(e) => setForm({ ...form, room_type_requested: e.target.value })} placeholder={t('pms.createReservation.roomTypePlaceholder')} /></div>
        <div className="grid grid-cols-2 gap-3"><div><Label>{t('pms.createReservation.ratePerNight')}</Label><Input type="number" min={0} value={form.rate_per_night} onChange={(e) => setForm({ ...form, rate_per_night: Math.max(0, Number(e.target.value)) })} /></div><div><Label>{t('pms.createReservation.source')}</Label><Select value={form.source} onValueChange={(v) => setForm({ ...form, source: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="direct">{t('pms.createReservation.direct')}</SelectItem><SelectItem value="walk_in">{t('pms.createReservation.walkIn')}</SelectItem><SelectItem value="phone">{t('auth.phoneNumber')}</SelectItem><SelectItem value="email">{t('auth.email')}</SelectItem></SelectContent></Select></div></div>
        {nights > 0 && <div className="rounded-lg bg-muted/40 p-3 text-sm flex justify-between"><span>{nights} {t('pms.reservations.nights')}</span><span className="font-semibold">{(nights * form.rate_per_night).toLocaleString()} {form.currency}</span></div>}
        <div><Label>{t('pms.createReservation.specialRequests')}</Label><Textarea value={form.special_requests} onChange={(e) => setForm({ ...form, special_requests: e.target.value })} placeholder={t('pms.createReservation.guestPreferences')} /></div>
        <div><Label>{t('pms.createReservation.internalNotes')}</Label><Textarea value={form.internal_notes} onChange={(e) => setForm({ ...form, internal_notes: e.target.value })} placeholder={t('pms.createReservation.staffNotes')} /></div>
      </div>
      <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button><Button data-training="pms-create-reservation-confirm" onClick={handleCreate} disabled={submitting}>{submitting ? t('pms.createReservation.creating') : t('pms.createReservation.createReservation')}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
