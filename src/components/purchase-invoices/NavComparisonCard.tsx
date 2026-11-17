/* eslint-disable @typescript-eslint/no-explicit-any -- the NAV/reconciliation tables are not in the generated Supabase types yet */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { useFinanceAccess } from '@/hooks/useFinanceAccess';
import { usePurchaseInvoiceAccess } from '@/hooks/usePurchaseInvoiceAccess';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, CheckCircle2, Info, Loader2, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { NavStatusBadge } from './NavStatusBadge';
import { formatMoney, reconDecision } from '@/lib/purchaseInvoiceNav';
import { approvalBlockers } from '../../../supabase/functions/_shared/purchaseInvoices/approvalGate';

const COMPARE: Array<{ field: string; doc: string; nav: string; money?: boolean }> = [
  { field: 'merchant_tax_id', doc: 'merchant_tax_id', nav: 'supplier_tax_number_full' },
  { field: 'merchant_name', doc: 'merchant_name', nav: 'supplier_name' },
  { field: 'buyer_tax_id', doc: 'buyer_tax_id', nav: 'customer_tax_number' },
  { field: 'invoice_number', doc: 'invoice_number', nav: 'invoice_number' },
  { field: 'invoice_date', doc: 'invoice_date', nav: 'invoice_issue_date' },
  { field: 'performance_date', doc: 'performance_date', nav: 'invoice_delivery_date' },
  { field: 'currency', doc: 'currency', nav: 'currency' },
  { field: 'net_amount', doc: 'net_amount', nav: 'net_amount', money: true },
  { field: 'total_vat_amount', doc: 'total_vat_amount', nav: 'vat_amount', money: true },
  { field: 'total_amount', doc: 'total_amount', nav: 'gross_amount', money: true },
];

interface Props {
  invoice: any;
  onChanged: () => void;
}

/**
 * Document vs NAV, side by side. Differences are never resolved silently:
 * controlling accepts the NAV value or keeps the document value, with a note.
 */
export function NavComparisonCard({ invoice, onChanged }: Props) {
  const { user } = useAuth();
  const { t, language } = useTranslation();
  const { canApprove, companyIds, hotelIds } = useFinanceAccess();
  const { canControlNav } = usePurchaseInvoiceAccess();
  const locale = language === 'hu' ? 'hu-HU' : 'en-GB';
  const [nav, setNav] = useState<any | null>(null);
  const [provenance, setProvenance] = useState<any[]>([]);
  const [settings, setSettings] = useState<any | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!invoice?.id) return;
    const db = supabase as any;
    const [n, p, s] = await Promise.all([
      invoice.nav_invoice_id
        ? db.from('pi_nav_invoices').select('*').eq('id', invoice.nav_invoice_id).maybeSingle()
        : Promise.resolve({ data: null }),
      db.from('pi_invoice_field_provenance').select('*').eq('invoice_id', invoice.id).order('field'),
      db.from('pi_module_settings').select('block_approval_on_exceptions, require_separate_approver, require_nav_match_for_approval')
        .eq('organization_slug', invoice.organization_slug).maybeSingle(),
    ]);
    setNav(n.data ?? null);
    setProvenance(p.data ?? []);
    setSettings(s.data ?? null);
  }, [invoice?.id, invoice?.nav_invoice_id, invoice?.organization_slug]);
  // Re-read when reconciliation moves the invoice to another status.
  useEffect(() => { load(); }, [load, invoice?.nav_match_status]);

  const openConflicts = provenance.filter((p) => p.action === 'conflict' && p.status === 'open');
  const filled = provenance.filter((p) => p.action === 'fill' && p.status === 'applied');
  const checks: any[] = Array.isArray(invoice?.validation_results) ? invoice.validation_results : [];

  const blockers = useMemo(() => {
    if (!invoice || invoice.review_status !== 'pending_approval') return [];
    const inScope = (companyIds.length === 0 || companyIds.includes(invoice.buyer_company_id))
      && (hotelIds.length === 0 || hotelIds.includes(invoice.hotel_id));
    return approvalBlockers({
      id: invoice.id, approval_status: invoice.approval_status, review_status: invoice.review_status,
      nav_match_status: invoice.nav_match_status, duplicate_status: invoice.duplicate_status,
      validation_status: invoice.validation_status, open_conflicts: openConflicts.filter((c) => c.material).length,
      uploaded_by: invoice.uploaded_by, reviewed_by: invoice.reviewed_by,
    }, {
      approverId: user?.id ?? '', canApprove, inScope,
      requireSeparateApprover: !!settings?.require_separate_approver,
      blockOnExceptions: settings?.block_approval_on_exceptions !== false,
      requireNavMatch: !!settings?.require_nav_match_for_approval,
    }).filter((b) => b !== 'not_controller' || canApprove);
  }, [invoice, openConflicts, settings, canApprove, companyIds, hotelIds, user?.id]);

  const decide = async (row: any, decision: 'accept_nav' | 'keep_document') => {
    setBusy(row.id);
    try {
      await reconDecision('resolve_conflict', { provenance_id: row.id, decision, reason: notes[row.id] ?? '' });
      toast.success(t('pi.recon.saved'));
      await load();
      onChanged();
    } catch (e: any) {
      toast.error(e?.message || 'Failed');
    } finally {
      setBusy(null);
    }
  };

  const show = (value: unknown, money?: boolean, currency?: string) =>
    value == null || value === '' ? '—' : money ? formatMoney(Number(value), currency, locale) : String(value);

  return (
    <div className="rounded-lg border p-3 space-y-3 bg-muted/10">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">{t('pi.navcard.heading')}</span>
        <NavStatusBadge status={invoice?.nav_match_status} />
        {invoice?.nav_match_reason && <span className="text-[11px] text-muted-foreground truncate">{invoice.nav_match_reason}</span>}
      </div>

      {blockers.length > 0 && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs space-y-0.5">
          <div className="font-medium flex items-center gap-1"><ShieldAlert className="h-3.5 w-3.5" />{t('pi.navcard.blockers')}</div>
          {blockers.map((b) => <div key={b}>• {t(`pi.blocker.${b}`)}</div>)}
        </div>
      )}

      {nav ? (
        <div className="text-[11px]">
          <div className="grid grid-cols-[1.2fr_1fr_1fr] gap-x-2 gap-y-0.5">
            <span />
            <span className="font-medium">{t('pi.navcard.document')}</span>
            <span className="font-medium">{t('pi.navcard.nav')}{nav.environment === 'test' ? ' (TEST)' : ''}</span>
            {COMPARE.map((c) => {
              const docValue = invoice?.[c.doc];
              const navValue = nav?.[c.nav] ?? (c.nav === 'supplier_tax_number_full' ? nav?.supplier_tax_number : null);
              const conflict = openConflicts.find((p) => p.field === c.field);
              return (
                <div key={c.field} className={`contents ${conflict ? 'text-destructive' : ''}`}>
                  <span className="text-muted-foreground">{t(`pi.f.${c.field}`)}</span>
                  <span className="tabular-nums truncate">{show(docValue, c.money, invoice?.currency)}</span>
                  <span className="tabular-nums truncate">{show(navValue, c.money, nav?.currency)}</span>
                </div>
              );
            })}
          </div>
          <p className="text-muted-foreground mt-2 flex items-start gap-1"><Info className="h-3 w-3 mt-0.5 shrink-0" />{t('pi.navcard.taxDataOnly')}</p>
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">{t('pi.navcard.noRecord')}</p>
      )}

      {openConflicts.length > 0 && (
        <div className="space-y-2">
          {openConflicts.map((row) => (
            <div key={row.id} className="rounded-md border border-amber-500/50 bg-amber-500/5 p-2 text-[11px] space-y-1.5">
              <div className="flex items-center gap-1 font-medium"><AlertTriangle className="h-3.5 w-3.5 text-amber-600" />{t(`pi.f.${row.field}`)} · {t('pi.navcard.conflict')}</div>
              <div>{t('pi.navcard.document')}: <strong>{row.ocr_value ?? '—'}</strong> · NAV: <strong>{row.nav_value ?? '—'}</strong></div>
              {canControlNav && invoice?.approval_status !== 'approved' ? (
                <>
                  <Textarea rows={1} className="text-xs min-h-0" placeholder={t('pi.recon.reason')} value={notes[row.id] ?? ''}
                    onChange={(e) => setNotes((s) => ({ ...s, [row.id]: e.target.value }))} />
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={!!busy} onClick={() => decide(row, 'accept_nav')}>
                      {busy === row.id && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}{t('pi.navcard.acceptNav')}
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={!!busy || (notes[row.id] ?? '').trim().length < 3} onClick={() => decide(row, 'keep_document')}>
                      {t('pi.navcard.keepDocument')}
                    </Button>
                  </div>
                </>
              ) : <div className="text-muted-foreground">{t('pi.recon.controllingOnly')}</div>}
            </div>
          ))}
        </div>
      )}

      {filled.length > 0 && (
        <div className="text-[11px]">
          <span className="font-medium">{t('pi.navcard.filledFromNav')}:</span>{' '}
          {filled.map((f) => <Badge key={f.id} variant="outline" className="mr-1 text-[10px] border-sky-500/50 text-sky-700 dark:text-sky-400">{t(`pi.f.${f.field}`)}</Badge>)}
        </div>
      )}

      {checks.length > 0 && (
        <div className="text-[11px] space-y-0.5">
          <div className="font-medium">{t('pi.navcard.checks')}</div>
          {checks.filter((c) => c.status === 'fail' || c.status === 'warn').map((c, idx) => (
            <div key={idx} className={c.status === 'fail' ? 'text-destructive' : 'text-amber-700 dark:text-amber-400'}>
              {c.status === 'fail' ? '✗' : '!'} {c.message}
            </div>
          ))}
          {checks.every((c) => c.status !== 'fail' && c.status !== 'warn') && (
            <div className="text-emerald-700 dark:text-emerald-400 flex items-center gap-1"><CheckCircle2 className="h-3 w-3" />OK</div>
          )}
        </div>
      )}
    </div>
  );
}
