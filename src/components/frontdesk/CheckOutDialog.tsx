import { useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { toast } from 'sonner';
import { AlertTriangle, LogOut } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';

interface CheckOutDialogProps {
  reservation: any;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function CheckOutDialog({ reservation, open, onOpenChange, onSuccess }: CheckOutDialogProps) {
  const { t } = useTranslation();
  const [submitting, setSubmitting] = useState(false);
  const [balanceOverride, setBalanceOverride] = useState(false);
  const balance = Number(reservation.balance_due || 0);

  const guestLabel = useMemo(() => {
    const named = `${reservation.guests?.first_name || ''} ${reservation.guests?.last_name || ''}`.trim();
    if (named) return named;
    return reservation.source === 'previo'
      ? `Previo · ${reservation.source_reservation_id || reservation.reservation_number}`
      : reservation.reservation_number;
  }, [reservation]);

  const handleCheckOut = async () => {
    if (balance > 0 && !balanceOverride) {
      toast.error(`${t('pms.reservationDetail.balance')}: ${balance.toLocaleString()} ${reservation.currency || 'HUF'}`);
      return;
    }
    setSubmitting(true);
    const { error } = await (supabase as any).rpc('pms_check_out', {
      p_reservation_id: reservation.id,
      p_allow_balance_override: balanceOverride,
    });
    setSubmitting(false);
    if (error) {
      toast.error(error.message || t('pms.checkOut.failedCheckOut'));
      return;
    }
    toast.success(`${guestLabel} ${t('pms.checkOut.checkedOut')}`);
    onSuccess();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-training="reception-checkout-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LogOut className="h-5 w-5 text-amber-600" /> {t('pms.checkOut.checkOutGuest')}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="p-3 rounded-lg bg-accent/30 border border-border">
            <p className="font-semibold">{guestLabel}</p>
            <p className="text-sm text-muted-foreground">{reservation.reservation_number}</p>
            <p className="text-sm text-muted-foreground">
              {t('pms.checkOut.checkedInDate')}: {reservation.actual_check_in ? new Date(reservation.actual_check_in).toLocaleDateString() : reservation.check_in_date}
            </p>
            <div className="mt-2 flex justify-between text-sm">
              <span>{t('pms.reservationDetail.total')}</span>
              <span>{Number(reservation.total_amount || 0).toLocaleString()} {reservation.currency || 'HUF'}</span>
            </div>
            <div className="flex justify-between text-sm font-semibold">
              <span>{t('pms.reservationDetail.balance')}</span>
              <span>{balance.toLocaleString()} {reservation.currency || 'HUF'}</span>
            </div>
          </div>

          {balance > 0 && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <div className="flex items-start gap-2">
                  <Checkbox
                    id="balance-override"
                    checked={balanceOverride}
                    onCheckedChange={(checked) => setBalanceOverride(!!checked)}
                  />
                  <label htmlFor="balance-override" className="text-sm leading-snug">
                    {t('pms.reservationDetail.balance')}: {balance.toLocaleString()} {reservation.currency || 'HUF'} · {t('pms.checkOut.checkOutGuest')}
                  </label>
                </div>
              </AlertDescription>
            </Alert>
          )}

          <p className="text-xs text-muted-foreground">
            {t('pms.checkOut.createHousekeepingAssignment')}: {t('pms.reservations.checkedOut')}. {t('rooms.dirty')}.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button data-training="reception-checkout-confirm" onClick={handleCheckOut} disabled={submitting || (balance > 0 && !balanceOverride)} className="gap-1">
            <LogOut className="h-4 w-4" /> {submitting ? t('pms.checkIn.processing') : t('pms.checkOut')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
