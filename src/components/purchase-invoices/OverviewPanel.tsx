/* eslint-disable @typescript-eslint/no-explicit-any -- the NAV/reconciliation tables are not in the generated Supabase types yet */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertTriangle, CheckCircle2, FileQuestion, Loader2, RefreshCw, ShieldCheck, Link2, Info } from 'lucide-react';
import { toast } from 'sonner';
import {
  BLOCKING_NAV_STATUSES, MATCHED_NAV_STATUSES, formatMoney, reconcileNow, syncNavNow, totalsByCurrency,
} from '@/lib/purchaseInvoiceNav';

interface Props {
  invoices: any[];
  canControlNav: boolean;
  onNavigate: (tab: string) => void;
  onChanged: () => void;
}

/** Module overview: work queues, NAV health and per-currency totals (never mixed). */
export function OverviewPanel({ invoices, canControlNav, onNavigate, onChanged }: Props) {
  const { profile } = useAuth();
  const { t, language } = useTranslation();
  const org = profile?.organization_slug ?? '';
  const [nav, setNav] = useState<{ total: number; matched: number; navOnly: number; notExpected: number } | null>(null);
  const [connections, setConnections] = useState<any[]>([]);
  const [reconState, setReconState] = useState<any | null>(null);
  const [busy, setBusy] = useState<'sync' | 'reconcile' | null>(null);

  const load = useCallback(async () => {
    if (!org) return;
    const db = supabase as any;
    const head = (status?: string) => {
      let q = db.from('pi_nav_invoices').select('id', { count: 'exact', head: true }).eq('organization_slug', org);
      if (status) q = q.eq('match_status', status);
      return q;
    };
    const [all, navOnly, notExpected, exact, probable, manual, conn, state] = await Promise.all([
      head(), head('nav_only'), head('not_expected'), head('exact_match'), head('probable_match'), head('manual_resolution'),
      canControlNav
        ? db.from('pi_nav_connections').select('id, environment, status, enabled, use_for_reconciliation, last_success_at, last_error_message, initial_sync_completed_at, invoice_buyer_companies(name, legal_name)').eq('organization_slug', org)
        : Promise.resolve({ data: [] }),
      db.from('pi_reconcile_state').select('last_finished_at, last_status').eq('organization_slug', org).maybeSingle(),
    ]);
    setNav({
      total: all.count ?? 0,
      matched: (exact.count ?? 0) + (probable.count ?? 0) + (manual.count ?? 0),
      navOnly: navOnly.count ?? 0,
      notExpected: notExpected.count ?? 0,
    });
    setConnections(conn.data ?? []);
    setReconState(state.data ?? null);
  }, [org, canControlNav]);
  useEffect(() => { load(); }, [load]);

  const queues = useMemo(() => {
    const live = invoices.filter((i) => i.source !== 'historical_import');
    return {
      review: live.filter((i) => i.status === 'processed' && !i.is_verified).length,
      approval: live.filter((i) => i.review_status === 'pending_approval' && i.approval_status !== 'approved' && i.approval_status !== 'rejected').length,
      exceptions: invoices.filter((i) => BLOCKING_NAV_STATUSES.has(i.nav_match_status)).length,
      notInNav: invoices.filter((i) => i.nav_match_status === 'document_only').length,
      matchedDocs: invoices.filter((i) => MATCHED_NAV_STATUSES.has(i.nav_match_status)).length,
    };
  }, [invoices]);

  const monthTotals = useMemo(() => {
    const month = new Date().toISOString().slice(0, 7);
    return totalsByCurrency(
      invoices.filter((i) => (i.invoice_date || '').startsWith(month) && i.status !== 'failed'),
      (i) => i.total_amount, (i) => i.currency_source === 'default' ? null : i.currency,
    );
  }, [invoices]);

  const inScope = nav ? Math.max(0, nav.total - nav.notExpected) : 0;
  const matchRate = nav && inScope ? Math.round((nav.matched / inScope) * 1000) / 10 : null;
  const locale = language === 'hu' ? 'hu-HU' : 'en-GB';
  const when = (ts?: string | null) => (ts ? new Date(ts).toLocaleString(locale) : t('pi.overview.never'));

  const run = async (kind: 'sync' | 'reconcile') => {
    setBusy(kind);
    try {
      if (kind === 'sync') await syncNavNow();
      else await reconcileNow();
      toast.success(t(kind === 'sync' ? 'pi.overview.syncDone' : 'pi.overview.reconcileDone'));
      await load();
      onChanged();
    } catch (e: any) {
      toast.error(e?.message || 'Failed');
    } finally {
      setBusy(null);
    }
  };

  const tile = (label: string, value: string | number, icon: React.ReactNode, tab?: string, tone?: 'warn' | 'error' | 'ok') => (
    <button
      type="button"
      onClick={tab ? () => onNavigate(tab) : undefined}
      className={`text-left rounded-lg border p-3 bg-card transition-colors ${tab ? 'hover:bg-accent/40' : 'cursor-default'} ${
        tone === 'error' && Number(value) > 0 ? 'border-destructive/40' : tone === 'warn' && Number(value) > 0 ? 'border-amber-500/50' : ''}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{label}</span>
        {icon}
      </div>
      <div className="text-2xl font-bold tabular-nums mt-1">{value}</div>
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {tile(t('pi.overview.awaitingReview'), queues.review, <FileQuestion className="h-4 w-4 text-amber-500" />, 'queue', 'warn')}
        {tile(t('pi.overview.pendingApproval'), queues.approval, <ShieldCheck className="h-4 w-4 text-primary" />, 'approvals', 'warn')}
        {tile(t('pi.overview.navExceptions'), queues.exceptions, <AlertTriangle className="h-4 w-4 text-destructive" />, 'reconciliation', 'error')}
        {tile(t('pi.overview.missingDocs'), nav?.navOnly ?? '—', <Link2 className="h-4 w-4 text-destructive" />, 'missing', 'error')}
        {tile(t('pi.overview.matchRate'), matchRate == null ? '—' : `${matchRate}%`, <CheckCircle2 className="h-4 w-4 text-emerald-600" />, 'reconciliation')}
      </div>
      <p className="text-[11px] text-muted-foreground -mt-2">
        {t('pi.overview.matchRateHint')}{nav ? ` · ${nav.matched}/${inScope}` : ''} · {t('pi.overview.notInNav')}: {queues.notInNav}
      </p>

      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-base">{t('pi.overview.connections')}</CardTitle>
          <div className="flex gap-2">
            {canControlNav && (
              <Button size="sm" variant="outline" disabled={!!busy || !connections.some((c) => c.enabled)} onClick={() => run('sync')}>
                {busy === 'sync' ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
                {t('pi.overview.syncNow')}
              </Button>
            )}
            <Button size="sm" variant="outline" disabled={!!busy} onClick={() => run('reconcile')}>
              {busy === 'reconcile' ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
              {t('pi.overview.reconcileNow')}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {connections.filter((c) => c.enabled).length === 0 ? (
            <Alert><Info className="h-4 w-4" /><AlertDescription className="text-xs">{t('pi.overview.noConnections')}</AlertDescription></Alert>
          ) : connections.filter((c) => c.enabled).map((c) => {
            const failing = c.status === 'error' || !c.last_success_at || Date.now() - Date.parse(c.last_success_at) > 26 * 3_600_000;
            return (
              <div key={c.id} className="flex items-center justify-between gap-2 rounded-md border p-2.5">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{c.invoice_buyer_companies?.legal_name || c.invoice_buyer_companies?.name || '—'}</div>
                  <div className="text-[11px] text-muted-foreground truncate">
                    {t(`pi.navcfg.env.${c.environment}`)} · {t('pi.overview.lastSync')}: {when(c.last_success_at)}
                    {!c.initial_sync_completed_at && <> · {t('pi.overview.loadingHistory')}</>}
                    {c.last_error_message && failing && <> · {c.last_error_message}</>}
                  </div>
                </div>
                <Badge variant="outline" className={failing ? 'border-destructive/50 text-destructive' : 'border-emerald-500/50 text-emerald-700 dark:text-emerald-400'}>
                  {failing ? t('pi.overview.failing') : t('pi.overview.healthy')}
                </Badge>
              </div>
            );
          })}
          <p className="text-[11px] text-muted-foreground">
            {t('pi.overview.lastReconcile')}: {when(reconState?.last_finished_at)}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">{t('pi.overview.thisMonth')}</CardTitle></CardHeader>
        <CardContent>
          {monthTotals.length === 0 ? (
            <p className="text-sm text-muted-foreground">—</p>
          ) : (
            <div className="flex flex-wrap gap-3">
              {monthTotals.map((m) => (
                <div key={m.currency} className="rounded-md border px-3 py-2">
                  <div className="text-lg font-semibold tabular-nums">{formatMoney(m.total, m.currency, locale)}</div>
                  <div className="text-[11px] text-muted-foreground">{m.count} × {m.currency}</div>
                </div>
              ))}
            </div>
          )}
          <p className="text-[11px] text-muted-foreground mt-3">{t('pi.overview.notPayment')}</p>
        </CardContent>
      </Card>
    </div>
  );
}
