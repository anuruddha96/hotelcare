import { useState, useEffect } from 'react';
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

interface CreateReservationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function CreateReservationDialog({ open, onOpenChange, onSuccess }: CreateReservationDialogProps) {
  const { profile } = useAuth();
  const { organizationSlug } = useParams<{ organizationSlug: string }>();
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
      toast.error('Guest, check-in and check-out dates are required');
      return;
    }
    if (form.check_out_date <= form.check_in_date) {
      toast.error('Check-out must be after check-in');
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
      toast.error('Failed to create reservation');
      console.error(error);
    } else {
      toast.success('Reservation created');
      onSuccess();
    }
    setSubmitting(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Reservation</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <GuestSearchSelect
            value={form.guest_id}
            onChange={(id) => setForm({ ...form, guest_id: id })}
          />

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Check-in Date *</Label>
              <Input type="date" value={form.check_in_date} onChange={(e) => setForm({ ...form, check_in_date: e.target.value })} />
            </div>
            <div>
              <Label>Check-out Date *</Label>
              <Input type="date" value={form.check_out_date} onChange={(e) => setForm({ ...form, check_out_date: e.target.value })} />
            </div>
            <div>
              <Label>Adults</Label>
              <Input type="number" min={1} value={form.adults} onChange={(e) => setForm({ ...form, adults: Number(e.target.value) })} />
            </div>
            <div>
              <Label>Children</Label>
              <Input type="number" min={0} value={form.children} onChange={(e) => setForm({ ...form, children: Number(e.target.value) })} />
            </div>
            <div>
              <Label>Room Type</Label>
              <Input placeholder="e.g. Deluxe Double" value={form.room_type_requested} onChange={(e) => setForm({ ...form, room_type_requested: e.target.value })} />
            </div>
            <div>
              <Label>Rate / Night (HUF)</Label>
              <Input type="number" min={0} value={form.rate_per_night} onChange={(e) => setForm({ ...form, rate_per_night: Number(e.target.value) })} />
            </div>
          </div>

          <div>
            <Label>Source</Label>
            <Select value={form.source} onValueChange={(v) => setForm({ ...form, source: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="direct">Direct</SelectItem>
                <SelectItem value="booking_com">Booking.com</SelectItem>
                <SelectItem value="expedia">Expedia</SelectItem>
                <SelectItem value="walk_in">Walk-in</SelectItem>
                <SelectItem value="phone">Phone</SelectItem>
                <SelectItem value="email">Email</SelectItem>
                <SelectItem value="previo">Previo</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Special Requests</Label>
            <Textarea value={form.special_requests} onChange={(e) => setForm({ ...form, special_requests: e.target.value })} placeholder="Guest preferences, allergies, late check-in..." />
          </div>

          <div>
            <Label>Internal Notes</Label>
            <Textarea value={form.internal_notes} onChange={(e) => setForm({ ...form, internal_notes: e.target.value })} placeholder="Staff-only notes..." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleCreate} disabled={submitting}>
            {submitting ? 'Creating...' : 'Create Reservation'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
