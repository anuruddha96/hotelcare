import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { LogOut, AlertCircle, BedDouble, FileText, Loader2, Wallet } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { addFolioItem, checkOutReservation, LifecycleError } from '@/lib/pmsLifecycle';
import { formatMoney, reservationGuestLabel } from '@/lib/reservations';
import { InvoiceDialog } from '@/components/frontdesk/InvoiceDialog';

interface CheckOutDialogProps {
  reservation: any;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function CheckOutDialog({ reservation, open, onOpenChange, onSuccess }: CheckOutDialogProps) {
  const { t } = useTranslation();
  const [ackBalance, setAckBalance] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [balance, setBalance] = useState<number>(Number(reservation.balance_due ?? 0));
  const [folioTotal, setFolioTotal] = useState<number | null>(null);
  const [roomNumber, setRoomNumber] = useState<string | null>(
    reservation.rooms?.room_number ?? null,
  );
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('card');
  const [payBusy, setPayBusy] = useState(false);
  const [invoiceOpen, setInvoiceOpen] = useState(false);

  const payMethods: Array<{ value: string; key: string }> = [
    { value: 'card', key: 'pms.pay.card' },
    { value: 'cash', key: 'pms.pay.cash' },
    { value: 'transfer', key: 'pms.pay.transfer' },
    { value: 'szep_card', key: 'pms.pay.szep' },
  ];

  const refreshBalance = async () => {
    const { data: fresh } = await supabase.from('reservations')
      .select('balance_due').eq('id', reservation.id).maybeSingle();
    if (fresh) setBalance(Number(fresh.balance_due ?? 0));
  };

  const recordPayment = async () => {
    const amount = Number(payAmount);
    if (!Number.isFinite(amount) || amount <= 0) return;
    setPayBusy(true);
    try {
      const methodLabel = payMethods.find((m) => m.value === payMethod);
      const result = await addFolioItem(
        reservation.id,
        `${t('pms.pay.recordPayment')} · ${methodLabel ? t(methodLabel.key) : payMethod}`,
        amount,
        'payment',
      );
      setBalance(Number(result.balance_due ?? 0));
      setPayAmount('');
      toast.success(t('pms.pay.recorded'));
    } catch (err) {
      const key = err instanceof LifecycleError ? err.translationKey : null;
      toast.error(key ? t(key) : t('pms.pay.recordPayment'));
    } finally {
      setPayBusy(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setAckBalance(false);
    // Fresh balance + folio total + room number so the receptionist confirms real numbers.
    (async () => {
      const [{ data: fresh }, { data: folio }] = await Promise.all([
        supabase.from('reservations').select('balance_due, total_amount, room_id').eq('id', reservation.id).maybeSingle(),
        supabase.from('guest_folios').select('amount, charge_type').eq('reservation_id', reservation.id),
      ]);
      if (!alive) return;
      if (fresh) setBalance(Number(fresh.balance_due ?? 0));
      if (folio) {
        const charges = folio.filter((f: any) => f.charge_type !== 'payment')
          .reduce((s: number, f: any) => s + Number(f.amount ?? 0), 0);
        setFolioTotal(charges);
      }
      const roomId = fresh?.room_id ?? reservation.room_id;
      if (roomId && !reservation.rooms?.room_number) {
        const { data: room } = await supabase.from('rooms').select('room_number').eq('id', roomId).maybeSingle();
        if (alive && room) setRoomNumber(room.room_number);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reservation.id]);

  const handleCheckOut = async () => {
    setSubmitting(true);
    try {
      await checkOutReservation(reservation.id, ackBalance);
      toast.success(`${reservationGuestLabel(reservation)} ${t('pms.checkOut.checkedOut')}`);
      onSuccess();
    } catch (err) {
      const key = err instanceof LifecycleError ? err.translationKey : null;
      toast.error(key ? t(key) : t('pms.checkOut.failedCheckOut'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-training="fd-checkout-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LogOut className="h-5 w-5 text-amber-600" /> {t('pms.checkOut.checkOutGuest')}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="p-3 rounded-lg bg-accent/30 border border-border space-y-0.5">
            <p className="font-semibold">{reservationGuestLabel(reservation)}</p>
            <p className="text-sm text-muted-foreground">{reservation.reservation_number}</p>
            <p className="text-sm text-muted-foreground">
              {reservation.check_in_date} → {reservation.check_out_date}
              {roomNumber ? ` · ${t('pms.res.room')} ${roomNumber}` : ''}
            </p>
            <p className="text-sm text-muted-foreground">
              {t('pms.checkOut.checkedInDate')}: {reservation.actual_check_in ? new Date(reservation.actual_check_in).toLocaleDateString() : reservation.check_in_date}
            </p>
          </div>

          <div className="p-3 rounded-lg border border-border text-sm space-y-1">
            {folioTotal !== null && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('pms.co.folioTotal')}</span>
                <span className="font-medium">{formatMoney(folioTotal || reservation.total_amount, reservation.currency)}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('pms.co.balanceDue')}</span>
              <span className={`font-semibold ${balance > 0 ? 'text-amber-600' : 'text-green-600'}`}>
                {formatMoney(balance, reservation.currency)}
              </span>
            </div>
          </div>

          {balance > 0 && (
            <div className="rounded-md border border-border p-2.5 space-y-1.5" data-training="fd-checkout-payment">
              <p className="text-xs font-medium flex items-center gap-1.5"><Wallet className="h-3.5 w-3.5" /> {t('pms.pay.recordPayment')}</p>
              <div className="flex gap-1.5">
                <Input className="h-8" type="number" min={0} step="any" value={payAmount}
                  placeholder={String(balance)} onChange={(e) => setPayAmount(e.target.value)} />
                <Select value={payMethod} onValueChange={setPayMethod}>
                  <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>{payMethods.map((m) => <SelectItem key={m.value} value={m.value}>{t(m.key)}</SelectItem>)}</SelectContent>
                </Select>
                <Button type="button" size="sm" variant="outline" className="h-8 shrink-0"
                  disabled={payBusy || !(Number(payAmount) > 0)} onClick={recordPayment}>
                  {payBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'OK'}
                </Button>
              </div>
              <button type="button" className="text-xs text-muted-foreground underline"
                onClick={() => setPayAmount(String(balance))}>
                {formatMoney(balance, reservation.currency)}
              </button>
            </div>
          )}

          {balance > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-amber-300/50 bg-amber-500/10 p-2.5">
              <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
              <div className="space-y-1.5">
                <p className="text-xs text-amber-700 dark:text-amber-400">{t('pms.co.balanceWarning')}</p>
                <div className="flex items-center gap-2">
                  <Checkbox id="ack-balance" checked={ackBalance} onCheckedChange={(c) => setAckBalance(!!c)} />
                  <label htmlFor="ack-balance" className="text-xs font-medium">
                    {t('pms.co.ackBalance')}
                  </label>
                </div>
              </div>
            </div>
          )}

          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <BedDouble className="h-3.5 w-3.5 shrink-0" /> {t('pms.co.roomWillBeDirty')}
          </p>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" className="gap-1.5 sm:mr-auto" onClick={() => setInvoiceOpen(true)} data-training="fd-checkout-invoice">
            <FileText className="h-4 w-4" /> {t('pms.inv.title')}
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button
            onClick={handleCheckOut}
            disabled={submitting || (balance > 0 && !ackBalance)}
            variant="default"
            className="gap-1"
            data-training="fd-checkout-confirm"
          >
            <LogOut className="h-4 w-4" /> {submitting ? t('pms.checkIn.processing') : t('pms.checkOut')}
          </Button>
        </DialogFooter>
        {invoiceOpen && (
          <InvoiceDialog
            reservation={reservation}
            open={invoiceOpen}
            onOpenChange={setInvoiceOpen}
            onIssued={() => { void refreshBalance(); }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
