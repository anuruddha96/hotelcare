import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Loader2, Plus, Trash2, CheckCircle2, FileText } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { toast } from 'sonner';

const EDIT_ROLES = ['admin', 'top_management', 'control_finance', 'back_office_manager', 'control_manager'];

const VAT_KINDS = [
  'standard_27', 'reduced_18', 'reduced_5', 'zero',
  'aam_exempt', 'kba_reverse', 'eu_intra', 'export', 'foreign',
];

interface VatLine {
  id?: string;
  vat_kind: string;
  vat_rate: number;
  vat_base: number;
  vat_amount: number;
  country?: string | null;
}
interface ItemLine {
  id?: string;
  position: number;
  name_original?: string | null;
  name_english?: string | null;
  quantity?: number | null;
  unit_price?: number | null;
  total_price?: number | null;
  vat_rate?: number | null;
  item_type?: string | null;
}

interface Props {
  invoiceId: string | null;
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

export function VerifyInvoiceDialog({ invoiceId, open, onClose, onSaved }: Props) {
  const { profile, user } = useAuth();
  const { t } = useTranslation();
  const canEdit = !!profile && EDIT_ROLES.includes(profile.role);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [invoice, setInvoice] = useState<any | null>(null);
  const [vatLines, setVatLines] = useState<VatLine[]>([]);
  const [items, setItems] = useState<ItemLine[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [externalUrl, setExternalUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !invoiceId) return;
    let cancelled = false;
    let createdObjectUrl: string | null = null;
    (async () => {
      setLoading(true);
      try {
        const [{ data: inv }, { data: vats }, { data: its }] = await Promise.all([
          supabase.from('purchase_invoices').select('*').eq('id', invoiceId).maybeSingle(),
          supabase.from('purchase_invoice_vat_lines').select('*').eq('invoice_id', invoiceId),
          supabase.from('purchase_invoice_items').select('*').eq('invoice_id', invoiceId).order('position'),
        ]);
        if (cancelled) return;
        setInvoice(inv);
        setVatLines((vats as any) || []);
        setItems((its as any) || []);
        if (inv?.file_path) {
          // Live in-dialog preview via a Blob URL — iframes render PDFs from
          // blob: URLs reliably across browsers, unlike signed storage URLs.
          const [{ data: blob }, { data: signed }] = await Promise.all([
            supabase.storage.from('purchase-invoices').download(inv.file_path),
            supabase.storage.from('purchase-invoices').createSignedUrl(inv.file_path, 3600),
          ]);
          if (!cancelled) {
            if (blob) {
              createdObjectUrl = URL.createObjectURL(blob);
              setPreviewUrl(createdObjectUrl);
            } else if (signed?.signedUrl) {
              setPreviewUrl(signed.signedUrl);
            }
            setExternalUrl(signed?.signedUrl || null);
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (createdObjectUrl) URL.revokeObjectURL(createdObjectUrl);
    };
  }, [open, invoiceId]);

  const update = (patch: Partial<any>) => setInvoice((p: any) => ({ ...p, ...patch }));
  const updateVat = (i: number, patch: Partial<VatLine>) =>
    setVatLines(v => v.map((x, idx) => idx === i ? { ...x, ...patch } : x));
  const updateItem = (i: number, patch: Partial<ItemLine>) =>
    setItems(v => v.map((x, idx) => idx === i ? { ...x, ...patch } : x));

  const addVat = () => setVatLines(v => [...v, { vat_kind: 'standard_27', vat_rate: 27, vat_base: 0, vat_amount: 0 }]);
  const removeVat = (i: number) => setVatLines(v => v.filter((_, idx) => idx !== i));
  const addItem = () => setItems(v => [...v, { position: v.length + 1, name_original: '', quantity: 1, unit_price: 0, total_price: 0, vat_rate: 27 }]);
  const removeItem = (i: number) => setItems(v => v.filter((_, idx) => idx !== i));

  const save = async (markVerified: boolean) => {
    if (!invoice || !invoiceId || !user) return;
    setSaving(true);
    try {
      const { error: upErr } = await supabase.from('purchase_invoices').update({
        merchant_name: invoice.merchant_name,
        merchant_tax_id: invoice.merchant_tax_id,
        merchant_address: invoice.merchant_address,
        merchant_country: invoice.merchant_country,
        buyer_name: invoice.buyer_name,
        buyer_tax_id: invoice.buyer_tax_id,
        buyer_address: invoice.buyer_address,
        invoice_number: invoice.invoice_number,
        invoice_date: invoice.invoice_date || null,
        due_date: invoice.due_date || null,
        performance_date: invoice.performance_date || null,
        currency: invoice.currency || 'HUF',
        net_amount: invoice.net_amount,
        total_vat_amount: invoice.total_vat_amount,
        total_amount: invoice.total_amount,
        expense_category: invoice.expense_category,
        payment_method: invoice.payment_method,
        bottle_deposit_amount: invoice.bottle_deposit_amount,
        notes: invoice.notes,
        ...(markVerified ? {
          is_verified: true,
          verified_by: user.id,
          verified_at: new Date().toISOString(),
          status: 'verified',
          needs_review: false,
        } : {}),
      }).eq('id', invoiceId);
      if (upErr) throw upErr;

      // Replace VAT lines
      await supabase.from('purchase_invoice_vat_lines').delete().eq('invoice_id', invoiceId);
      if (vatLines.length) {
        const { error } = await supabase.from('purchase_invoice_vat_lines').insert(
          vatLines.map(v => ({
            invoice_id: invoiceId,
            vat_kind: v.vat_kind,
            vat_rate: Number(v.vat_rate) || 0,
            vat_base: Number(v.vat_base) || 0,
            vat_amount: Number(v.vat_amount) || 0,
            country: v.country || null,
          }))
        );
        if (error) throw error;
      }

      // Replace items
      await supabase.from('purchase_invoice_items').delete().eq('invoice_id', invoiceId);
      if (items.length) {
        const { error } = await supabase.from('purchase_invoice_items').insert(
          items.map((it, idx) => ({
            invoice_id: invoiceId,
            position: idx + 1,
            name_original: it.name_original || null,
            name_english: it.name_english || null,
            quantity: it.quantity != null ? Number(it.quantity) : null,
            unit_price: it.unit_price != null ? Number(it.unit_price) : null,
            total_price: it.total_price != null ? Number(it.total_price) : null,
            vat_rate: it.vat_rate != null ? Number(it.vat_rate) : null,
            item_type: it.item_type || null,
          }))
        );
        if (error) throw error;
      }

      toast.success(markVerified ? t('pi.status.verified') : t('pi.upload.success'));
      onSaved?.();
      onClose();
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || t('pi.upload.failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-5xl w-[95vw] h-[90vh] p-0 flex flex-col gap-0">
        <DialogHeader className="px-6 py-4 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            {t('pi.preview.heading')}
            {invoice?.is_verified && (
              <Badge variant="default" className="ml-2 gap-1">
                <CheckCircle2 className="h-3 w-3" />{t('pi.status.verified')}
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : !invoice ? (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">—</div>
        ) : (
          <div className="flex-1 min-h-0 grid md:grid-cols-2 gap-0 overflow-hidden">
            {/* Document preview */}
            <div className="border-r bg-muted/30 flex flex-col min-h-0">
              {previewUrl ? (
                <>
                  <div className="px-3 py-2 border-b bg-background/80 flex items-center justify-between gap-2 shrink-0">
                    <span className="text-xs text-muted-foreground truncate">
                      {invoice.file_mime || 'file'} · {invoice.file_path?.split('/').pop()}
                    </span>
                    <a
                      href={externalUrl || previewUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary hover:underline shrink-0"
                    >
                      Open in new tab
                    </a>
                  </div>
                  <div className="flex-1 min-h-0 overflow-auto">
                    {(invoice.file_mime?.includes('pdf') || invoice.file_path?.toLowerCase().endsWith('.pdf')) ? (
                      <iframe
                        src={previewUrl}
                        className="w-full h-full border-0"
                        style={{ minHeight: '600px' }}
                        title="invoice"
                      />
                    ) : (invoice.file_mime?.startsWith('image/') || /\.(jpe?g|png|webp|gif|heic)$/i.test(invoice.file_path || '')) ? (
                      <img src={previewUrl} alt="invoice" className="w-full h-auto" />
                    ) : (
                      <div className="p-6 text-sm text-muted-foreground">
                        Preview unavailable for this file type. Use “Open in new tab”.
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center p-6 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading preview…
                </div>
              )}
            </div>

            {/* Editable fields */}
            <div className="flex flex-col min-h-0">
              <Tabs defaultValue="header" className="flex-1 flex flex-col min-h-0">
                <TabsList className="mx-4 mt-3 shrink-0">
                  <TabsTrigger value="header">{t('pi.field.merchant')}</TabsTrigger>
                  <TabsTrigger value="vat">{t('pi.vat.heading')}</TabsTrigger>
                  <TabsTrigger value="items">{t('pi.items.heading')}</TabsTrigger>
                </TabsList>

                <TabsContent value="header" className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3 mt-0">
                  {(invoice.is_credit_note || invoice.duplicate_status === 'suspected' || invoice.duplicate_status === 'credit_note') && (
                    <div className={`rounded-md border p-2.5 text-xs space-y-1 ${
                      invoice.duplicate_status === 'suspected' ? 'border-destructive/40 bg-destructive/5'
                      : 'border-amber-500/40 bg-amber-500/5'
                    }`}>
                      {invoice.is_credit_note && <div><strong>Credit note</strong> — total is negative.</div>}
                      {invoice.duplicate_status === 'suspected' && (
                        <div>⚠ Suspected duplicate of an existing invoice (same merchant + invoice number).</div>
                      )}
                      {invoice.duplicate_status === 'credit_note' && (
                        <div>This credit note matches an earlier invoice.</div>
                      )}
                      {invoice.duplicate_of && (
                        <div className="text-muted-foreground">Original ID: <code className="text-[10px]">{invoice.duplicate_of}</code></div>
                      )}
                    </div>
                  )}
                  <Field label={t('pi.field.merchant')} value={invoice.merchant_name} onChange={v => update({ merchant_name: v })} disabled={!canEdit} />
                  <div className="grid grid-cols-2 gap-3">
                    <Field label={t('pi.field.taxId')} value={invoice.merchant_tax_id} onChange={v => update({ merchant_tax_id: v })} disabled={!canEdit} />
                    <Field label="Country" value={invoice.merchant_country} onChange={v => update({ merchant_country: v })} disabled={!canEdit} />
                  </div>
                  <Field label="Address" value={invoice.merchant_address} onChange={v => update({ merchant_address: v })} disabled={!canEdit} />
                  <div className="rounded-md border border-dashed p-3 space-y-2">
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">Buyer (Vevő)</div>
                    <Field label="Buyer name" value={invoice.buyer_name} onChange={v => update({ buyer_name: v })} disabled={!canEdit} />
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Buyer tax ID" value={invoice.buyer_tax_id} onChange={v => update({ buyer_tax_id: v })} disabled={!canEdit} />
                      <Field label="Buyer address" value={invoice.buyer_address} onChange={v => update({ buyer_address: v })} disabled={!canEdit} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label={t('pi.field.invoiceNumber')} value={invoice.invoice_number} onChange={v => update({ invoice_number: v })} disabled={!canEdit} />
                    <Field label={t('pi.field.currency')} value={invoice.currency} onChange={v => update({ currency: v })} disabled={!canEdit} />
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <Field type="date" label={t('pi.field.invoiceDate')} value={invoice.invoice_date} onChange={v => update({ invoice_date: v })} disabled={!canEdit} />
                    <Field type="date" label={t('pi.field.dueDate')} value={invoice.due_date} onChange={v => update({ due_date: v })} disabled={!canEdit} />
                    <Field type="date" label="Performance" value={invoice.performance_date} onChange={v => update({ performance_date: v })} disabled={!canEdit} />
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <Field type="number" label={t('pi.field.net')} value={invoice.net_amount} onChange={v => update({ net_amount: v })} disabled={!canEdit} />
                    <Field type="number" label={t('pi.field.vat')} value={invoice.total_vat_amount} onChange={v => update({ total_vat_amount: v })} disabled={!canEdit} />
                    <Field type="number" label={t('pi.field.total')} value={invoice.total_amount} onChange={v => update({ total_amount: v })} disabled={!canEdit} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label={t('pi.field.category')} value={invoice.expense_category} onChange={v => update({ expense_category: v })} disabled={!canEdit} />
                    <Field label="Payment method" value={invoice.payment_method} onChange={v => update({ payment_method: v })} disabled={!canEdit} />
                  </div>
                  <Field label="Notes" value={invoice.notes} onChange={v => update({ notes: v })} disabled={!canEdit} />
                </TabsContent>

                <TabsContent value="vat" className="flex-1 min-h-0 overflow-y-auto px-4 py-3 mt-0">
                  <div className="space-y-2">
                    {vatLines.map((v, i) => (
                      <div key={i} className="grid grid-cols-[1fr_70px_1fr_1fr_auto] gap-2 items-center">
                        <select
                          className="h-9 rounded-md border bg-background px-2 text-sm"
                          value={v.vat_kind} disabled={!canEdit}
                          onChange={(e) => updateVat(i, { vat_kind: e.target.value })}>
                          {VAT_KINDS.map(k => (
                            <option key={k} value={k}>{t(`pi.vat.kind.${k}`)}</option>
                          ))}
                        </select>
                        <Input type="number" value={v.vat_rate ?? 0} disabled={!canEdit}
                          onChange={(e) => updateVat(i, { vat_rate: Number(e.target.value) })} />
                        <Input type="number" placeholder="Base" value={v.vat_base ?? 0} disabled={!canEdit}
                          onChange={(e) => updateVat(i, { vat_base: Number(e.target.value) })} />
                        <Input type="number" placeholder="VAT" value={v.vat_amount ?? 0} disabled={!canEdit}
                          onChange={(e) => updateVat(i, { vat_amount: Number(e.target.value) })} />
                        {canEdit && (
                          <Button size="icon" variant="ghost" onClick={() => removeVat(i)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    ))}
                    {canEdit && (
                      <Button variant="outline" size="sm" onClick={addVat}>
                        <Plus className="h-4 w-4 mr-1" /> Add VAT line
                      </Button>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="items" className="flex-1 min-h-0 overflow-y-auto px-4 py-3 mt-0">
                  <div className="space-y-2">
                    {items.map((it, i) => (
                      <div key={i} className="grid grid-cols-[1fr_60px_80px_80px_60px_auto] gap-2 items-center">
                        <Input placeholder="Name" value={it.name_original ?? ''} disabled={!canEdit}
                          onChange={(e) => updateItem(i, { name_original: e.target.value })} />
                        <Input type="number" placeholder="Qty" value={it.quantity ?? ''} disabled={!canEdit}
                          onChange={(e) => updateItem(i, { quantity: Number(e.target.value) })} />
                        <Input type="number" placeholder="Unit" value={it.unit_price ?? ''} disabled={!canEdit}
                          onChange={(e) => updateItem(i, { unit_price: Number(e.target.value) })} />
                        <Input type="number" placeholder="Total" value={it.total_price ?? ''} disabled={!canEdit}
                          onChange={(e) => updateItem(i, { total_price: Number(e.target.value) })} />
                        <Input type="number" placeholder="VAT%" value={it.vat_rate ?? ''} disabled={!canEdit}
                          onChange={(e) => updateItem(i, { vat_rate: Number(e.target.value) })} />
                        {canEdit && (
                          <Button size="icon" variant="ghost" onClick={() => removeItem(i)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    ))}
                    {canEdit && (
                      <Button variant="outline" size="sm" onClick={addItem}>
                        <Plus className="h-4 w-4 mr-1" /> Add item
                      </Button>
                    )}
                  </div>
                </TabsContent>
              </Tabs>

              <div className="border-t px-4 py-3 flex items-center justify-end gap-2 shrink-0 bg-background">
                <Button variant="ghost" onClick={onClose} disabled={saving}>Close</Button>
                {canEdit && (
                  <>
                    <Button variant="outline" onClick={() => save(false)} disabled={saving}>
                      {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                      {t('pi.upload.saveDraft')}
                    </Button>
                    <Button onClick={() => save(true)} disabled={saving}>
                      {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                      {t('pi.upload.save')}
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label, value, onChange, disabled, type = 'text',
}: {
  label: string;
  value: any;
  onChange: (v: any) => void;
  disabled?: boolean;
  type?: string;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        type={type}
        value={value ?? ''}
        disabled={disabled}
        onChange={(e) => onChange(type === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value)}
      />
    </div>
  );
}
