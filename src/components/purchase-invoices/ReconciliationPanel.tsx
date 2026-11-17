/* eslint-disable @typescript-eslint/no-explicit-any -- the NAV/reconciliation tables are not in the generated Supabase types yet */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ChevronDown, ChevronRight, Download, Link2, Loader2, Undo2, Ban } from 'lucide-react';
import { toast } from 'sonner';
import { NavStatusBadge } from './NavStatusBadge';
import { BLOCKING_NAV_STATUSES, exportWorkbook, fetchAll, formatMoney, reconDecision } from '@/lib/purchaseInvoiceNav';

type Group = 'exceptions' | 'pending' | 'matched' | 'all';
const GROUPS: Record<Exclude<Group, 'all'>, string[]> = {
  exceptions: ['data_mismatch', 'duplicate_document', 'competing_nav_candidates', 'correction_chain', 'document_only'],
  pending: ['nav_sync_pending', 'not_checked'],
  matched: ['exact_match', 'probable_match', 'manual_resolution', 'not_expected'],
};
const NAV_GROUPS: Record<Exclude<Group, 'all'>, string[]> = {
  exceptions: ['nav_only', 'data_mismatch', 'competing_nav_candidates', 'correction_chain'],
  pending: [],
  matched: ['exact_match', 'probable_match', 'manual_resolution', 'not_expected'],
};

interface Props {
  invoices: any[];
  canControlNav: boolean;
  onOpenInvoice: (id: string) => void;
  onChanged: () => void;
}

type Decision =
  | { kind: 'manual_match'; invoice: any }
  | { kind: 'mark_not_expected'; invoice: any }
  | { kind: 'mark_nav_not_expected'; nav: any };

export function ReconciliationPanel({ invoices, canControlNav, onOpenInvoice, onChanged }: Props) {
  const { profile } = useAuth();
  const { t, language } = useTranslation();
  const org = profile?.organization_slug ?? '';
  const locale = language === 'hu' ? 'hu-HU' : 'en-GB';
  const [group, setGroup] = useState<Group>('exceptions');
  const [search, setSearch] = useState('');
  const [navRows, setNavRows] = useState<any[]>([]);
  const [loadingNav, setLoadingNav] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [reason, setReason] = useState('');
  const [candidate, setCandidate] = useState<string | null>(null);
  const [candidateSearch, setCandidateSearch] = useState('');
  const [busy, setBusy] = useState(false);

  const loadNav = useCallback(async () => {
    if (!org) return;
    setLoadingNav(true);
    try {
      const db = supabase as any;
      const rows = await fetchAll((from, to) => db.from('pi_nav_invoices')
        .select('id, company_id, environment, supplier_name, supplier_tax_number, customer_name, invoice_number, invoice_operation, original_invoice_number, invoice_issue_date, currency, net_amount, vat_amount, gross_amount, match_status, matched_invoice_id, match_reason, match_explanation, manual_status, manual_reason, ins_date')
        .eq('organization_slug', org).order('invoice_issue_date', { ascending: false }).range(from, to));
      setNavRows(rows);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to load NAV records');
    } finally {
      setLoadingNav(false);
    }
  }, [org]);
  useEffect(() => { loadNav(); }, [loadNav]);

  const q = search.trim().toLowerCase();
  const matchesSearch = (supplier?: string | null, number?: string | null) =>
    !q || (supplier || '').toLowerCase().includes(q) || (number || '').toLowerCase().includes(q);

  const documents = useMemo(() => invoices
    .filter((i) => i.status !== 'failed' && i.status !== 'uploaded' && i.status !== 'processing')
    .filter((i) => group === 'all' || GROUPS[group].includes(i.nav_match_status || 'not_checked'))
    .filter((i) => matchesSearch(i.merchant_name, i.invoice_number))
    .sort((a, b) => Number(BLOCKING_NAV_STATUSES.has(b.nav_match_status)) - Number(BLOCKING_NAV_STATUSES.has(a.nav_match_status))
      || (b.invoice_date || '').localeCompare(a.invoice_date || '')),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [invoices, group, q]);

  const navList = useMemo(() => navRows
    .filter((n) => group === 'all' || NAV_GROUPS[group].includes(n.match_status))
    .filter((n) => matchesSearch(n.supplier_name, n.invoice_number)),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [navRows, group, q]);

  const candidates = useMemo(() => {
    if (decision?.kind !== 'manual_match') return [];
    const inv = decision.invoice;
    const cq = candidateSearch.trim().toLowerCase();
    return navRows
      .filter((n) => ['nav_only', 'competing_nav_candidates', 'data_mismatch'].includes(n.match_status))
      .filter((n) => !inv.buyer_company_id || n.company_id === inv.buyer_company_id)
      .filter((n) => !cq || (n.supplier_name || '').toLowerCase().includes(cq) || (n.invoice_number || '').toLowerCase().includes(cq))
      .sort((a, b) => {
        const core = String(inv.merchant_tax_id || '').replace(/\D/g, '').slice(0, 8);
        return Number(String(b.supplier_tax_number).startsWith(core) && !!core) - Number(String(a.supplier_tax_number).startsWith(core) && !!core);
      })
      .slice(0, 50);
  }, [decision, navRows, candidateSearch]);

  const openDecision = (d: Decision) => { setDecision(d); setReason(''); setCandidate(null); setCandidateSearch(''); };

  const submitDecision = async () => {
    if (!decision) return;
    setBusy(true);
    try {
      if (decision.kind === 'manual_match') await reconDecision('manual_match', { invoice_id: decision.invoice.id, nav_invoice_id: candidate, reason });
      else if (decision.kind === 'mark_not_expected') await reconDecision('mark_not_expected', { invoice_id: decision.invoice.id, reason });
      else await reconDecision('mark_nav_not_expected', { nav_invoice_id: decision.nav.id, reason });
      toast.success(t('pi.recon.saved'));
      setDecision(null);
      await loadNav();
      onChanged();
    } catch (e: any) {
      toast.error(e?.message || 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const clearManual = async (payload: { invoice_id?: string; nav_invoice_id?: string }) => {
    setBusy(true);
    try {
      await reconDecision('clear_manual', payload);
      toast.success(t('pi.recon.saved'));
      await loadNav();
      onChanged();
    } catch (e: any) {
      toast.error(e?.message || 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const exportAll = () => exportWorkbook([
    {
      name: 'Documents', rows: documents.map((i) => ({
        status: i.nav_match_status, reason: i.nav_match_reason, supplier: i.merchant_name, supplier_tax: i.merchant_tax_id,
        invoice_number: i.invoice_number, issue_date: i.invoice_date, currency: i.currency, gross: i.total_amount,
        differences: (i.nav_differences || []).map((d: any) => `${d.field}: ${d.document ?? '—'} ≠ ${d.nav ?? '—'}`).join('; '),
      })),
    },
    {
      name: 'NAV', rows: navList.map((n) => ({
        status: n.match_status, reason: n.match_reason, supplier: n.supplier_name, supplier_tax: n.supplier_tax_number,
        invoice_number: n.invoice_number, operation: n.invoice_operation, issue_date: n.invoice_issue_date, currency: n.currency,
        gross: n.gross_amount, environment: n.environment,
      })),
    },
  ], `nav-reconciliation-${new Date().toISOString().slice(0, 10)}`);

  const steps = (explanation: any[] | null | undefined) => (
    <ul className="space-y-0.5">
      {(explanation ?? []).map((s: any, idx: number) => (
        <li key={idx} className="text-[11px] flex gap-1.5">
          <span className={s.result === 'fail' ? 'text-destructive' : s.result === 'pass' ? 'text-emerald-600' : 'text-muted-foreground'}>
            {s.result === 'fail' ? '✗' : s.result === 'pass' ? '✓' : '•'}
          </span>
          <span className="font-mono text-muted-foreground shrink-0">{s.rule}</span>
          <span>{s.detail}</span>
        </li>
      ))}
    </ul>
  );

  return (
    <Card>
      <CardHeader className="pb-2 space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-base">{t('pi.tab.reconciliation')}</CardTitle>
          <Button size="sm" variant="outline" onClick={exportAll}><Download className="h-3.5 w-3.5 mr-1" />XLSX</Button>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          {(['exceptions', 'pending', 'matched', 'all'] as Group[]).map((g) => (
            <button key={g} onClick={() => setGroup(g)}
              className={`text-xs px-2.5 py-1 rounded-full border ${group === g ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-accent border-border'}`}>
              {t(`pi.recon.filter.${g}`)}
            </button>
          ))}
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('pi.recon.search')} className="h-8 max-w-[260px] ml-auto" />
        </div>
        {!canControlNav && <p className="text-[11px] text-muted-foreground">{t('pi.recon.controllingOnly')}</p>}
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="documents">
          <TabsList>
            <TabsTrigger value="documents">{t('pi.recon.documents')} ({documents.length})</TabsTrigger>
            <TabsTrigger value="nav">{t('pi.recon.navRecords')} ({navList.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="documents" className="space-y-1.5 mt-3">
            {documents.length === 0 ? <p className="text-sm text-muted-foreground py-6 text-center">{t('pi.recon.empty')}</p> : documents.slice(0, 300).map((i) => (
              <div key={i.id} className="rounded-md border">
                <div className="flex items-center gap-2 p-2.5">
                  <button className="shrink-0 text-muted-foreground" onClick={() => setExpanded(expanded === i.id ? null : i.id)} aria-label={t('pi.recon.why')}>
                    {expanded === i.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate flex items-center gap-1.5">
                      {i.merchant_name || '—'}
                      {i.source === 'historical_import' && <Badge variant="secondary" className="text-[9px]">{t('pi.upload.historical')}</Badge>}
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {i.invoice_number || '—'} · {i.invoice_date || '—'} · {formatMoney(i.total_amount, i.currency, locale)}
                      {i.nav_match_reason && <> · {i.nav_match_reason}</>}
                    </div>
                  </div>
                  <NavStatusBadge status={i.nav_match_status} />
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => onOpenInvoice(i.id)}>{t('pi.recon.open')}</Button>
                </div>
                {expanded === i.id && (
                  <div className="border-t px-3 py-2 space-y-2 bg-muted/20">
                    {(i.nav_differences ?? []).length > 0 && (
                      <div>
                        <div className="text-[11px] font-medium mb-1">{t('pi.recon.differences')}</div>
                        <div className="grid grid-cols-3 gap-x-3 text-[11px]">
                          {(i.nav_differences as any[]).map((d, idx) => (
                            <div key={idx} className="contents">
                              <span className={d.material ? 'text-destructive font-medium' : 'text-muted-foreground'}>{t(`pi.f.${d.field}`) || d.field}</span>
                              <span>{String(d.document ?? '—')}</span>
                              <span>NAV: {String(d.nav ?? '—')}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    <div>
                      <div className="text-[11px] font-medium mb-1">{t('pi.recon.why')}</div>
                      {steps(i.nav_match_explanation)}
                    </div>
                    {canControlNav && i.approval_status !== 'approved' && (
                      <div className="flex flex-wrap gap-2 pt-1">
                        <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={() => openDecision({ kind: 'manual_match', invoice: i })}>
                          <Link2 className="h-3 w-3 mr-1" />{t('pi.recon.manualMatch')}
                        </Button>
                        <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={() => openDecision({ kind: 'mark_not_expected', invoice: i })}>
                          <Ban className="h-3 w-3 mr-1" />{t('pi.recon.markNotExpected')}
                        </Button>
                        {i.nav_manual_status && (
                          <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={busy} onClick={() => clearManual({ invoice_id: i.id })}>
                            <Undo2 className="h-3 w-3 mr-1" />{t('pi.recon.clearManual')}
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </TabsContent>

          <TabsContent value="nav" className="space-y-1.5 mt-3">
            {loadingNav ? <div className="py-6 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
              : navList.length === 0 ? <p className="text-sm text-muted-foreground py-6 text-center">{t('pi.recon.empty')}</p>
              : navList.slice(0, 300).map((n) => (
                <div key={n.id} className="rounded-md border">
                  <div className="flex items-center gap-2 p-2.5">
                    <button className="shrink-0 text-muted-foreground" onClick={() => setExpanded(expanded === n.id ? null : n.id)} aria-label={t('pi.recon.why')}>
                      {expanded === n.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">
                        {n.supplier_name || n.supplier_tax_number}
                        {n.environment === 'test' && <Badge variant="secondary" className="ml-1.5 text-[9px]">TEST</Badge>}
                        {n.invoice_operation !== 'CREATE' && <Badge variant="outline" className="ml-1.5 text-[9px]">{n.invoice_operation}</Badge>}
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {n.invoice_number} · {n.invoice_issue_date || '—'} · {formatMoney(n.gross_amount, n.currency, locale)}
                        {n.original_invoice_number && <> · ← {n.original_invoice_number}</>}
                      </div>
                    </div>
                    <NavStatusBadge status={n.match_status} />
                    {n.matched_invoice_id && (
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => onOpenInvoice(n.matched_invoice_id)}>{t('pi.recon.open')}</Button>
                    )}
                  </div>
                  {expanded === n.id && (
                    <div className="border-t px-3 py-2 space-y-2 bg-muted/20">
                      {steps(n.match_explanation)}
                      {n.manual_reason && <p className="text-[11px] text-muted-foreground">{n.manual_reason}</p>}
                      {canControlNav && (
                        <div className="flex flex-wrap gap-2">
                          {n.match_status === 'nav_only' && (
                            <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={() => openDecision({ kind: 'mark_nav_not_expected', nav: n })}>
                              <Ban className="h-3 w-3 mr-1" />{t('pi.missing.notRequired')}
                            </Button>
                          )}
                          {n.manual_status && (
                            <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={busy} onClick={() => clearManual({ nav_invoice_id: n.id })}>
                              <Undo2 className="h-3 w-3 mr-1" />{t('pi.recon.clearManual')}
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
          </TabsContent>
        </Tabs>
      </CardContent>

      <Dialog open={!!decision} onOpenChange={(o) => !o && setDecision(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-base">
              {decision?.kind === 'manual_match' ? t('pi.recon.manualMatch') : decision?.kind === 'mark_not_expected' ? t('pi.recon.markNotExpected') : t('pi.missing.notRequired')}
            </DialogTitle>
          </DialogHeader>
          {decision?.kind === 'manual_match' && (
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">{t('pi.recon.selectNav')}</div>
              <Input value={candidateSearch} onChange={(e) => setCandidateSearch(e.target.value)} placeholder={t('pi.recon.search')} className="h-8" />
              <div className="max-h-64 overflow-y-auto space-y-1">
                {candidates.length === 0 ? <p className="text-xs text-muted-foreground py-3">{t('pi.recon.noCandidates')}</p> : candidates.map((n) => (
                  <button key={n.id} onClick={() => setCandidate(n.id)}
                    className={`w-full text-left rounded-md border p-2 text-xs ${candidate === n.id ? 'border-primary bg-primary/5' : 'hover:bg-accent/40'}`}>
                    <div className="font-medium">{n.supplier_name || n.supplier_tax_number} · {n.invoice_number}</div>
                    <div className="text-muted-foreground">{n.invoice_issue_date} · {formatMoney(n.gross_amount, n.currency, locale)} · {t(`pi.nav.status.${n.match_status}`)}</div>
                  </button>
                ))}
              </div>
            </div>
          )}
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('pi.recon.reason')} rows={2} className="text-sm" />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDecision(null)}>{t('pi.recon.cancel')}</Button>
            <Button disabled={busy || reason.trim().length < 3 || (decision?.kind === 'manual_match' && !candidate)} onClick={submitDecision}>
              {busy && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}{t('pi.recon.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
