import { useMemo, useState } from 'react';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Loader2, PlusCircle } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { addFolioItem, LifecycleError } from '@/lib/pmsLifecycle';
import { formatMoney, reservationGuestLabel } from '@/lib/reservations';

/**
 * Post an extra to the guest folio in two taps: pick what it is, confirm the
 * amount. Every option maps onto a charge type the folio RPC accepts, so the
 * Számlázz.hu invoice dialog can suggest the right VAT key later.
 */

interface ChargeOption {
  key: string;
  icon: string;
  labelKey: string;
  chargeType: 'city_tax' | 'minibar' | 'restaurant' | 'service' | 'other';
  /** Default quantity from the stay (e.g. tourism tax = adults × nights). */
  qty?: (r: StayLike) => number;
}

interface StayLike {
  adults?: number | null;
  total_nights?: number | null;
  check_in_date?: string | null;
  check_out_date?: string | null;
}

const nightsOf = (r: StayLike) => {
  if (r.total_nights && r.total_nights > 0) return r.total_nights;
  if (r.check_in_date && r.check_out_date) {
    return Math.max(1, Math.round((Date.parse(r.check_out_date) - Date.parse(r.check_in_date)) / 86400000));
  }
  return 1;
};

const OPTIONS: ChargeOption[] = [
  { key: 'city_tax', icon: '🏛️', labelKey: 'pms.charge.cityTax', chargeType: 'city_tax', qty: (r) => Math.max(1, r.adults ?? 1) * nightsOf(r) },
  { key: 'minibar', icon: '🧃', labelKey: 'pms.charge.minibar', chargeType: 'minibar' },
  { key: 'breakfast', icon: '🥐', labelKey: 'pms.charge.breakfast', chargeType: 'restaurant', qty: (r) => Math.max(1, r.adults ?? 1) },
  { key: 'cleaning', icon: '🧹', labelKey: 'pms.charge.cleaning', chargeType: 'service' },
  { key: 'taxi', icon: '🚕', labelKey: 'pms.charge.taxi', chargeType: 'service' },
  { key: 'parking', icon: '🅿️', labelKey: 'pms.charge.parking', chargeType: 'service', qty: nightsOf },
  { key: 'laundry', icon: '👕', labelKey: 'pms.charge.laundry', chargeType: 'service' },
  { key: 'late_checkout', icon: '🕐', labelKey: 'pms.charge.lateCheckout', chargeType: 'service' },
  { key: 'other', icon: '➕', labelKey: 'pms.charge.other', chargeType: 'other' },
];

interface AddChargeDialogProps {
  reservation: { id: string; currency?: string | null } & StayLike & Record<string, unknown>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded?: (balanceDue: number) => void;
}

export function AddChargeDialog({ reservation, open, onOpenChange, onAdded }: AddChargeDialogProps) {
  const { t } = useTranslation();
  const [choice, setChoice] = useState<ChargeOption | null>(null);
  const [qty, setQty] = useState('1');
  const [unitPrice, setUnitPrice] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const total = useMemo(() => {
    const q = Number(qty);
    const p = Number(unitPrice);
    return Number.isFinite(q) && Number.isFinite(p) ? Math.round(q * p * 100) / 100 : 0;
  }, [qty, unitPrice]);

  const pick = (option: ChargeOption) => {
    setChoice(option);
    setQty(String(option.qty ? option.qty(reservation) : 1));
  };

  const reset = () => { setChoice(null); setQty('1'); setUnitPrice(''); setNote(''); };

  const save = async () => {
    if (!choice || !(total > 0)) return;
    setSaving(true);
    try {
      const q = Number(qty);
      const label = t(choice.labelKey);
      const description = [
        q !== 1 ? `${label} × ${q}` : label,
        note.trim() ? `— ${note.trim()}` : '',
      ].filter(Boolean).join(' ').slice(0, 200);
      const result = await addFolioItem(reservation.id, description, total, choice.chargeType);
      toast.success(`${t('pms.charge.added')} · ${formatMoney(total, reservation.currency)}`);
      onAdded?.(Number(result.balance_due ?? 0));
      reset();
      onOpenChange(false);
    } catch (err) {
      const key = err instanceof LifecycleError ? err.translationKey : null;
      toast.error(key ? t(key) : (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!saving) { if (!next) reset(); onOpenChange(next); } }}>
      <DialogContent className="sm:max-w-md" data-training="fd-add-charge">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PlusCircle className="h-5 w-5 text-primary" /> {t('pms.charge.add')} · {reservationGuestLabel(reservation)}
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-2">
          {OPTIONS.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => pick(option)}
              aria-pressed={choice?.key === option.key}
              className={`rounded-lg border px-2 py-2.5 text-xs font-medium flex flex-col items-center gap-1 transition-colors ${choice?.key === option.key ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-accent'}`}
            >
              <span className="text-lg leading-none" aria-hidden="true">{option.icon}</span>
              <span className="text-center leading-tight">{t(option.labelKey)}</span>
            </button>
          ))}
        </div>

        {choice && (
          <div className="space-y-2.5 pt-1">
            {choice.key === 'city_tax' && <p className="text-[11px] text-muted-foreground">{t('pms.charge.cityTaxHint')}</p>}
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <Label className="text-xs">{t('pms.charge.qty')}</Label>
                <Input className="h-9" type="number" min={0.01} step="any" value={qty} onChange={(e) => setQty(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">{t('pms.charge.unitPrice')} ({reservation.currency ?? ''})</Label>
                <Input className="h-9" type="number" min={0} step="any" autoFocus value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} />
              </div>
            </div>
            <div>
              <Label className="text-xs">{t('pms.charge.note')}</Label>
              <Input className="h-9" value={note} maxLength={120} onChange={(e) => setNote(e.target.value)} />
            </div>
            <p className="text-sm text-right">{t('pms.inv.total')}: <span className="font-semibold">{formatMoney(total, reservation.currency)}</span></p>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" disabled={saving} onClick={() => { reset(); onOpenChange(false); }}>{t('common.cancel')}</Button>
          <Button type="button" disabled={saving || !choice || !(total > 0)} onClick={save} className="gap-1.5">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}{t('pms.charge.add')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
