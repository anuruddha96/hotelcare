import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useParams } from 'react-router-dom';
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

interface CreateReservationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function CreateReservationDialog({ open, onOpenChange, onSuccess }: CreateReservationDialogProps) {
  const { profile } = useAuth();
  const { organizationSlug } = useParams<{ organizationSlug: string }>();
  const { t } = useTranslation();
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    guest_id: '',
    check_in_date: '',
    check_out_date: '',
    adults: 1,
    children: 0,
    room_type_requested: '',
    rate_per_night: 0,
    source: 'direct',
    special_requests: '',
    internal_notes: '',
  });

  const handleCreate = async () => {
    if (!form.guest_id || !form.check_in_date || !form.check_out_date) {
      toast.error(t('pms.createReservation.guestCheckInOutRequired'));
      return;
    }
    if (form.check_out_date <= form.check_in_date) {
      toast.error(t('pms.createReservation.checkOutAfterCheckIn'));
      return;
    }
    setSubmitting(true);

    const nights = Math.ceil(
      (new Date(form.check_out_date).getTime() - new Date(form.check_in_date).getTime()) / (1000 * 60 * 60 * 24)
    );
    const totalAmount = form.rate_per_night * nights;

    const { error } = await supabase.from('reservations').insert({
      guest_id: form.guest_id,
      check_in_date: form.check_in_date,
      check_out_date: form.check_out_date,
      adults: form.adults,
      children: form.children,
      room_type_requested: form.room_type_requested || null,
      rate_per_night: form.rate_per_night,
      total_amount: totalAmount,
      balance_due: totalAmount,
      source: form.source,
      special_requests: form.special_requests || null,
      internal_notes: form.internal_notes || null,
      status: 'confirmed',
      organization_slug: profile?.organization_slug || organizationSlug,
      hotel_id: profile?.assigned_hotel,
      created_by: profile?.id,
    });

    if (error) {
      toast.error(t('pms.createReservation.failedToCreate'));
      console.error(error);
    } else {
      toast.success(t('pms.createReservation.reservationCreated'));
      onSuccess();
    }
    setSubmitting(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('pms.createReservation.newReservation')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <GuestSearchSelect
            value={form.guest_id}
            onChange={(id) => setForm({ ...form, guest_id: id })}
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
            <div>
              <Label>{t('pms.createReservation.roomType')}</Label>
              <Input placeholder={t('pms.createReservation.roomTypePlaceholder')} value={form.room_type_requested} onChange={(e) => setForm({ ...form, room_type_requested: e.target.value })} />
            </div>
            <div>
              <Label>{t('pms.createReservation.ratePerNight')}</Label>
              <Input type="number" min={0} value={form.rate_per_night} onChange={(e) => setForm({ ...form, rate_per_night: Number(e.target.value) })} />
            </div>
          </div>

          <div>
            <Label>{t('pms.createReservation.source')}</Label>
            <Select value={form.source} onValueChange={(v) => setForm({ ...form, source: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="direct">{t('pms.createReservation.direct')}</SelectItem>
                <SelectItem value="booking_com">Booking.com</SelectItem>
                <SelectItem value="expedia">Expedia</SelectItem>
                <SelectItem value="walk_in">{t('pms.createReservation.walkIn')}</SelectItem>
                <SelectItem value="phone">{t('auth.phoneNumber')}</SelectItem>
                <SelectItem value="email">{t('auth.email')}</SelectItem>
                <SelectItem value="previo">Previo</SelectItem>
              </SelectContent>
            </Select>
          </div>

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
          <Button onClick={handleCreate} disabled={submitting}>
            {submitting ? t('pms.createReservation.creating') : t('pms.createReservation.createReservation')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
