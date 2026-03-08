import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { LogIn } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';

interface CheckInDialogProps {
  reservation: any;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function CheckInDialog({ reservation, open, onOpenChange, onSuccess }: CheckInDialogProps) {
  const { profile } = useAuth();
  const { t } = useTranslation();
  const [rooms, setRooms] = useState<any[]>([]);
  const [selectedRoom, setSelectedRoom] = useState<string>(reservation.room_id || '');
  const [submitting, setSubmitting] = useState(false);
  const [roomsFetched, setRoomsFetched] = useState(false);

  if (open && !roomsFetched) {
    supabase
      .from('rooms')
      .select('id, room_number, room_type, status')
      .eq('status', 'clean')
      .order('room_number')
      .then(({ data }) => {
        if (data) setRooms(data);
        setRoomsFetched(true);
      });
  }

  const handleCheckIn = async () => {
    if (!selectedRoom) {
      toast.error(t('pms.checkIn.pleaseSelectRoom'));
      return;
    }
    setSubmitting(true);

    const { error: resError } = await supabase
      .from('reservations')
      .update({
        status: 'checked_in',
        room_id: selectedRoom,
        actual_check_in: new Date().toISOString(),
      })
      .eq('id', reservation.id);

    if (resError) {
      toast.error(t('pms.checkIn.failedCheckIn'));
      setSubmitting(false);
      return;
    }

    await supabase
      .from('rooms')
      .update({ status: 'occupied', updated_at: new Date().toISOString() })
      .eq('id', selectedRoom);

    toast.success(`${reservation.guests?.first_name} ${reservation.guests?.last_name} ${t('pms.checkIn.checkedIn')}`);
    setSubmitting(false);
    onSuccess();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LogIn className="h-5 w-5 text-primary" /> {t('pms.checkIn.checkInGuest')}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="p-3 rounded-lg bg-accent/30 border border-border">
            <p className="font-semibold">{reservation.guests?.first_name} {reservation.guests?.last_name}</p>
            <p className="text-sm text-muted-foreground">{reservation.reservation_number}</p>
            <p className="text-sm text-muted-foreground">
              {reservation.check_in_date} → {reservation.check_out_date} · {reservation.total_nights}N · {reservation.adults}A {reservation.children > 0 ? `${reservation.children}C` : ''}
            </p>
            {reservation.special_requests && (
              <p className="text-sm text-amber-600 mt-1">⚠️ {reservation.special_requests}</p>
            )}
          </div>

          <div>
            <Label>{t('pms.checkIn.assignRoom')}</Label>
            <Select value={selectedRoom} onValueChange={setSelectedRoom}>
              <SelectTrigger>
                <SelectValue placeholder={t('pms.checkIn.selectCleanRoom')} />
              </SelectTrigger>
              <SelectContent>
                {rooms.map((room) => (
                  <SelectItem key={room.id} value={room.id}>
                    Room {room.room_number} {room.room_type ? `(${room.room_type})` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button onClick={handleCheckIn} disabled={submitting} className="gap-1">
            <LogIn className="h-4 w-4" /> {submitting ? t('pms.checkIn.processing') : t('pms.checkIn')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
