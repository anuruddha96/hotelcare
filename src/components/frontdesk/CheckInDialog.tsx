import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { toast } from 'sonner';
import { AlertTriangle, LogIn } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';

interface CheckInDialogProps { reservation: any; hotelId?: string | null; open: boolean; onOpenChange: (open: boolean) => void; onSuccess: () => void; }

export function CheckInDialog({ reservation, hotelId, open, onOpenChange, onSuccess }: CheckInDialogProps) {
  const { t } = useTranslation();
  const [rooms, setRooms] = useState<any[]>([]);
  const [selectedRoom, setSelectedRoom] = useState<string>(reservation.room_id || '');
  const [submitting, setSubmitting] = useState(false);
  const [loadingRooms, setLoadingRooms] = useState(false);
  const effectiveHotelId = hotelId || reservation.hotel_id;
  const guestLabel = useMemo(() => {
    const named = `${reservation.guests?.first_name || ''} ${reservation.guests?.last_name || ''}`.trim();
    return named || (reservation.source === 'previo' ? `Previo · ${reservation.source_reservation_id || reservation.reservation_number}` : reservation.reservation_number);
  }, [reservation]);

  useEffect(() => {
    if (!open || !effectiveHotelId) return;
    let cancelled = false;
    setLoadingRooms(true);
    (supabase as any).rpc('pms_available_rooms', {
      _hotel_id: effectiveHotelId,
      _from: reservation.check_in_date,
      _to: reservation.check_out_date,
      _exclude_reservation: reservation.id,
    }).then(({ data, error }: any) => {
      if (cancelled) return;
      if (error) { toast.error(error.message || t('pms.checkIn.failedCheckIn')); setRooms([]); }
      else {
        const available = (Array.isArray(data) ? data : []).filter((r: any) => !r.has_conflict && String(r.room_status || '').toLowerCase() === 'clean');
        setRooms(available);
        if (reservation.room_id && available.some((r: any) => r.room_id === reservation.room_id)) setSelectedRoom(reservation.room_id);
      }
      setLoadingRooms(false);
    });
    return () => { cancelled = true; };
  }, [open, effectiveHotelId, reservation.id, reservation.room_id, reservation.check_in_date, reservation.check_out_date, t]);

  const handleCheckIn = async () => {
    if (!selectedRoom) { toast.error(t('pms.checkIn.pleaseSelectRoom')); return; }
    setSubmitting(true);
    const { error } = await (supabase as any).rpc('pms_check_in_reservation', { _reservation_id: reservation.id, _room_id: selectedRoom, _override: false });
    setSubmitting(false);
    if (error) { toast.error(error.message || t('pms.checkIn.failedCheckIn')); return; }
    toast.success(`${guestLabel} ${t('pms.checkIn.checkedIn')}`); onSuccess();
  };

  const missingContact = !reservation.guests?.email && !reservation.guests?.phone;
  const missingDocument = reservation.guests && !reservation.guests?.id_document_number;
  const balance = Number(reservation.balance_due || 0);
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="sm:max-w-md" data-training="reception-check-in-dialog">
      <DialogHeader><DialogTitle className="flex items-center gap-2"><LogIn className="h-5 w-5 text-primary" />{t('pms.checkIn.checkInGuest')}</DialogTitle></DialogHeader>
      <div className="space-y-4">
        <div className="p-3 rounded-lg bg-accent/30 border border-border"><p className="font-semibold">{guestLabel}</p><p className="text-sm text-muted-foreground">{reservation.reservation_number}</p><p className="text-sm text-muted-foreground">{reservation.check_in_date} → {reservation.check_out_date} · {reservation.total_nights}N · {reservation.adults}A {reservation.children > 0 ? `${reservation.children}C` : ''}</p>{reservation.special_requests && <p className="text-sm text-amber-600 mt-1">⚠️ {reservation.special_requests}</p>}</div>
        {(missingContact || missingDocument || balance > 0) && <Alert><AlertTriangle className="h-4 w-4" /><AlertDescription className="space-y-1 text-xs">{missingContact && <div>{t('pms.guests.noEmail')} / {t('pms.guests.noPhone')}</div>}{missingDocument && <div>{t('pms.guestDetail.idDocument')}: {t('pms.reservationDetail.notSpecified')}</div>}{balance > 0 && <div>{t('pms.reservationDetail.balance')}: {balance.toLocaleString()} {reservation.currency || 'HUF'}</div>}</AlertDescription></Alert>}
        <div><Label>{t('pms.checkIn.assignRoom')}</Label><Select value={selectedRoom} onValueChange={setSelectedRoom} disabled={loadingRooms}><SelectTrigger data-training="reception-check-in-room"><SelectValue placeholder={loadingRooms ? t('pms.loading') : t('pms.checkIn.selectCleanRoom')} /></SelectTrigger><SelectContent>{rooms.map((room) => <SelectItem key={room.room_id} value={room.room_id}>{t('common.room')} {room.room_number}{room.room_type ? ` · ${room.room_type}` : ''}{room.capacity ? ` · ${room.capacity} pax` : ''}</SelectItem>)}</SelectContent></Select></div>
      </div>
      <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button><Button data-training="reception-check-in-confirm" onClick={handleCheckIn} disabled={submitting || loadingRooms} className="gap-1"><LogIn className="h-4 w-4" />{submitting ? t('pms.checkIn.processing') : t('pms.checkIn')}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
