import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { setNtakBookingNumber } from '@/lib/pmsLifecycle';
import { useTranslation } from '@/hooks/useTranslation';

const MANAGE_ROLES = new Set(['admin','top_management','top_management_manager','manager']);

export function NtakBookingNumberField({ reservation, onSaved }: {
  reservation: { id: string; hotel_id: string | null; ntak_booking_no?: string | null; organization_slug?: string | null };
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const [enabled, setEnabled] = useState(false);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(reservation.ntak_booking_no ?? '');
  const [saving, setSaving] = useState(false);
  const canManage = !!profile && (
    profile.is_super_admin === true || MANAGE_ROLES.has(String(profile.role))
    || (profile.organization_slug === 'rdhotels' && String(profile.nickname ?? '').toLowerCase() === 'anu_000')
  );
  useEffect(() => { setValue(reservation.ntak_booking_no ?? ''); }, [reservation.id,reservation.ntak_booking_no]);
  useEffect(() => {
    let alive = true;
    setEnabled(false);
    if (!reservation.hotel_id) return;
    (supabase.rpc as CallableFunction)('pms_guest_lifecycle_available', {
      _reservation_id:reservation.id, _room_id:null,
    }).then(({data,error}: {data:boolean;error:unknown}) => { if(alive) setEnabled(!error && data===true); })
      .catch(() => { if(alive) setEnabled(false); });
    return () => { alive=false; };
  },[reservation.hotel_id,reservation.id]);
  if (!enabled || !canManage) return null;
  const save = async () => {
    setSaving(true);
    try {
      await setNtakBookingNumber(reservation.id,value);
      toast.success(t('pms.stayGuest.bookingSaved'));
      setEditing(false);
      onSaved();
    } catch(error) { toast.error(error instanceof Error?error.message:String(error)); }
    finally { setSaving(false); }
  };
  return (
    <div className="space-y-1.5" data-training="ntak-booking-override">
      <Label className="text-xs">{t('pms.stayGuest.bookingNo')}</Label>
      {editing ? <div className="flex gap-2">
        <Input value={value} onChange={(e) => setValue(e.target.value)} maxLength={255}
          className="h-8 font-mono" placeholder="FOGL_01" />
        <Button size="sm" disabled={saving} onClick={() => void save()}>{t('common.save')}</Button>
        <Button size="sm" variant="ghost" disabled={saving} onClick={() => { setEditing(false); setValue(reservation.ntak_booking_no ?? ''); }}>{t('common.cancel')}</Button>
      </div> : <div className="flex gap-2 items-center">
        <span className="text-xs font-mono break-all">{reservation.ntak_booking_no || '—'}</span>
        {canManage && <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
          {t('pms.stayGuest.editBooking')}
        </Button>}
      </div>}
    </div>
  );
}
