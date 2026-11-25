import { useLocaleFormat } from '@/lib/i18n/localeFormat';
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
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
import { startVizaInstantSend } from '@/lib/viza/instantSend';
import { formatMoney, reservationGuestLabel } from '@/lib/reservations';
import { InvoiceDialog } from '@/components/frontdesk/InvoiceDialog';
import { BusinessMomentField, useBusinessMoment } from '@/components/frontdesk/BusinessMomentField';
import { StayGuestRoster, useStayGuestRoster } from '@/components/frontdesk/StayGuestRoster';
import { BusinessDayField } from '@/components/frontdesk/BusinessDayField';
import { budapestToday } from '@/lib/businessMoment';
import { AddChargeDialog } from '@/components/frontdesk/AddChargeDialog';

interface CheckOutDialogProps {
  reservation: any;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function CheckOutDialog({ reservation, open, onOpenChange, onSuccess }: CheckOutDialogProps) {
  const { t } = useTranslation();
  const locale = useLocaleFormat();
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
  const [chargeOpen, setChargeOpen] = useState(false);
  const [paymentDay, setPaymentDay] = useState(() => budapestToday());
  const businessMoment = useBusinessMoment(reservation.hotel_id, open);
  const roster = useStayGuestRoster(reservation.id, reservation.hotel_id, open, 'depart', reservation.room_id);
  const isFinalDeparture = !roster.enabled || roster.selectedIds.length === roster.eligible.length;

  const payMethods: Array<{ value: string; key: string }> = [
    { value: 'card', key: 'pms.pay.card' },
    { value: 'cash', key: 'pms.pay.cash' },
    { value: 'transfer', key: 'pms.pay.transfer' },
    { value: 'szep_card', key: 'pms.pay.szep' },
    { value: 'voucher', key: 'Voucher' },
    { value: 'on_account', key: 'On account / later' },
    { value: 'other', key: 'Other' },
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
        `${t('pms.pay.recordPayment')} · ${methodLabel ? (methodLabel.key.startsWith('pms.') ? t(methodLabel.key) : methodLabel.key) : payMethod}`,
        amount,
        'payment', paymentDay, payMethod,
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
    setPaymentDay(budapestToday());
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
      await checkOutReservation(reservation.id, ackBalance, businessMoment.occurredAt,
        roster.enabled ? roster.selectedIds : null);
      toast.success(`${reservationGuestLabel(reservation)} ${t('pms.checkOut.checkedOut')}`);
      onSuccess();
      // Report the departure right away too; hotels without VIZA get no note (the call returns nothing to send).
      if (reservation.hotel_id) void startVizaInstantSend({ hotelId: reservation.hotel_id, reservationId: reservation.id, phase: 'departure', t });
    } catch (err) {
      const key = err instanceof LifecycleError ? err.translationKey : null;
      toast.error(key ? t(key) : t('pms.checkOut.failedCheckOut'));

    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex w-[calc(100%_-_1rem)] min-w-0 max-w-xl max-h-[90dvh] flex-col gap-3 overflow-hidden rounded-lg p-3 sm:gap-4 sm:p-6" data-training="fd-checkout-dialog">
        <DialogHeader className="shrink-0 pr-8 text-left">
          <DialogTitle className="flex items-center gap-2">
            <LogOut className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" /> {t('pms.checkOut.checkOutGuest')}
          </DialogTitle>
        </DialogHeader>
        <div className="min-h-0 min-w-0 flex-1 space-y-3 overflow-y-auto overscroll-contain sm:space-y-4">
          <div className="min-w-0 break-words rounded-lg border border-border bg-muted/40 p-3 space-y-0.5">
            <p className="font-semibold">{reservationGuestLabel(reservation)}</p>
            <p className="text-sm text-muted-foreground">{reservation.reservation_number}</p>
            <p className="text-sm text-muted-foreground">
              {reservation.check_in_date} → {reservation.check_out_date}
              {roomNumber ? ` · ${t('pms.res.room')} ${roomNumber}` : ''}
            </p>
            <p className="text-sm text-muted-foreground">
              {t('pms.checkOut.checkedInDate')}: {reservation.actual_check_in ? locale.formatDate(reservation.actual_check_in) : locale.formatDate(reservation.check_in_date)}
            </p>
          </div>

          <div className="p-3 rounded-lg border border-border text-sm space-y-1">
            {folioTotal !== null && (
              <div className="flex min-w-0 items-baseline justify-between gap-3">
                <span className="text-muted-foreground">{t('pms.co.folioTotal')}</span>
                <span className="shrink-0 font-medium tabular-nums">{formatMoney(folioTotal || reservation.total_amount, reservation.currency)}</span>
              </div>
            )}
            <div className="flex min-w-0 items-baseline justify-between gap-3">
              <span className="text-muted-foreground">{t('pms.co.balanceDue')}</span>
              <span className={`shrink-0 font-semibold tabular-nums ${balance > 0 ? 'text-amber-700 dark:text-amber-400' : 'text-green-700 dark:text-green-400'}`}>
                {formatMoney(balance, reservation.currency)}
              </span>
            </div>
          </div>

          {balance > 0 && (
            <div className="rounded-md border border-border p-2.5 space-y-1.5" data-training="fd-checkout-payment">
              <p className="text-xs font-medium flex items-center gap-1.5"><Wallet className="h-3.5 w-3.5" /> {t('pms.pay.recordPayment')}</p>
              <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                <Input className="h-10 w-full min-w-0" type="number" min={0} step="any" value={payAmount}
                  placeholder={String(balance)} onChange={(e) => setPayAmount(e.target.value)} />
                <Select value={payMethod} onValueChange={setPayMethod}>
                  <SelectTrigger className="h-10 w-full min-w-0"><SelectValue /></SelectTrigger>
                  <SelectContent>{payMethods.map((m) => <SelectItem key={m.value} value={m.value}>{m.key.startsWith('pms.') ? t(m.key) : m.key}</SelectItem>)}</SelectContent>
                </Select>
                <Button type="button" size="sm" variant="outline" className="col-span-2 h-10 min-w-0 sm:col-span-1"
                  disabled={payBusy || !(Number(payAmount) > 0)} onClick={recordPayment}>
                  {payBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'OK'}
                </Button>
              </div>
              <BusinessDayField hotelId={reservation.hotel_id} value={paymentDay} onChange={setPaymentDay} />
              <button type="button" className="text-xs text-muted-foreground underline"
                onClick={() => setPayAmount(String(balance))}>
                {formatMoney(balance, reservation.currency)}
              </button>
            </div>
          )}

          {balance > 0 && isFinalDeparture && (
            <div className="flex items-start gap-2 rounded-md border border-amber-300/50 bg-amber-500/10 p-2.5">
              <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <p className="text-xs text-amber-700 dark:text-amber-400">{t('pms.co.balanceWarning')}</p>
                <div className="flex items-start gap-2">
                  <Checkbox className="mt-0.5 shrink-0" id="ack-balance" checked={ackBalance} onCheckedChange={(c) => setAckBalance(!!c)} />
                  <label htmlFor="ack-balance" className="min-w-0 break-words text-xs font-medium leading-relaxed">
                    {t('pms.co.ackBalance')}
                  </label>
                </div>
              </div>
            </div>
          )}

          <StayGuestRoster control={roster} mode="depart" reservationId={reservation.id} hotelId={reservation.hotel_id}
            orgSlug={reservation.organization_slug} occurredAt={businessMoment.occurredAt} onChanged={onSuccess} />
          <BusinessMomentField control={businessMoment} />

          {(!roster.enabled || roster.selectedIds.length === roster.eligible.length) && (
            <p className="text-xs text-muted-foreground flex items-start gap-1.5">
              <BedDouble className="h-3.5 w-3.5 shrink-0" /> {t('pms.co.roomWillBeDirty')}
            </p>
          )}
        </div>
        <div className="min-w-0 shrink-0 space-y-2 border-t border-border pt-3">
          <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="outline" className="h-auto min-h-10 min-w-0 gap-1.5 whitespace-normal break-words py-2" onClick={() => setInvoiceOpen(true)} data-training="fd-checkout-invoice">
            <FileText className="h-4 w-4 shrink-0" /> {t('pms.inv.title')}
          </Button>
          <Button type="button" variant="outline" className="h-auto min-h-10 min-w-0 gap-1.5 whitespace-normal break-words py-2" title={t('pms.charge.tip')} onClick={() => setChargeOpen(true)} data-training="fd-checkout-charge">
            ➕ {t('pms.charge.add')}
          </Button>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-2">
          <Button type="button" variant="outline" className="h-auto min-h-10 min-w-0 whitespace-normal break-words py-2" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button
            onClick={handleCheckOut}
            disabled={submitting || businessMoment.invalid || roster.loading
              || (balance > 0 && isFinalDeparture && !ackBalance)
              || (roster.enabled && roster.selectedIds.length === 0)}
            variant="default"
            className="h-auto min-h-10 min-w-0 gap-1.5 whitespace-normal break-words py-2"
            data-training="fd-checkout-confirm"
          >
            <LogOut className="h-4 w-4 shrink-0" /> {submitting ? t('pms.checkIn.processing') : `${t('pms.checkOut')} · ${businessMoment.display}`}
          </Button>
          </div>
        </div>
        <AddChargeDialog reservation={reservation} open={chargeOpen} onOpenChange={setChargeOpen} onAdded={(due) => setBalance(due)} />
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
