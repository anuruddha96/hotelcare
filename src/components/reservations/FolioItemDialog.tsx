import { useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { CreditCard, Receipt } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { addFolioItem, LifecycleError } from '@/lib/pmsLifecycle';
import { formatMoney } from '@/lib/reservations';

const CHARGE_TYPES = ['room', 'minibar', 'restaurant', 'bar', 'spa', 'city_tax', 'service', 'adjustment', 'other'];

interface FolioItemDialogProps {
  reservationId: string;
  currency?: string | null;
  mode: 'charge' | 'payment';
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function FolioItemDialog({ reservationId, currency, mode, open, onOpenChange, onSuccess }: FolioItemDialogProps) {
  const { t } = useTranslation();
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState<string>('');
  const [chargeType, setChargeType] = useState('other');
  const [submitting, setSubmitting] = useState(false);

  const isPayment = mode === 'payment';

  const submit = async () => {
    const value = Number(amount);
    if (!Number.isFinite(value) || value === 0 || (isPayment && value < 0)) {
      toast.error(t('pms.err.invalidAmount'));
      return;
    }
    const desc = description.trim() || (isPayment ? t('pms.res.addPayment') : t('pms.res.addCharge'));
    setSubmitting(true);
    try {
      const result = await addFolioItem(reservationId, desc, value, isPayment ? 'payment' : chargeType);
      toast.success(
        `${isPayment ? t('pms.res.paymentRecorded') : t('pms.res.chargeAdded')} · ${t('pms.res.balance')}: ${formatMoney(result.balance_due, currency)}`,
      );
      setDescription('');
      setAmount('');
      onSuccess();
      onOpenChange(false);
    } catch (err) {
      const key = err instanceof LifecycleError ? err.translationKey : null;
      toast.error(key ? t(key) : (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm" data-training="res-folio-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isPayment ? <CreditCard className="h-5 w-5 text-green-600" /> : <Receipt className="h-5 w-5 text-primary" />}
            {isPayment ? t('pms.res.addPayment') : t('pms.res.addCharge')}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>{t('pms.res.description')}</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{t('pms.res.amount')} {currency ? `(${currency})` : ''}</Label>
              <Input
                type="number"
                inputMode="decimal"
                min={isPayment ? 0 : undefined}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            {!isPayment && (
              <div>
                <Label>{t('pms.res.chargeType')}</Label>
                <Select value={chargeType} onValueChange={setChargeType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CHARGE_TYPES.map((ct) => (
                      <SelectItem key={ct} value={ct} className="capitalize">{ct.replace('_', ' ')}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button onClick={submit} disabled={submitting || !amount}>
            {submitting ? t('pms.checkIn.processing') : (isPayment ? t('pms.res.addPayment') : t('pms.res.addCharge'))}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
