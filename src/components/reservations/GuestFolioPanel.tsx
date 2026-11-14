import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { FileText, Loader2, PlusCircle, Receipt, Wallet } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { addFolioItem, LifecycleError } from '@/lib/pmsLifecycle';
import { formatMoney } from '@/lib/reservations';
import { AddChargeDialog } from '@/components/frontdesk/AddChargeDialog';
import { InvoiceDialog } from '@/components/frontdesk/InvoiceDialog';

/**
 * Reservation account built on guest_folios + pms_add_folio_item — the same
 * folio used by check-in/check-out and Számlázz.hu invoicing. Shown whenever
 * the (not yet deployed) financial-core account cannot be opened, so
 * reception can always see the bill, add extras and take payments.
 */

interface FolioRow {
  id: string;
  description: string;
  amount: number;
  charge_type: string;
  created_at: string;
}

interface GuestFolioPanelProps {
  reservation: { id: string; hotel_id: string; currency?: string | null; status?: string | null } & Record<string, unknown>;
  onChanged?: () => void | Promise<void>;
}

const PAY_METHODS: Array<{ value: string; key: string }> = [
  { value: 'card', key: 'pms.pay.card' },
  { value: 'cash', key: 'pms.pay.cash' },
  { value: 'transfer', key: 'pms.pay.transfer' },
  { value: 'szep_card', key: 'pms.pay.szep' },
];

export function GuestFolioPanel({ reservation, onChanged }: GuestFolioPanelProps) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<FolioRow[]>([]);
  const [balance, setBalance] = useState<number>(Number(reservation.balance_due ?? 0));
  const [loading, setLoading] = useState(true);
  const [chargeOpen, setChargeOpen] = useState(false);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('card');
  const [payBusy, setPayBusy] = useState(false);
  const currency = String(reservation.currency ?? 'HUF');
  const closed = ['cancelled', 'no_show'].includes(String(reservation.status));

  const load = useCallback(async () => {
    setLoading(true);
    const [folio, res] = await Promise.all([
      supabase.from('guest_folios').select('id, description, amount, charge_type, created_at')
        .eq('reservation_id', reservation.id).order('created_at'),
      supabase.from('reservations').select('balance_due').eq('id', reservation.id).maybeSingle(),
    ]);
    setRows((folio.data ?? []) as FolioRow[]);
    if (res.data) setBalance(Number(res.data.balance_due ?? 0));
    setLoading(false);
  }, [reservation.id]);

  useEffect(() => { void load(); }, [load]);

  const refresh = async () => { await load(); await onChanged?.(); };

  const recordPayment = async () => {
    const amount = Number(payAmount);
    if (!(amount > 0)) return;
    setPayBusy(true);
    try {
      const method = PAY_METHODS.find((m) => m.value === payMethod);
      await addFolioItem(reservation.id, `${t('pms.pay.recordPayment')} · ${method ? t(method.key) : payMethod}`, amount, 'payment');
      setPayAmount('');
      toast.success(t('pms.pay.recorded'));
      await refresh();
    } catch (err) {
      const key = err instanceof LifecycleError ? err.translationKey : null;
      toast.error(key ? t(key) : (err as Error).message);
    } finally {
      setPayBusy(false);
    }
  };

  const charges = rows.filter((r) => r.charge_type !== 'payment');
  const payments = rows.filter((r) => r.charge_type === 'payment');

  return (
    <Card data-training="reservation-account">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2 flex-wrap">
          <Receipt className="h-4 w-4" /> Account
          <span className={`ml-auto text-sm ${balance > 0 ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400'}`}>
            {formatMoney(balance, currency)}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" className="h-8 gap-1.5" disabled={closed} title={t('pms.charge.tip')} onClick={() => setChargeOpen(true)}>
            <PlusCircle className="h-4 w-4" /> {t('pms.charge.add')}
          </Button>
          <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setInvoiceOpen(true)}>
            <FileText className="h-4 w-4" /> {t('pms.inv.title')}
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('pms.loading')}</div>
        ) : (
          <div className="rounded-md border border-border divide-y divide-border text-xs">
            {charges.length === 0 && payments.length === 0 && (
              <div className="px-3 py-2 text-muted-foreground">—</div>
            )}
            {charges.map((r) => (
              <div key={r.id} className="flex items-center gap-2 px-3 py-1.5">
                <span className="min-w-0 flex-1 truncate">{r.description}</span>
                <span className="text-muted-foreground shrink-0">{r.created_at.slice(0, 10)}</span>
                <span className="font-medium shrink-0 w-24 text-right">{formatMoney(Number(r.amount), currency)}</span>
              </div>
            ))}
            {payments.map((r) => (
              <div key={r.id} className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50/50 dark:bg-emerald-950/20">
                <Wallet className="h-3.5 w-3.5 text-emerald-700 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{r.description}</span>
                <span className="text-muted-foreground shrink-0">{r.created_at.slice(0, 10)}</span>
                <span className="font-medium shrink-0 w-24 text-right text-emerald-700 dark:text-emerald-400">−{formatMoney(Number(r.amount), currency)}</span>
              </div>
            ))}
          </div>
        )}

        {!closed && balance > 0 && (
          <div className="flex gap-1.5" data-training="reservation-account-pay">
            <Input className="h-8" type="number" min={0} step="any" placeholder={String(balance)} value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
            <Select value={payMethod} onValueChange={setPayMethod}>
              <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
              <SelectContent>{PAY_METHODS.map((m) => <SelectItem key={m.value} value={m.value}>{t(m.key)}</SelectItem>)}</SelectContent>
            </Select>
            <Button type="button" size="sm" variant="outline" className="h-8 shrink-0 gap-1" disabled={payBusy || !(Number(payAmount) > 0)} onClick={recordPayment}>
              {payBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wallet className="h-3.5 w-3.5" />} {t('pms.pay.recordPayment')}
            </Button>
          </div>
        )}
      </CardContent>

      <AddChargeDialog reservation={reservation} open={chargeOpen} onOpenChange={setChargeOpen} onAdded={() => { void refresh(); }} />
      {invoiceOpen && <InvoiceDialog reservation={reservation} open={invoiceOpen} onOpenChange={setInvoiceOpen} onIssued={() => { void refresh(); }} />}
    </Card>
  );
}
