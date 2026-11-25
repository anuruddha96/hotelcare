import { lifecycleErrorKey } from '@/lib/reservations';
import { CATEGORIES } from '../../../supabase/functions/_shared/ntak/codes';
import { BusinessDayField } from '@/components/frontdesk/BusinessDayField';
import { budapestToday, budapestWallToIso } from '@/lib/businessMoment';
import { AddChargeDialog } from '@/components/frontdesk/AddChargeDialog';
import { GuestFolioPanel } from '@/components/reservations/GuestFolioPanel';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Banknote, BookOpen, CreditCard, Plus, Receipt, Settings2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { useLocaleFormat } from '@/lib/i18n/localeFormat';
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
  balance_due?: number | string | null;
  status?: string | null;
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
  ntak_main?: string | null;
  ntak_sub?: string | null;
  in_package?: boolean;
};

interface Props {
  reservation: ReservationFinancialSource;
  onFinancialChanged?: () => void | Promise<void>;
}

const MANUAL_ITEM = '__manual__';

const paymentLabel = (method: string) => method === 'on_account' ? 'On account / later' : method === 'coupon' ? 'Voucher' : method.startsWith('szep_') ? `SZÉP card (${method.slice(5).toUpperCase()}, accommodation)` : method.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export function ReservationAccountPanel({ reservation, onFinancialChanged }: Props) {
  const { profile } = useAuth();
  const { t, language } = useTranslation();
  const locale = useLocaleFormat();
  const displayMoney = language === 'hu' ? locale.formatMoney : formatMoney;
  const [nativeAccess, setNativeAccess] = useState<{id:string; allowed:boolean} | null>(null);
  const isNativePms = nativeAccess?.id === reservation.id && nativeAccess.allowed;
  useEffect(() => {
    let alive = true;
    setNativeAccess(null);
    void (async () => {
      try {
        const {data,error} = await (supabase.rpc as CallableFunction)('pms_finance_native_access',{_reservation_id:reservation.id});
        if (alive) setNativeAccess({id:reservation.id,allowed:!error && data===true});
      } catch { if (alive) setNativeAccess({id:reservation.id,allowed:false}); }
    })();
    return () => { alive=false; };
  },[reservation.id]);
  const [folio, setFolio] = useState<Folio | null>(null);
  const [lines, setLines] = useState<FolioLine[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [catalogue, setCatalogue] = useState<ServiceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [chargeOpen, setChargeOpen] = useState(false);
  const [manyOpen, setManyOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [catalogueOpen, setCatalogueOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [chargeDay, setChargeDay] = useState(() => budapestToday());
  const [paymentDay, setPaymentDay] = useState(() => budapestToday());

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
    ntakMain: '',
    ntakSub: '',
    inPackage: false,
  });
  const [correction, setCorrection] = useState<
    | { type: 'charge'; id: string; label: string }
    | { type: 'payment'; id: string; label: string }
    | null
  >(null);
  const [correctionReason, setCorrectionReason] = useState('');

  const canManageCatalogue = isNativePms && canManagePmsServiceCatalogue(profile?.role);
  const departed = reservation.status === 'checked_out';
  const postingAllowed = isNativePms && !['cancelled','no_show'].includes(String(reservation.status)) && (!departed || canManageCatalogue);
  const currency = folio?.currency || reservation.currency || 'HUF';

  const loadAccount = useCallback(async () => {
    // Never create or recalculate a HotelCare financial-core folio just by
    // opening a Previo-managed booking. Its imported figures are authoritative.
    if (!isNativePms) {
      setFolio(null);
      setLines([]);
      setPayments([]);
      setCatalogue([]);
      setLoadError(null);
      setLoading(false);
      return;
    }
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
  }, [isNativePms, reservation.id, reservation.organization_slug]);

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
    if (!postingAllowed) return;
    const quantity = Number(charge.quantity);
    const grossUnitPrice = Number(charge.grossUnitPrice);
    if (!charge.description.trim() || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(grossUnitPrice) || grossUnitPrice < 0) {
      toast.error(t('pms.account.invalidCharge'));
      return;
    }
    const vatRate = charge.vatRate.trim() === '' ? null : Number(charge.vatRate);
    if (vatRate !== null && (!Number.isFinite(vatRate) || vatRate < 0 || vatRate > 100)) {
      toast.error(t('pms.account.invalidVat'));
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
      _service_date: chargeDay,
    });
    setBusy(false);
    if (error) {
      toast.error(lifecycleErrorKey(error) ? t(lifecycleErrorKey(error)!) : error.message);
      return;
    }
    toast.success(t('pms.account.chargeAdded'));
    setChargeOpen(false);
    pickCatalogueItem(MANUAL_ITEM);
    await notifyChanged();
  };

  const submitPayment = async () => {
    if (!postingAllowed) return;
    const amount = Number(payment.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error(t('pms.account.invalidPayment'));
      return;
    }
    setBusy(true);
    const { error } = await (supabase.rpc as CallableFunction)('pms_finance_record_payment', {
      _reservation_id: reservation.id,
      _amount: amount,
      _currency: currency,
      _method: payment.method,
      _reference: payment.reference.trim() || null,
      _received_at: budapestWallToIso(`${paymentDay}T12:00`),
    });
    setBusy(false);
    if (error) {
      toast.error(lifecycleErrorKey(error) ? t(lifecycleErrorKey(error)!) : error.message);
      return;
    }
    toast.success(t('pms.account.paymentRecorded'));
    setPaymentOpen(false);
    setPayment({ amount: '', method: 'card_terminal', reference: '' });
    await notifyChanged();
  };

  const createCatalogueItem = async () => {
    if (!isNativePms) { toast.error(t('pms.account.externalReadOnly')); return; }
    if (!canManageCatalogue) return;
    const gross = Number(catalogueForm.grossPrice);
    const vatRate = catalogueForm.vatRate.trim() === '' ? null : Number(catalogueForm.vatRate);
    if (!catalogueForm.name.trim() || !Number.isFinite(gross) || gross < 0) {
      toast.error(t('pms.account.invalidCatalogue'));
      return;
    }
    if (vatRate !== null && (!Number.isFinite(vatRate) || vatRate < 0 || vatRate > 100)) {
      toast.error(t('pms.account.invalidVat'));
      return;
    }
    const subs = CATEGORIES[catalogueForm.ntakMain as keyof typeof CATEGORIES] as readonly string[] | undefined;
    if (catalogueForm.ntakMain && (!subs || (subs.length > 0 && !subs.includes(catalogueForm.ntakSub)))) {
      toast.error(t('pms.account.invalidSubcategory'));
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
      ...(catalogueForm.ntakMain ? { ntak_main: catalogueForm.ntakMain, ntak_sub: catalogueForm.ntakSub || null, in_package: catalogueForm.inPackage } : {}),
      allowed_hotel_ids: reservation.hotel_id ? [reservation.hotel_id] : [],
      price_editable: true,
      is_active: true,
    });
    setBusy(false);
    if (error) {
      toast.error(lifecycleErrorKey(error) ? t(lifecycleErrorKey(error)!) : error.message);
      return;
    }
    toast.success(t('pms.account.serviceCreated'));
    setCatalogueForm({ name: '', category: 'other', unit: 'item', grossPrice: '', vatCode: 'REVIEW_REQUIRED', vatRate: '', ntakMain: '', ntakSub: '', inPackage: false });
    await loadAccount();
  };

  const deactivateCatalogueItem = async (id: string) => {
    if (!isNativePms) { toast.error(t('pms.account.externalReadOnly')); return; }
    if (!canManageCatalogue) return;
    const { error } = await (supabase as any).from('service_catalog_items').update({ is_active: false }).eq('id', id);
    if (error) {
      toast.error(lifecycleErrorKey(error) ? t(lifecycleErrorKey(error)!) : error.message);
      return;
    }
    toast.success(t('pms.account.serviceDeactivated'));
    await loadAccount();
  };

  const confirmCorrection = async () => {
    if (!isNativePms) { toast.error(t('pms.account.externalReadOnly')); return; }
    if (!correction || !correctionReason.trim()) {
      toast.error(t('pms.account.reasonRequired'));
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
      toast.error(lifecycleErrorKey(error) ? t(lifecycleErrorKey(error)!) : error.message);
      return;
    }
    toast.success(correction.type === 'charge' ? t('pms.account.chargeVoided') : t('pms.account.paymentReversed'));
    setCorrection(null);
    setCorrectionReason('');
    await notifyChanged();
  };

  if (nativeAccess?.id !== reservation.id) return <p role="status" className="text-sm text-muted-foreground">{t('pms.loading')}</p>;
  if (!isNativePms) {
    // This is deliberately independent of the finance-core folio, which may be
    // empty on Previo hotels. Show only externally imported, trusted figures.
    return (
      <Card data-training="reservation-account" data-finance-mode="external-readonly">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Receipt className="h-4 w-4" /> {t('pms.account.title')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p role="status" className="text-sm text-muted-foreground" data-testid="external-ledger-readonly">
            {t('pms.account.externalReadOnly')}
          </p>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">{t('pms.account.importedBalance')}</p>
            <p className="text-lg font-semibold">
              {reservation.balance_due == null ? '—' : formatMoney(reservation.balance_due, reservation.currency || 'HUF')}
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            {t('pms.account.stayAmount')}: {reservation.total_amount == null ? '—' : formatMoney(reservation.total_amount, reservation.currency || 'HUF')}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card data-training="reservation-account">
        <CardContent className="py-8 text-center text-sm text-muted-foreground">{t('pms.account.loading')}</CardContent>
      </Card>
    );
  }

  if (loadError || !folio) {
    // The financial-core account is not deployed everywhere yet: fall back to
    // the guest folio that check-in/out and invoicing already use, so reception
    // can always see the bill, add extras and take payments.
    return <GuestFolioPanel reservation={reservation as never} onChanged={onFinancialChanged} />;
  }

  return (
    <>
      <Card data-training="reservation-account">
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base flex items-center gap-2"><Receipt className="h-4 w-4" /> {t('pms.account.title')}</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">{t('pms.account.summaryHint')}</p>
              {departed && <p className="text-xs font-medium text-amber-700">{t('pms.account.managerOnly')}</p>}
            </div>
            <div className="flex flex-wrap gap-2">
              {canManageCatalogue && (
                <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => setCatalogueOpen(true)}>
                  <Settings2 className="h-3.5 w-3.5" /> {t('pms.account.services')}
                </Button>
              )}
              <Button size="sm" variant="outline" className="gap-1.5" disabled={!postingAllowed} onClick={() => setChargeOpen(true)}>
                <Plus className="h-3.5 w-3.5" /> {t('pms.charge.add')}
              </Button>
              <Button size="sm" variant="outline" disabled={!postingAllowed} onClick={() => setManyOpen(true)}>{t('pms.account.postMany')}</Button>
              <Button
                size="sm"
                disabled={!postingAllowed}
                className="gap-1.5"
                onClick={() => {
                  setPayment((p) => ({ ...p, amount: summary.balance > 0 ? String(summary.balance) : '' }));
                  setPaymentOpen(true);
                }}
              >
                <Banknote className="h-3.5 w-3.5" /> {t('pms.pay.recordPayment')}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg border p-3">
              <p className="text-[11px] text-muted-foreground">{t('pms.account.charges')}</p>
              <p className="text-lg font-bold">{displayMoney(summary.charges, currency)}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-[11px] text-muted-foreground">{t('pms.account.paid')}</p>
              <p className="text-lg font-bold text-emerald-600">{displayMoney(summary.paid, currency)}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-[11px] text-muted-foreground">{t('pms.account.balance')}</p>
              <p className={`text-lg font-bold ${summary.balance > 0 ? 'text-destructive' : 'text-emerald-600'}`}>
                {displayMoney(summary.balance, currency)}
              </p>
            </div>
          </div>

          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold flex items-center gap-1.5"><BookOpen className="h-4 w-4" /> {t('pms.account.charges')}</h3>
              <span className="text-xs text-muted-foreground">{currency}</span>
            </div>
            <div className="rounded-md border divide-y">
              {Number(folio.base_reservation_amount || 0) > 0 && (
                <div className="grid grid-cols-[1fr_auto] gap-3 p-3 items-center bg-muted/20">
                  <div>
                    <p className="text-sm font-medium">{t('pms.account.reservationStay')}</p>
                    <p className="text-xs text-muted-foreground">{t('pms.account.taxPending')}</p>
                  </div>
                  <p className="text-sm font-semibold">{displayMoney(folio.base_reservation_amount, currency)}</p>
                </div>
              )}
              {lines.filter((line) => line.status !== 'voided').map((line) => (
                <div key={line.id} className="grid grid-cols-[1fr_auto_auto] gap-3 p-3 items-center">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{line.description}</p>
                    <p className="text-xs text-muted-foreground">
                      {locale.formatDate(line.service_date)} · {locale.formatNumber(Number(line.quantity))} {line.unit}
                      {' · '}{line.vat_rate === null ? line.vat_code : `VAT ${line.vat_rate}%`}
                    </p>
                  </div>
                  <p className="text-sm font-semibold">{displayMoney(line.gross_total, currency)}</p>
                  {line.status === 'open' ? (
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => setCorrection({ type: 'charge', id: line.id, label: line.description })}
                      aria-label={t('pms.account.voidCharge')}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  ) : <Badge variant="outline" className="text-[10px]">{line.status}</Badge>}
                </div>
              ))}
              {Number(folio.base_reservation_amount || 0) <= 0 && lines.filter((line) => line.status !== 'voided').length === 0 && (
                <p className="p-4 text-sm text-muted-foreground text-center">{t('pms.account.noCharges')}</p>
              )}
            </div>
          </section>

          <section>
            <h3 className="text-sm font-semibold flex items-center gap-1.5 mb-2"><CreditCard className="h-4 w-4" /> {t('pms.account.payments')}</h3>
            <div className="rounded-md border divide-y">
              {payments.filter((entry) => !['reversed', 'failed'].includes(entry.status)).length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground text-center">{t('pms.account.noPayments')}</p>
              ) : (
                payments.filter((entry) => !['reversed', 'failed'].includes(entry.status)).map((entry) => (
                  <div key={entry.id} className="grid grid-cols-[1fr_auto_auto] gap-3 p-3 items-center">
                    <div>
                      <p className="text-sm font-medium">{paymentLabel(entry.method)}</p>
                      <p className="text-xs text-muted-foreground">
                        {locale.formatDateTime(entry.received_at)}
                        {entry.reference ? ` · ${entry.reference}` : ''}
                      </p>
                    </div>
                    <p className="text-sm font-semibold text-emerald-600">−{displayMoney(entry.amount, entry.currency)}</p>
                    {['recorded', 'captured'].includes(entry.status) ? (
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => setCorrection({ type: 'payment', id: entry.id, label: paymentLabel(entry.method) })}
                        aria-label={t('pms.account.reversePayment')}
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
            {t('pms.account.fiscalPhase')}
          </div>
        </CardContent>
      </Card>

      <AddChargeDialog reservation={{...reservation,currency}} open={manyOpen && postingAllowed} onOpenChange={setManyOpen} catalogueOnly onAdded={() => { void notifyChanged(); }}/>
      <Dialog open={chargeOpen && postingAllowed} onOpenChange={setChargeOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('pms.charge.add')}</DialogTitle>
            <DialogDescription>{t('pms.account.chargeHint')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>{t('pms.account.service')}</Label>
              <Select value={charge.itemId} onValueChange={pickCatalogueItem}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={MANUAL_ITEM}>{t('pms.account.manualCharge')}</SelectItem>
                  {availableCatalogue.filter(item => item.ntak_main !== 'SZALLASDIJ' && (!item.requires_manager_approval || canManageCatalogue)).map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name} · {displayMoney(item.default_gross_price, item.currency)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{t('pms.account.description')}</Label>
              <Input value={charge.description} onChange={(e) => setCharge((v) => ({ ...v, description: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <Label>{t('pms.charge.qty')}</Label>
                <Input type="number" min="0.001" step="0.001" value={charge.quantity} onChange={(e) => setCharge((v) => ({ ...v, quantity: e.target.value }))} />
              </div>
              <div>
                <Label>{t('pms.account.unit')}</Label>
                <Input value={charge.unit} onChange={(e) => setCharge((v) => ({ ...v, unit: e.target.value }))} />
              </div>
              <div>
                <Label>{t('pms.account.grossUnit')}</Label>
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
                <Label>{t('pms.account.vatPercent')}</Label>
                <Input type="number" min="0" max="100" step="0.01" placeholder={t('pms.account.specialVat')} value={charge.vatRate} onChange={(e) => setCharge((v) => ({ ...v, vatRate: e.target.value }))} />
              </div>
            </div>
            <BusinessDayField hotelId={reservation.hotel_id} value={chargeDay} onChange={setChargeDay} />
            <div>
              <Label>{t('pms.account.vatCode')}</Label>
              <Input value={charge.vatCode} onChange={(e) => setCharge((v) => ({ ...v, vatCode: e.target.value }))} />
              {charge.vatCode === 'REVIEW_REQUIRED' && <p className="text-[11px] text-amber-700 mt-1">{t('pms.account.taxReview')}</p>}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setChargeOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={() => void submitCharge()} disabled={busy}>{t('pms.charge.add')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={paymentOpen && postingAllowed} onOpenChange={setPaymentOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('pms.pay.recordPayment')}</DialogTitle>
            <DialogDescription>{t('pms.account.paymentHint')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>{t('pms.account.amount').replace('{currency}', currency)}</Label>
              <Input type="number" min="0.01" step="0.01" value={payment.amount} onChange={(e) => setPayment((v) => ({ ...v, amount: e.target.value }))} />
            </div>
            <div>
              <Label>{t('pms.account.method')}</Label>
              <Select value={payment.method} onValueChange={(method) => setPayment((v) => ({ ...v, method }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PMS_PAYMENT_METHODS.map((method) => <SelectItem key={method} value={method}>{paymentLabel(method)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{t('pms.account.reference')}</Label>
              <Input value={payment.reference} onChange={(e) => setPayment((v) => ({ ...v, reference: e.target.value }))} placeholder={t('pms.account.referenceHint')} />
            </div>
            <BusinessDayField hotelId={reservation.hotel_id} value={paymentDay} onChange={setPaymentDay} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaymentOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={() => void submitPayment()} disabled={busy}>{t('pms.pay.recordPayment')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={catalogueOpen} onOpenChange={setCatalogueOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('pms.account.catalogue')}</DialogTitle>
            <DialogDescription>{t('pms.account.catalogueHint')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid sm:grid-cols-6 gap-2">
              <Input className="sm:col-span-2" placeholder={t('pms.account.serviceName')} value={catalogueForm.name} onChange={(e) => setCatalogueForm((v) => ({ ...v, name: e.target.value }))} />
              <Input placeholder={t('pms.account.category')} value={catalogueForm.category} onChange={(e) => setCatalogueForm((v) => ({ ...v, category: e.target.value }))} />
              <Input placeholder={t('pms.account.unit')} value={catalogueForm.unit} onChange={(e) => setCatalogueForm((v) => ({ ...v, unit: e.target.value }))} />
              <Input type="number" min="0" step="0.01" placeholder={t('pms.account.grossCurrency').replace('{currency}', currency)} value={catalogueForm.grossPrice} onChange={(e) => setCatalogueForm((v) => ({ ...v, grossPrice: e.target.value }))} />
              <Input type="number" min="0" max="100" step="0.01" placeholder={t('pms.account.vatPercent')} value={catalogueForm.vatRate} onChange={(e) => setCatalogueForm((v) => ({ ...v, vatRate: e.target.value }))} />
            </div>
            <div className="grid sm:grid-cols-2 gap-2">
              <Select value={catalogueForm.ntakMain || '__none__'} onValueChange={(value) => setCatalogueForm(v => ({ ...v, ntakMain: value === '__none__' ? '' : value, ntakSub: '', inPackage: value === 'SZALLASDIJ' }))}>
                <SelectTrigger><SelectValue placeholder={t('ntak.phase5.category')} /></SelectTrigger>
                <SelectContent><SelectItem value="__none__">{t('pms.account.ntakAutomatic')}</SelectItem>{Object.keys(CATEGORIES).map(code => <SelectItem key={code} value={code}>{code}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={catalogueForm.ntakSub} disabled={!(CATEGORIES[catalogueForm.ntakMain as keyof typeof CATEGORIES]?.length)} onValueChange={value => setCatalogueForm(v => ({ ...v, ntakSub: value }))}>
                <SelectTrigger><SelectValue placeholder={t('pms.account.ntakSubcategory')} /></SelectTrigger>
                <SelectContent>{(CATEGORIES[catalogueForm.ntakMain as keyof typeof CATEGORIES] || []).map(code => <SelectItem key={code} value={code}>{code}</SelectItem>)}</SelectContent>
              </Select>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={catalogueForm.inPackage} disabled={!catalogueForm.ntakMain || ['SZALLASDIJ','IFA'].includes(catalogueForm.ntakMain)} onChange={e => setCatalogueForm(v => ({ ...v, inPackage: e.target.checked }))} />
                {t('pms.account.inPackage')}
              </label>
            </div>
            <div className="flex gap-2">
              <Input placeholder={t('pms.account.vatCode')} value={catalogueForm.vatCode} onChange={(e) => setCatalogueForm((v) => ({ ...v, vatCode: e.target.value }))} />
              <Button onClick={() => void createCatalogueItem()} disabled={busy}>{t('pms.account.addService')}</Button>
            </div>
            <div className="rounded-md border divide-y">
              {availableCatalogue.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground text-center">{t('pms.account.noServices')}</p>
              ) : availableCatalogue.map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-3 p-3">
                  <div>
                    <p className="text-sm font-medium">{item.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.category} · {item.unit} · {item.vat_rate === null ? item.vat_code : `VAT ${item.vat_rate}%`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{displayMoney(item.default_gross_price, item.currency)}</span>
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => void deactivateCatalogueItem(item.id)}>{t('pms.account.deactivate')}</Button>
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
            <DialogTitle>{correction?.type === 'charge' ? t('pms.account.voidCharge') : t('pms.account.reversePayment')}</DialogTitle>
            <DialogDescription>
              {t('pms.account.correctionHint').replace('{item}', correction?.label || t('pms.account.thisItem'))}
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label>{t('pms.account.reason')}</Label>
            <Input value={correctionReason} onChange={(e) => setCorrectionReason(e.target.value)} autoFocus />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCorrection(null); setCorrectionReason(''); }}>{t('common.cancel')}</Button>
            <Button variant="destructive" onClick={() => void confirmCorrection()} disabled={busy || !correctionReason.trim()}>
              {t('pms.account.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
