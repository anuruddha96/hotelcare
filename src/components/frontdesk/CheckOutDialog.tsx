import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { LogOut } from 'lucide-react';
import { getLocalDateString } from '@/lib/utils';

interface CheckOutDialogProps {
  reservation: any;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function CheckOutDialog({ reservation, open, onOpenChange, onSuccess }: CheckOutDialogProps) {
  const { profile } = useAuth();
  const [triggerHousekeeping, setTriggerHousekeeping] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const handleCheckOut = async () => {
    setSubmitting(true);

    // Update reservation
    const { error: resError } = await supabase
      .from('reservations')
      .update({
        status: 'checked_out',
        actual_check_out: new Date().toISOString(),
      })
      .eq('id', reservation.id);

    if (resError) {
      toast.error('Failed to check out guest');
      setSubmitting(false);
      return;
    }

    // Mark room as dirty
    if (reservation.room_id) {
      await supabase
        .from('rooms')
        .update({
          status: 'dirty',
          is_checkout_room: true,
          updated_at: new Date().toISOString(),
        })
        .eq('id', reservation.room_id);

      // Create housekeeping assignment for checkout cleaning
      if (triggerHousekeeping && profile) {
        await supabase.from('room_assignments').insert({
          room_id: reservation.room_id,
          assigned_by: profile.id,
          assigned_to: profile.id, // Will be reassigned by housekeeping manager
          assignment_type: 'checkout_cleaning',
          assignment_date: getLocalDateString(),
          status: 'assigned',
          priority: 1,
          notes: `Checkout cleaning for ${reservation.guests?.first_name} ${reservation.guests?.last_name} (${reservation.reservation_number})`,
          organization_slug: profile.organization_slug,
        });
      }
    }

    toast.success(`${reservation.guests?.first_name} ${reservation.guests?.last_name} checked out`);
    setSubmitting(false);
    onSuccess();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LogOut className="h-5 w-5 text-amber-600" /> Check Out Guest
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="p-3 rounded-lg bg-accent/30 border border-border">
            <p className="font-semibold">{reservation.guests?.first_name} {reservation.guests?.last_name}</p>
            <p className="text-sm text-muted-foreground">{reservation.reservation_number}</p>
            <p className="text-sm text-muted-foreground">
              Checked in: {reservation.actual_check_in ? new Date(reservation.actual_check_in).toLocaleDateString() : reservation.check_in_date}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="housekeeping"
              checked={triggerHousekeeping}
              onCheckedChange={(checked) => setTriggerHousekeeping(!!checked)}
            />
            <label htmlFor="housekeeping" className="text-sm">
              Create housekeeping checkout cleaning assignment
            </label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleCheckOut} disabled={submitting} variant="default" className="gap-1">
            <LogOut className="h-4 w-4" /> {submitting ? 'Processing...' : 'Check Out'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
