import { useCallback, useEffect, useMemo, useState } from 'react';
import { Banknote, BookOpen, CreditCard, Plus, Receipt, Settings2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { formatMoney } from '@/lib/reservations';
import {
  canManagePmsServiceCatalogue,
  PMS_PAYMENT_METHODS,
  summarizeFinancialAccount,
} from '@/lib/pmsFinance';

type ReservationFinancialSource = {
  id: string;
  organization_slug?: string | null;
  hotel_id?: string | null;
  currency?: string | null;
  total_amount?: number | string | null;
};

type Folio = {
  id: string;
  display_name: string;
  currency: string;
  base_reservation_amount: number | string;
  status: string;
};

type FolioLine = {
  id: string;
  description: string;
  service_date: string;
  quantity: number | string;
  unit: string;
  vat_code: string;
  vat_rate: number | string | null;
  gross_total: number | string;
  status: string;
};

type Payment = {
  id: string;
  amount: number | string;
  currency: string;
  method: string;
  reference: string | null;
  status: string;
  received_at: string;
};

type ServiceItem = {
  id: string;
  name: string;
  category: string;
  unit: string;
  default_gross_price: number | string;
  currency: string;
  vat_code: string;
  vat_rate: number | string | null;
  allowed_hotel_ids: string[] | null;
  price_editable: boolean;
  requires_manager_approval: boolean;
  is_active: boolean;
};

interface Props {
  reservation: ReservationFinancialSource;
  onFinancialChanged?: () => void | Promise<void>;
}

const MANUAL_ITEM = '__manual__';

const paymentLabel = (method: string) => method.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export function ReservationAccountPanel({ reservation, onFinancialChanged }: Props) {
  const { profile } = useAuth();
  const [folio, setFolio] = useState<Folio | null>(null);
  const [lines, setLines] = useState<FolioLine[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [catalogue, setCatalogue] = useState<ServiceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [chargeOpen, setChargeOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [catalogueOpen, setCatalogueOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const [charge, setCharge] = useState({
    itemId: MANUAL_ITEM,
    description: '',
    quantity: '1',
    unit: 'item',
    grossUnitPrice: '',
    vatCode: 'REVIEW_REQUIRED',
    vatRate: '',
  });
  const [payment, setPayment] = useState({
    amount: '',
    method: 'card_terminal',
    reference: '',
  });
  const [catalogueForm, setCatalogueForm] = useState({
    name: '',
    category: 'other',
    unit: 'item',
    grossPrice: '',
    vatCode: 'REVIEW_REQUIRED',
    vatRate: '',
  });
  const [correction, setCorrection] = useState<
    | { type: 'charge'; id: string; label: string }
    | { type: 'payment'; id: string; label: string }
    | null
  >(null);
  const [correctionReason, setCorrectionReason] = useState('');

  const canManageCatalogue = canManagePmsServiceCatalogue(profile?.role);
  const currency = folio?.currency || reservation.currency || 'HUF';

  const loadAccount = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const { data: folioId, error: ensureError } = await (supabase.rpc as CallableFunction)(
        'pms_finance_ensure_master_folio',
        { _reservation_id: reservation.id },
      );
      if (ensureError) throw ensureError;
      if (!folioId) throw new Error('Financial account could not be opened.');

      const [folioResult, lineResult, paymentResult, catalogueResult] = await Promise.all([
        (supabase as any).from('reservation_folios').select('*').eq('id', folioId).single(),
        (supabase as any).from('folio_lines').select('*').eq('folio_id', folioId).order('service_date', { ascending: true }).order('created_at', { ascending: true }),
        (supabase as any).from('payments').select('*').eq('folio_id', folioId).order('received_at', { ascending: false }),
        (supabase as any).from('service_catalog_items').select('*')
          .eq('organization_slug', reservation.organization_slug || '')
          .eq('is_active', true)
          .order('sort_order', { ascending: true })
          .order('name', { ascending: true }),
      ]);

      if (folioResult.error) throw folioResult.error;
      if (lineResult.error) throw lineResult.error;
      if (paymentResult.error) throw paymentResult.error;
      if (catalogueResult.error) throw catalogueResult.error;

      setFolio(folioResult.data as Folio);
      setLines((lineResult.data ?? []) as FolioLine[]);
      setPayments((paymentResult.data ?? []) as Payment[]);
      setCatalogue((catalogueResult.data ?? []) as ServiceItem[]);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Financial account unavailable.');
    } finally {
      setLoading(false);
    }
  }, [reservation.id, reservation.organization_slug]);

  useEffect(() => {
    void loadAccount();
  }, [loadAccount]);

  const availableCatalogue = useMemo(
    () => catalogue.filter((item) => {
      const hotelAllowed = !item.allowed_hotel_ids?.length || (!!reservation.hotel_id && item.allowed_hotel_ids.includes(reservation.hotel_id));
      return hotelAllowed && item.currency.toUpperCase() === String(currency).toUpperCase();
    }),
    [catalogue, reservation.hotel_id, currency],
  );

  const summary = useMemo(
    () => summarizeFinancialAccount(folio?.base_reservation_amount ?? reservation.total_amount ?? 0, lines, payments),
    [folio?.base_reservation_amount, reservation.total_amount, lines, payments],
  );

  const notifyChanged = async () => {
    await loadAccount();
    await onFinancialChanged?.();
  };

  const pickCatalogueItem = (id: string) => {
    if (id === MANUAL_ITEM) {
      setCharge({
        itemId: MANUAL_ITEM,
        description: '',
        quantity: '1',
        unit: 'item',
        grossUnitPrice: '',
        vatCode: 'REVIEW_REQUIRED',
        vatRate: '',
      });
      return;
    }
    const item = availableCatalogue.find((entry) => entry.id === id);
    if (!item) return;
    setCharge({
      itemId: item.id,
      description: item.name,
      quantity: '1',
      unit: item.unit || 'item',
      grossUnitPrice: String(item.default_gross_price ?? 0),
      vatCode: item.vat_code || 'REVIEW_REQUIRED',
      vatRate: item.vat_rate === null ? '' : String(item.vat_rate),
    });
  };

  const submitCharge = async () => {
    const quantity = Number(charge.quantity);
    const grossUnitPrice = Number(charge.grossUnitPrice);
    if (!charge.description.trim() || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(grossUnitPrice) || grossUnitPrice < 0) {
      toast.error('Enter a valid service, quantity and price.');
      return;
    }
    const vatRate = charge.vatRate.trim() === '' ? null : Number(charge.vatRate);
    if (vatRate !== null && (!Number.isFinite(vatRate) || vatRate < 0 || vatRate > 100)) {
      toast.error('VAT rate must be between 0 and 100.');
      return;
    }

    setBusy(true);
    const { error } = await (supabase.rpc as CallableFunction)('pms_finance_add_charge', {
      _reservation_id: reservation.id,
      _description: charge.description.trim(),
      _quantity: quantity,
      _unit: charge.unit || 'item',
      _gross_unit_price: grossUnitPrice,
      _currency: currency,
      _vat_code: charge.vatCode || 'REVIEW_REQUIRED',
      _vat_rate: vatRate,
      _service_catalog_item_id: charge.itemId === MANUAL_ITEM ? null : charge.itemId,
      _service_date: new Date().toISOString().slice(0, 10),
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success('Charge added.');
    setChargeOpen(false);
    pickCatalogueItem(MANUAL_ITEM);
    await notifyChanged();
  };

  const submitPayment = async () => {
    const amount = Number(payment.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('Enter a valid payment amount.');
      return;
    }
    setBusy(true);
    const { error } = await (supabase.rpc as CallableFunction)('pms_finance_record_payment', {
      _reservation_id: reservation.id,
      _amount: amount,
      _currency: currency,
      _method: payment.method,
      _reference: payment.reference.trim() || null,
      _received_at: new Date().toISOString(),
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success('Payment recorded.');
    setPaymentOpen(false);
    setPayment({ amount: '', method: 'card_terminal', reference: '' });
    await notifyChanged();
  };

  const createCatalogueItem = async () => {
    if (!canManageCatalogue) return;
    const gross = Number(catalogueForm.grossPrice);
    const vatRate = catalogueForm.vatRate.trim() === '' ? null : Number(catalogueForm.vatRate);
    if (!catalogueForm.name.trim() || !Number.isFinite(gross) || gross < 0) {
      toast.error('Enter a valid catalogue item and gross price.');
      return;
    }
    if (vatRate !== null && (!Number.isFinite(vatRate) || vatRate < 0 || vatRate > 100)) {
      toast.error('VAT rate must be between 0 and 100.');
      return;
    }
    setBusy(true);
    const { error } = await (supabase as any).from('service_catalog_items').insert({
      organization_slug: reservation.organization_slug,
      name: catalogueForm.name.trim(),
      category: catalogueForm.category || 'other',
      unit: catalogueForm.unit || 'item',
      default_gross_price: gross,
      currency,
      vat_code: catalogueForm.vatCode || 'REVIEW_REQUIRED',
      vat_rate: vatRate,
      allowed_hotel_ids: reservation.hotel_id ? [reservation.hotel_id] : [],
      price_editable: true,
      is_active: true,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success('Service item created for this property.');
    setCatalogueForm({ name: '', category: 'other', unit: 'item', grossPrice: '', vatCode: 'REVIEW_REQUIRED', vatRate: '' });
    await loadAccount();
  };

  const deactivateCatalogueItem = async (id: string) => {
    if (!canManageCatalogue) return;
    const { error } = await (supabase as any).from('service_catalog_items').update({ is_active: false }).eq('id', id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success('Service item deactivated.');
    await loadAccount();
  };

  const confirmCorrection = async () => {
    if (!correction || !correctionReason.trim()) {
      toast.error('A reason is required.');
      return;
    }
    setBusy(true);
    const fn = correction.type === 'charge' ? 'pms_finance_void_charge' : 'pms_finance_reverse_payment';
    const args = correction.type === 'charge'
      ? { _line_id: correction.id, _reason: correctionReason.trim() }
      : { _payment_id: correction.id, _reason: correctionReason.trim() };
    const { error } = await (supabase.rpc as CallableFunction)(fn, args);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(correction.type === 'charge' ? 'Charge voided.' : 'Payment reversed.');
    setCorrection(null);
    setCorrectionReason('');
    await notifyChanged();
  };

  if (loading) {
    return (
      <Card data-training="reservation-account">
        <CardContent className="py-8 text-center text-sm text-muted-foreground">Loading account…</CardContent>
      </Card>
    );
  }

  if (loadError || !folio) {
    return (
      <Card data-training="reservation-account">
        <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Receipt className="h-4 w-4" /> Account</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-destructive">Financial account is not available.</p>
          <p className="text-xs text-muted-foreground">{loadError || 'Unknown account error.'}</p>
          <Button size="sm" variant="outline" onClick={() => void loadAccount()}>Retry</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card data-training="reservation-account">
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base flex items-center gap-2"><Receipt className="h-4 w-4" /> Account</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">Charges, payments and guest balance for this reservation.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {canManageCatalogue && (
                <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => setCatalogueOpen(true)}>
                  <Settings2 className="h-3.5 w-3.5" /> Services
                </Button>
              )}
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setChargeOpen(true)}>
                <Plus className="h-3.5 w-3.5" /> Add charge
              </Button>
              <Button
                size="sm"
                className="gap-1.5"
                onClick={() => {
                  setPayment((p) => ({ ...p, amount: summary.balance > 0 ? String(summary.balance) : '' }));
                  setPaymentOpen(true);
                }}
              >
                <Banknote className="h-3.5 w-3.5" /> Record payment
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg border p-3">
              <p className="text-[11px] text-muted-foreground">Charges</p>
              <p className="text-lg font-bold">{formatMoney(summary.charges, currency)}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-[11px] text-muted-foreground">Paid</p>
              <p className="text-lg font-bold text-emerald-600">{formatMoney(summary.paid, currency)}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-[11px] text-muted-foreground">Balance</p>
              <p className={`text-lg font-bold ${summary.balance > 0 ? 'text-destructive' : 'text-emerald-600'}`}>
                {formatMoney(summary.balance, currency)}
              </p>
            </div>
          </div>

          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold flex items-center gap-1.5"><BookOpen className="h-4 w-4" /> Charges</h3>
              <span className="text-xs text-muted-foreground">{currency}</span>
            </div>
            <div className="rounded-md border divide-y">
              {Number(folio.base_reservation_amount || 0) > 0 && (
                <div className="grid grid-cols-[1fr_auto] gap-3 p-3 items-center bg-muted/20">
                  <div>
                    <p className="text-sm font-medium">Reservation stay</p>
                    <p className="text-xs text-muted-foreground">Base reservation amount · tax breakdown pending fiscal mapping</p>
                  </div>
                  <p className="text-sm font-semibold">{formatMoney(folio.base_reservation_amount, currency)}</p>
                </div>
              )}
              {lines.filter((line) => line.status !== 'voided').map((line) => (
                <div key={line.id} className="grid grid-cols-[1fr_auto_auto] gap-3 p-3 items-center">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{line.description}</p>
                    <p className="text-xs text-muted-foreground">
                      {line.service_date} · {line.quantity} {line.unit}
                      {' · '}{line.vat_rate === null ? line.vat_code : `VAT ${line.vat_rate}%`}
                    </p>
                  </div>
                  <p className="text-sm font-semibold">{formatMoney(line.gross_total, currency)}</p>
                  {line.status === 'open' ? (
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => setCorrection({ type: 'charge', id: line.id, label: line.description })}
                      aria-label="Void charge"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  ) : <Badge variant="outline" className="text-[10px]">{line.status}</Badge>}
                </div>
              ))}
              {Number(folio.base_reservation_amount || 0) <= 0 && lines.filter((line) => line.status !== 'voided').length === 0 && (
                <p className="p-4 text-sm text-muted-foreground text-center">No charges yet.</p>
              )}
            </div>
          </section>

          <section>
            <h3 className="text-sm font-semibold flex items-center gap-1.5 mb-2"><CreditCard className="h-4 w-4" /> Payments</h3>
            <div className="rounded-md border divide-y">
              {payments.filter((entry) => !['reversed', 'failed'].includes(entry.status)).length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground text-center">No payments recorded.</p>
              ) : (
                payments.filter((entry) => !['reversed', 'failed'].includes(entry.status)).map((entry) => (
                  <div key={entry.id} className="grid grid-cols-[1fr_auto_auto] gap-3 p-3 items-center">
                    <div>
                      <p className="text-sm font-medium">{paymentLabel(entry.method)}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(entry.received_at).toLocaleString()}
                        {entry.reference ? ` · ${entry.reference}` : ''}
                      </p>
                    </div>
                    <p className="text-sm font-semibold text-emerald-600">−{formatMoney(entry.amount, entry.currency)}</p>
                    {['recorded', 'captured'].includes(entry.status) ? (
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => setCorrection({ type: 'payment', id: entry.id, label: paymentLabel(entry.method) })}
                        aria-label="Reverse payment"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    ) : <Badge variant="outline" className="text-[10px]">{entry.status}</Badge>}
                  </div>
                ))
              )}
            </div>
          </section>

          <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
            Fiscal documents are intentionally not activated in Phase 1. Invoice, pro forma, advance/final invoice, receipt and Számlázz.hu/NAV actions will attach to this ledger in the next phase.
          </div>
        </CardContent>
      </Card>

      <Dialog open={chargeOpen} onOpenChange={setChargeOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add charge</DialogTitle>
            <DialogDescription>Select a configured service or add a one-off item. VAT data is stored now for later fiscal issuing.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Service</Label>
              <Select value={charge.itemId} onValueChange={pickCatalogueItem}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={MANUAL_ITEM}>One-off / manual charge</SelectItem>
                  {availableCatalogue.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name} · {formatMoney(item.default_gross_price, item.currency)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Description</Label>
              <Input value={charge.description} onChange={(e) => setCharge((v) => ({ ...v, description: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <Label>Quantity</Label>
                <Input type="number" min="0.001" step="0.001" value={charge.quantity} onChange={(e) => setCharge((v) => ({ ...v, quantity: e.target.value }))} />
              </div>
              <div>
                <Label>Unit</Label>
                <Input value={charge.unit} onChange={(e) => setCharge((v) => ({ ...v, unit: e.target.value }))} />
              </div>
              <div>
                <Label>Gross/unit</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={charge.grossUnitPrice}
                  disabled={charge.itemId !== MANUAL_ITEM && availableCatalogue.find((item) => item.id === charge.itemId)?.price_editable === false}
                  onChange={(e) => setCharge((v) => ({ ...v, grossUnitPrice: e.target.value }))}
                />
              </div>
              <div>
                <Label>VAT %</Label>
                <Input type="number" min="0" max="100" step="0.01" placeholder="special" value={charge.vatRate} onChange={(e) => setCharge((v) => ({ ...v, vatRate: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label>VAT code</Label>
              <Input value={charge.vatCode} onChange={(e) => setCharge((v) => ({ ...v, vatCode: e.target.value }))} />
              {charge.vatCode === 'REVIEW_REQUIRED' && <p className="text-[11px] text-amber-700 mt-1">Tax mapping must be reviewed before this line can be used on a fiscal document.</p>}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setChargeOpen(false)}>Cancel</Button>
            <Button onClick={() => void submitCharge()} disabled={busy}>Add charge</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={paymentOpen} onOpenChange={setPaymentOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Record payment</DialogTitle>
            <DialogDescription>Phase 1 records the payment in HotelCare. It does not yet charge a card or issue a fiscal document.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Amount ({currency})</Label>
              <Input type="number" min="0.01" step="0.01" value={payment.amount} onChange={(e) => setPayment((v) => ({ ...v, amount: e.target.value }))} />
            </div>
            <div>
              <Label>Method</Label>
              <Select value={payment.method} onValueChange={(method) => setPayment((v) => ({ ...v, method }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PMS_PAYMENT_METHODS.map((method) => <SelectItem key={method} value={method}>{paymentLabel(method)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Reference / note</Label>
              <Input value={payment.reference} onChange={(e) => setPayment((v) => ({ ...v, reference: e.target.value }))} placeholder="Optional terminal, transfer or voucher reference" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaymentOpen(false)}>Cancel</Button>
            <Button onClick={() => void submitPayment()} disabled={busy}>Record payment</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={catalogueOpen} onOpenChange={setCatalogueOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Property service catalogue</DialogTitle>
            <DialogDescription>Preconfigure frequently charged services for this property. Fiscal VAT mapping should be reviewed by the hotel's accountant before invoice activation.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid sm:grid-cols-6 gap-2">
              <Input className="sm:col-span-2" placeholder="Service name" value={catalogueForm.name} onChange={(e) => setCatalogueForm((v) => ({ ...v, name: e.target.value }))} />
              <Input placeholder="Category" value={catalogueForm.category} onChange={(e) => setCatalogueForm((v) => ({ ...v, category: e.target.value }))} />
              <Input placeholder="Unit" value={catalogueForm.unit} onChange={(e) => setCatalogueForm((v) => ({ ...v, unit: e.target.value }))} />
              <Input type="number" min="0" step="0.01" placeholder={`Gross ${currency}`} value={catalogueForm.grossPrice} onChange={(e) => setCatalogueForm((v) => ({ ...v, grossPrice: e.target.value }))} />
              <Input type="number" min="0" max="100" step="0.01" placeholder="VAT %" value={catalogueForm.vatRate} onChange={(e) => setCatalogueForm((v) => ({ ...v, vatRate: e.target.value }))} />
            </div>
            <div className="flex gap-2">
              <Input placeholder="VAT code" value={catalogueForm.vatCode} onChange={(e) => setCatalogueForm((v) => ({ ...v, vatCode: e.target.value }))} />
              <Button onClick={() => void createCatalogueItem()} disabled={busy}>Add service</Button>
            </div>
            <div className="rounded-md border divide-y">
              {availableCatalogue.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground text-center">No configured services for this property and currency yet.</p>
              ) : availableCatalogue.map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-3 p-3">
                  <div>
                    <p className="text-sm font-medium">{item.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.category} · {item.unit} · {item.vat_rate === null ? item.vat_code : `VAT ${item.vat_rate}%`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{formatMoney(item.default_gross_price, item.currency)}</span>
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => void deactivateCatalogueItem(item.id)}>Deactivate</Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!correction} onOpenChange={(open) => { if (!open) { setCorrection(null); setCorrectionReason(''); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{correction?.type === 'charge' ? 'Void charge' : 'Reverse payment'}</DialogTitle>
            <DialogDescription>
              This does not delete history. HotelCare records an auditable correction for {correction?.label || 'this item'}.
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label>Reason</Label>
            <Input value={correctionReason} onChange={(e) => setCorrectionReason(e.target.value)} autoFocus />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCorrection(null); setCorrectionReason(''); }}>Cancel</Button>
            <Button variant="destructive" onClick={() => void confirmCorrection()} disabled={busy || !correctionReason.trim()}>
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
