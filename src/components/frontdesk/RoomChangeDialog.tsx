import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { BedDouble, Loader2 } from 'lucide-react';
import { BusinessMomentField, useBusinessMoment } from '@/components/frontdesk/BusinessMomentField';
import { budapestToday } from '@/lib/businessMoment';
import { changeRoomReservation, fetchAvailableRooms, type AvailableRoom } from '@/lib/pmsLifecycle';
import { useTranslation } from '@/hooks/useTranslation';

/** Atomic room changes keep the original room's dated stay segment for NTAK. */
export function RoomChangeDialog({ reservation, open, onOpenChange, onSuccess }: {
  reservation: {
    id: string; hotel_id: string; room_id: string | null;
    check_in_date: string; check_out_date: string; reservation_number?: string | null;
  };
  open: boolean; onOpenChange: (open: boolean) => void; onSuccess: () => void;
}) {
  const { t } = useTranslation();
  const [rooms, setRooms] = useState<AvailableRoom[]>([]);
  const [roomId, setRoomId] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const moment = useBusinessMoment(reservation.hotel_id, open);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const from = reservation.check_in_date < budapestToday() ? reservation.check_in_date : budapestToday();
    setRoomId('');
    setLoading(true);
    fetchAvailableRooms(reservation.hotel_id, from, reservation.check_out_date, reservation.id)
      .then((rows) => { if (alive) setRooms(rows); })
      .catch(() => { if (alive) setRooms([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open, reservation.id, reservation.hotel_id, reservation.check_in_date, reservation.check_out_date]);
  const available = useMemo(() => rooms.filter((r) => r.room_id !== reservation.room_id && !r.has_conflict), [rooms, reservation.room_id]);

  const save = async () => {
    if (!roomId || moment.invalid) return;
    setSaving(true);
    try {
      await changeRoomReservation(reservation.id, roomId, moment.occurredAt);
      toast.success(t('pms.businessMoment.changeRoom'));
      onSuccess();
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-training="fd-change-room">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><BedDouble className="h-5 w-5" />{t('pms.businessMoment.changeRoom')}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">{reservation.reservation_number}</p>
          <div className="space-y-1">
            <Label>{t('pms.checkIn.assignRoom')}</Label>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : (
              <Select value={roomId} onValueChange={setRoomId}>
                <SelectTrigger><SelectValue placeholder={t('pms.checkIn.selectCleanRoom')} /></SelectTrigger>
                <SelectContent>
                  {available.map((room) => (
                    <SelectItem key={room.room_id} value={room.room_id}>
                      {room.room_number} · {room.room_type ?? ''} {room.room_status !== 'clean' ? '· ' + room.room_status : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <BusinessMomentField control={moment} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button disabled={saving || moment.invalid || !roomId} onClick={() => void save()}>
            {saving ? t('pms.checkIn.processing') : `${t('pms.businessMoment.changeRoom')} · ${moment.display}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
