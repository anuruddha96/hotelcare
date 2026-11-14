import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { FileText, Loader2, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { formatMoney, reservationGuestLabel } from '@/lib/reservations';
import { todayBudapest } from '@/lib/budapestTime';

/**
 * Issue Számlázz.hu documents (proforma / invoice / storno / PDF) for one
 * reservation through the szamlazz-invoice edge function. Reception confirms
 * every line and the buyer before anything is sent; the Agent key stays on
 * the server.
 */

interface InvoiceDialogProps {
  reservation: { id: string; hotel_id: string; currency?: string | null } & Record<string, unknown>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onIssued?: () => void;
}

interface InvoiceIssuerSummary { legal_name: string; environment: 'test' | 'live'; invoice_prefix: string; connection_mode: string; enabled: boolean }
interface EditableLine { description: string; quantity: number; unit: string; gross_unit_price: number; vat_key: string }
interface ExistingInvoice {
  id: string; kind: string; status: string; invoice_number: string | null; currency: string;
  gross_total: number; issued_at: string | null; error_message: string | null; origin_invoice_id: string | null;
}

const VAT_CHOICES = ['5', '18', '27', '0', 'AAM', 'TAM', 'THK'] as const;
const METHOD_KEYS: Array<{ value: string; key: string }> = [
  { value: 'készpénz', key: 'pms.pay.cash' },
  { value: 'bankkártya', key: 'pms.pay.card' },
  { value: 'átutalás', key: 'pms.pay.transfer' },
  { value: 'SZÉP kártya', key: 'pms.pay.szep' },
];

async function callInvoiceFn(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('szamlazz-invoice', { body });
  if (error) {
    // supabase-js hides non-2xx bodies behind FunctionsHttpError; surface the server message.
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      const parsed = await ctx.json().catch(() => null) as { error?: string } | null;
      if (parsed?.error) throw new Error(parsed.error);
    }
    throw new Error(error.message || 'Request failed');
  }
  if (data && data.ok === false) throw new Error(String(data.error ?? 'Request failed'));
  return data as Record<string, unknown>;
}

export function InvoiceDialog({ reservation, open, onOpenChange, onIssued }: InvoiceDialogProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [issuer, setIssuer] = useState<InvoiceIssuerSummary | null>(null);
  const [canIssue, setCanIssue] = useState(false);
  const [eInvoice, setEInvoice] = useState(true);
  const [invoiceLanguage, setInvoiceLanguage] = useState('hu');
  const [dueDate, setDueDate] = useState(todayBudapest());
  const [invoices, setInvoices] = useState<ExistingInvoice[]>([]);
  const [lines, setLines] = useState<EditableLine[]>([]);
  const [currency, setCurrency] = useState<string>(String(reservation.currency ?? 'HUF'));
  const [buyer, setBuyer] = useState({ name: '', zip: '', city: '', address: '', email: '', tax_number: '' });
  const [method, setMethod] = useState('bankkártya');
  const [emailInvoice, setEmailInvoice] = useState(false);
  const [markPaid, setMarkPaid] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [status, prepare] = await Promise.all([
        callInvoiceFn({ action: 'status', hotel_id: reservation.hotel_id, reservation_id: reservation.id }),
        callInvoiceFn({ action: 'prepare', hotel_id: reservation.hotel_id, reservation_id: reservation.id }),
      ]);
      setConfigured(status.configured === true);
      const selectedIssuer = (status.issuer ?? null) as InvoiceIssuerSummary | null;
      setIssuer(selectedIssuer);
      setCanIssue(status.can_issue === true);
      setInvoiceLanguage(String((selectedIssuer as {language?: string} | null)?.language ?? 'hu'));
      setInvoices((status.invoices ?? []) as ExistingInvoice[]);
      setCurrency(String(prepare.currency ?? 'HUF'));
      setLines(((prepare.suggested_lines ?? []) as EditableLine[]).map((l) => ({
        description: String(l.description ?? ''), quantity: Number(l.quantity ?? 1),
        unit: String(l.unit ?? 'db'), gross_unit_price: Number(l.gross_unit_price ?? 0), vat_key: String(l.vat_key ?? '27'),
      })));
      const suggested = (prepare.suggested_buyer ?? {}) as { name?: string; email?: string };
      setBuyer((b) => (b.name ? b : { ...b, name: suggested.name ?? '', email: suggested.email ?? '' }));
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [reservation.id, reservation.hotel_id]);

  useEffect(() => { if (open) void refresh(); }, [open, refresh]);

  const total = lines.reduce((sum, l) => sum + l.quantity * l.gross_unit_price, 0);
  const setLine = (index: number, patch: Partial<EditableLine>) =>
    setLines((all) => all.map((l, i) => (i === index ? { ...l, ...patch } : l)));

  const issue = async (kind: 'invoice' | 'proforma') => {
    setBusy(kind);
    try {
      const result = await callInvoiceFn({
        action: 'issue', hotel_id: reservation.hotel_id, reservation_id: reservation.id, kind,
        lines, buyer: { ...buyer, send_email: emailInvoice }, payment_method: method, currency,
        language: invoiceLanguage, due_date: dueDate, e_invoice: eInvoice && kind === 'invoice',
        paid: kind === 'invoice' && markPaid, email_invoice: emailInvoice,
      });
      toast.success(`${t(kind === 'invoice' ? 'pms.inv.issueInvoice' : 'pms.inv.issueProforma')} ✓ ${result.invoice_number ?? ''}`);
      onIssued?.();
      await refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const openPdf = async (invoiceId: string) => {
    setBusy(`pdf:${invoiceId}`);
    try {
      const result = await callInvoiceFn({ action: 'pdf', hotel_id: reservation.hotel_id, invoice_id: invoiceId });
      const bytes = Uint8Array.from(atob(String(result.pdf_base64)), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const storno = async (invoiceId: string) => {
    if (!window.confirm(t('pms.inv.stornoConfirm'))) return;
    setBusy(`storno:${invoiceId}`);
    try {
      await callInvoiceFn({ action: 'storno', hotel_id: reservation.hotel_id, invoice_id: invoiceId });
      toast.success(`${t('pms.inv.storno')} ✓`);
      await refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto" data-training="fd-invoice-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" /> {t('pms.inv.title')} · {reservationGuestLabel(reservation)}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center gap-2 py-8 justify-center text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> {t('pms.loading')}
          </div>
        ) : configured === false ? (
          <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-3 text-sm text-amber-900 dark:text-amber-200 space-y-2">
            <p className="font-semibold">Invoice issuing is not enabled for this hotel.</p>
            <p>{issuer ? issuer.legal_name + ' is assigned but disabled or missing provider credentials.' : 'No legal invoicing company has been assigned to this property.'}</p>
            <p>Ask your organization administrator to configure Számlázz.hu under Account → Legal companies & invoicing.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {issuer && <div className="rounded-lg border bg-muted/30 px-3 py-2.5 flex flex-wrap items-center justify-between gap-2 text-sm" data-training="fd-invoice-issuer">
              <div><p className="text-xs text-muted-foreground">Invoice issued by</p>
                <p className="font-semibold">{issuer.legal_name}</p></div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={issuer.environment === 'test' ? 'secondary' : 'default'}>{issuer.environment === 'test' ? 'TEST — sample documents only' : 'LIVE — legal invoice'}</Badge>
                {issuer.invoice_prefix && <Badge variant="outline">Prefix: {issuer.invoice_prefix}</Badge>}
              </div>
            </div>}
            {invoices.length > 0 && (
              <div className="rounded-lg border border-border">
                <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wide bg-muted/45">{t('pms.inv.existing')}</p>
                <div className="divide-y divide-border/70">
                  {invoices.map((inv) => (
                    <div key={inv.id} className="px-3 py-2 flex items-center gap-2 text-sm">
                      <Badge variant={inv.status === 'issued' ? 'default' : inv.status === 'failed' ? 'destructive' : 'secondary'}>
                        {inv.kind}{inv.status === 'issued' ? '' : ` · ${t(inv.status === 'failed' ? 'pms.inv.failed' : 'pms.loading')}`}
                      </Badge>
                      <span className="font-medium">{inv.invoice_number ?? '—'}</span>
                      <span className="text-muted-foreground">{formatMoney(Number(inv.gross_total), inv.currency)}</span>
                      {inv.error_message && <span className="text-xs text-destructive truncate" title={inv.error_message}>{inv.error_message}</span>}
                      <span className="ml-auto flex gap-1.5">
                        {inv.status === 'issued' && (
                          <Button type="button" size="sm" variant="outline" className="h-7 text-xs" disabled={busy !== null} onClick={() => openPdf(inv.id)}>
                            {busy === `pdf:${inv.id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : t('pms.inv.openPdf')}
                          </Button>
                        )}
                        {inv.status === 'issued' && inv.kind === 'invoice' && (
                          <Button type="button" size="sm" variant="outline" className="h-7 text-xs text-destructive" disabled={busy !== null} onClick={() => storno(inv.id)}>
                            {busy === `storno:${inv.id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : t('pms.inv.storno')}
                          </Button>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('pms.inv.buyer')}</p>
              <div className="grid grid-cols-2 gap-2.5">
                <div className="col-span-2">
                  <Label className="text-xs">{t('pms.inv.name')} *</Label>
                  <Input className="h-8" value={buyer.name} onChange={(e) => setBuyer({ ...buyer, name: e.target.value })} />
                </div>
                <div>
                  <Label className="text-xs">{t('pms.inv.zip')} *</Label>
                  <Input className="h-8" value={buyer.zip} onChange={(e) => setBuyer({ ...buyer, zip: e.target.value })} />
                </div>
                <div>
                  <Label className="text-xs">{t('pms.inv.city')} *</Label>
                  <Input className="h-8" value={buyer.city} onChange={(e) => setBuyer({ ...buyer, city: e.target.value })} />
                </div>
                <div className="col-span-2">
                  <Label className="text-xs">{t('pms.inv.address')} *</Label>
                  <Input className="h-8" value={buyer.address} onChange={(e) => setBuyer({ ...buyer, address: e.target.value })} />
                </div>
                <div>
                  <Label className="text-xs">Email</Label>
                  <Input className="h-8" type="email" value={buyer.email} onChange={(e) => setBuyer({ ...buyer, email: e.target.value })} />
                </div>
                <div>
                  <Label className="text-xs">{t('pms.inv.taxNumber')}</Label>
                  <Input className="h-8" value={buyer.tax_number} onChange={(e) => setBuyer({ ...buyer, tax_number: e.target.value })} />
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('pms.inv.lines')} · {currency}</p>
              <div className="space-y-1.5 overflow-x-auto">
                <div className="grid min-w-[610px] grid-cols-[1fr_64px_72px_96px_88px_28px] gap-1.5 text-[11px] text-muted-foreground px-0.5">
                  <span>{t('pms.inv.description')}</span><span>{t('pms.inv.qty')}</span><span>Unit</span><span>{t('pms.inv.unitPrice')}</span><span>{t('pms.inv.vat')}</span><span />
                </div>
                {lines.map((l, i) => (
                  <div key={i} className="grid min-w-[610px] grid-cols-[1fr_64px_72px_96px_88px_28px] gap-1.5 items-center">
                    <Input className="h-8" value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} />
                    <Input className="h-8" type="number" min={0.001} step="any" value={l.quantity} onChange={(e) => setLine(i, { quantity: Number(e.target.value) })} />
                    <Input className="h-8" value={l.unit} onChange={(e) => setLine(i, { unit: e.target.value })} />
                    <Input className="h-8" type="number" step="any" value={l.gross_unit_price} onChange={(e) => setLine(i, { gross_unit_price: Number(e.target.value) })} />
                    <Select value={l.vat_key} onValueChange={(v) => setLine(i, { vat_key: v })}>
                      <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                      <SelectContent>{VAT_CHOICES.map((v) => <SelectItem key={v} value={v}>{v}{/^\d+$/.test(v) ? '%' : ''}</SelectItem>)}</SelectContent>
                    </Select>
                    <Button type="button" size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground" onClick={() => setLines((all) => all.filter((_, j) => j !== i))}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between">
                <Button type="button" size="sm" variant="outline" className="h-8 gap-1" onClick={() => setLines((all) => [...all, { description: '', quantity: 1, unit: 'db', gross_unit_price: 0, vat_key: '27' }])}>
                  <Plus className="h-3.5 w-3.5" /> {t('pms.inv.addLine')}
                </Button>
                <p className="text-sm">{t('pms.inv.total')}: <span className="font-semibold">{formatMoney(total, currency)}</span></p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <div className="min-w-[130px]"><Label className="text-xs">Invoice language</Label>
                <Select value={invoiceLanguage} onValueChange={setInvoiceLanguage}>
                  <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>{[['hu','Magyar'],['en','English'],['de','Deutsch'],['fr','Français'],['it','Italiano'],['es','Español']].map(([code,name]) =>
                    <SelectItem key={code} value={code}>{name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs">Payment due date</Label>
                <Input className="h-8 w-40" type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
              </div>
              <label className="flex items-center gap-2 text-xs mt-4 cursor-pointer">
                <Checkbox checked={eInvoice} onCheckedChange={c => setEInvoice(!!c)} /> Electronic invoice (e-számla)
              </label>
              <div>
                <Label className="text-xs">{t('pms.pay.method')}</Label>
                <Select value={method} onValueChange={setMethod}>
                  <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
                  <SelectContent>{METHOD_KEYS.map((m) => <SelectItem key={m.value} value={m.value}>{t(m.key)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <label className="flex items-center gap-2 text-xs mt-4 cursor-pointer">
                <Checkbox checked={markPaid} onCheckedChange={(c) => setMarkPaid(!!c)} /> {t('pms.inv.markPaid')}
              </label>
              <label className="flex items-center gap-2 text-xs mt-4 cursor-pointer">
                <Checkbox checked={emailInvoice} onCheckedChange={(c) => setEmailInvoice(!!c)} disabled={!buyer.email} /> {t('pms.inv.emailInvoice')}
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
              <Button type="button" variant="outline" disabled={!canIssue || busy !== null || lines.length === 0 || !dueDate} onClick={() => issue('proforma')} className="gap-1">
                {busy === 'proforma' && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {t('pms.inv.issueProforma')}
              </Button>
              <Button type="button" disabled={!canIssue || busy !== null || lines.length === 0 || !dueDate} onClick={() => issue('invoice')} className="gap-1" data-training="fd-invoice-issue">
                {busy === 'invoice' && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {t('pms.inv.issueInvoice')}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
