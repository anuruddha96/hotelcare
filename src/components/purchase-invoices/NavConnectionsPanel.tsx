/* eslint-disable @typescript-eslint/no-explicit-any -- the NAV/reconciliation tables are not in the generated Supabase types yet */
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { KeyRound, Loader2, PlugZap, Plus, Power, RefreshCw, ShieldCheck, Trash2, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { navAdmin, syncNavNow } from '@/lib/purchaseInvoiceNav';

interface ListResult {
  connections: any[];
  companies: any[];
  software: { configured: boolean; software_id: string | null; error: string | null };
  can_manage: boolean;
}

const STATUS_TONE: Record<string, string> = {
  draft: 'border-border text-muted-foreground',
  ready: 'border-sky-500/50 text-sky-700 dark:text-sky-400',
  active: 'border-emerald-500/50 text-emerald-700 dark:text-emerald-400',
  error: 'border-destructive/50 text-destructive',
  disabled: 'border-border text-muted-foreground',
};

/** Per legal company NAV connection: credentials (write-only), test, enable, sync. */
export function NavConnectionsPanel() {
  const { profile } = useAuth();
  const { t, language } = useTranslation();
  const locale = language === 'hu' ? 'hu-HU' : 'en-GB';
  const [data, setData] = useState<ListResult | null>(null);
  const [runs, setRuns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState({ company_id: '', environment: 'test', sync_from_date: '' });
  const [creds, setCreds] = useState<Record<string, { login: string; password: string; signing_key: string; exchange_key: string }>>({});
  const [confirmProd, setConfirmProd] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await navAdmin<ListResult>('list');
      setData(result);
      const { data: r } = await (supabase as any).from('pi_nav_sync_runs')
        .select('id, connection_id, trigger, mode, status, digests_received, records_upserted, details_fetched, error_message, started_at, finished_at')
        .eq('organization_slug', profile?.organization_slug ?? '').order('started_at', { ascending: false }).limit(20);
      setRuns(r ?? []);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to load NAV connections');
    } finally {
      setLoading(false);
    }
  }, [profile?.organization_slug]);
  useEffect(() => { load(); }, [load]);

  const act = async (key: string, fn: () => Promise<unknown>, success?: string) => {
    setBusy(key);
    try {
      await fn();
      if (success) toast.success(success);
      await load();
    } catch (e: any) {
      toast.error(e?.message || 'Failed');
    } finally {
      setBusy(null);
    }
  };

  const companyLabel = (id: string) => {
    const c = data?.companies.find((x) => x.id === id);
    return c ? `${c.legal_name || c.name}${c.tax_id ? ` · ${c.tax_id}` : ''}` : '—';
  };

  if (loading && !data) return <div className="py-10 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  if (!data) return null;
  const manage = data.can_manage;

  return (
    <div className="space-y-4">
      <Alert>
        <ShieldCheck className="h-4 w-4" />
        <AlertDescription className="text-xs">{t('pi.navcfg.readOnlyNote')}</AlertDescription>
      </Alert>
      {!data.software.configured && (
        <Alert variant="destructive">
          <TriangleAlert className="h-4 w-4" />
          <AlertDescription className="text-xs">{t('pi.navcfg.softwareMissing')}</AlertDescription>
        </Alert>
      )}
      {!manage && <p className="text-xs text-muted-foreground">{t('pi.navcfg.viewOnly')}</p>}

      {manage && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">{t('pi.navcfg.addConnection')}</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label className="text-xs">{t('pi.navcfg.company')}</Label>
              <Select value={draft.company_id} onValueChange={(v) => setDraft((d) => ({ ...d, company_id: v }))}>
                <SelectTrigger className="h-9 w-[280px] text-xs"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {data.companies.filter((c) => c.is_active !== false).map((c) => (
                    <SelectItem key={c.id} value={c.id} disabled={!c.tax_valid}>
                      {c.legal_name || c.name} {c.tax_id ? `· ${c.tax_id}` : ''}{!c.tax_valid ? ' ⚠' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t('pi.navcfg.environment')}</Label>
              <Select value={draft.environment} onValueChange={(v) => setDraft((d) => ({ ...d, environment: v }))}>
                <SelectTrigger className="h-9 w-[160px] text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="test">{t('pi.navcfg.env.test')}</SelectItem>
                  <SelectItem value="production">{t('pi.navcfg.env.production')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t('pi.navcfg.syncFrom')}</Label>
              <Input type="date" className="h-9 w-[160px]" value={draft.sync_from_date} onChange={(e) => setDraft((d) => ({ ...d, sync_from_date: e.target.value }))} />
            </div>
            <Button disabled={!draft.company_id || busy === 'create'} onClick={() => act('create', () => navAdmin('save_connection', {
              company_id: draft.company_id, environment: draft.environment, sync_from_date: draft.sync_from_date || null, use_for_reconciliation: false,
            }), t('pi.rollout.saved'))}>
              {busy === 'create' ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />}{t('pi.navcfg.addConnection')}
            </Button>
            {data.companies.some((c) => !c.tax_valid) && <p className="text-[11px] text-muted-foreground w-full">⚠ {t('pi.navcfg.invalidTax')}</p>}
          </CardContent>
        </Card>
      )}

      {data.connections.map((c) => {
        const form = creds[c.id] ?? { login: '', password: '', signing_key: '', exchange_key: '' };
        const setForm = (patch: Partial<typeof form>) => setCreds((s) => ({ ...s, [c.id]: { ...form, ...patch } }));
        const test = c.last_test_result ?? null;
        return (
          <Card key={c.id}>
            <CardHeader className="pb-2 flex flex-row items-start justify-between gap-2 flex-wrap">
              <div>
                <CardTitle className="text-sm">{companyLabel(c.company_id)}</CardTitle>
                <div className="text-[11px] text-muted-foreground">
                  {t(`pi.navcfg.env.${c.environment}`)} · {c.tax_number}
                  {c.initial_sync_through && <> · {t('pi.navcfg.history')}: {c.initial_sync_through}</>}
                  {c.last_success_at && <> · {t('pi.overview.lastSync')}: {new Date(c.last_success_at).toLocaleString(locale)}</>}
                </div>
              </div>
              <Badge variant="outline" className={STATUS_TONE[c.status] ?? ''}>{t(`pi.navcfg.status.${c.status}`)}</Badge>
            </CardHeader>
            <CardContent className="space-y-3">
              <Alert variant={c.environment === 'production' ? 'destructive' : 'default'}>
                <TriangleAlert className="h-4 w-4" />
                <AlertDescription className="text-[11px]">
                  {c.environment === 'production' ? t('pi.navcfg.productionWarning') : t('pi.navcfg.sandboxWarning')}
                </AlertDescription>
              </Alert>

              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">{t('pi.navcfg.syncFrom')}</Label>
                  <Input type="date" className="h-8 w-[160px]" disabled={!manage} defaultValue={c.sync_from_date ?? ''}
                    onBlur={(e) => manage && e.target.value !== (c.sync_from_date ?? '') && act(`from-${c.id}`, () => navAdmin('save_connection', {
                      company_id: c.company_id, environment: c.environment, sync_from_date: e.target.value || null, use_for_reconciliation: c.use_for_reconciliation,
                    }), t('pi.rollout.saved'))} />
                </div>
                <label className="flex items-center gap-2 text-xs">
                  <Switch checked={!!c.use_for_reconciliation} disabled={!manage || !!busy}
                    onCheckedChange={(v) => act(`recon-${c.id}`, () => navAdmin('save_connection', {
                      company_id: c.company_id, environment: c.environment, use_for_reconciliation: v,
                    }), t('pi.rollout.saved'))} />
                  {t('pi.navcfg.useForRecon')}
                </label>
                <span className="text-xs flex items-center gap-1 text-muted-foreground">
                  <KeyRound className="h-3.5 w-3.5" />
                  {c.credentials_set ? `${t('pi.navcfg.credentialsStored')} (${c.login_hint ?? ''})` : t('pi.navcfg.credentialsMissing')}
                </span>
              </div>

              {manage && (
                <div className="rounded-md border p-3 space-y-2 bg-muted/20">
                  <div className="text-xs font-medium">{t('pi.navcfg.credentials')}</div>
                  <form className="grid sm:grid-cols-2 gap-2" autoComplete="off" onSubmit={(e) => { e.preventDefault(); }}>
                    <Input placeholder={t('pi.navcfg.login')} value={form.login} autoComplete="off" onChange={(e) => setForm({ login: e.target.value })} className="h-8" />
                    <Input placeholder={t('pi.navcfg.password')} type="password" value={form.password} autoComplete="new-password" onChange={(e) => setForm({ password: e.target.value })} className="h-8" />
                    <Input placeholder={t('pi.navcfg.signingKey')} type="password" value={form.signing_key} autoComplete="new-password" onChange={(e) => setForm({ signing_key: e.target.value })} className="h-8" />
                    <Input placeholder={t('pi.navcfg.exchangeKey')} type="password" value={form.exchange_key} autoComplete="new-password" onChange={(e) => setForm({ exchange_key: e.target.value })} className="h-8" />
                  </form>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" disabled={!form.login || !form.password || !form.signing_key || busy === `cred-${c.id}`}
                      onClick={() => act(`cred-${c.id}`, async () => {
                        await navAdmin('set_credentials', { connection_id: c.id, ...form });
                        setCreds((s) => ({ ...s, [c.id]: { login: '', password: '', signing_key: '', exchange_key: '' } }));
                      }, t('pi.navcfg.credentialsStored'))}>
                      {busy === `cred-${c.id}` ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <KeyRound className="h-3.5 w-3.5 mr-1" />}
                      {t('pi.navcfg.saveCredentials')}
                    </Button>
                    {c.credentials_set && (
                      <Button size="sm" variant="ghost" className="text-destructive" disabled={!!busy}
                        onClick={() => act(`del-${c.id}`, () => navAdmin('delete_credentials', { connection_id: c.id }))}>
                        <Trash2 className="h-3.5 w-3.5 mr-1" />{t('pi.navcfg.deleteCredentials')}
                      </Button>
                    )}
                  </div>
                </div>
              )}

              {test && (
                <div className={`rounded-md border p-2 text-[11px] ${test.ok ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-destructive/40 bg-destructive/5'}`}>
                  <div className="font-medium">{test.ok ? t('pi.navcfg.testOk') : t('pi.navcfg.testFailed')} · {c.last_test_at ? new Date(c.last_test_at).toLocaleString(locale) : ''}</div>
                  {test.taxpayer_name && <div>NAV: {test.taxpayer_name}{test.name_matches_company === false ? ' ⚠' : ''}</div>}
                  {test.error_message && <div>{test.error_code ? `${test.error_code}: ` : ''}{test.error_message}</div>}
                </div>
              )}

              {manage && (
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="outline" disabled={!c.credentials_set || !!busy}
                    onClick={() => act(`test-${c.id}`, async () => {
                      const r = await navAdmin<{ result: any }>('test', { connection_id: c.id });
                      if (r.result?.ok) toast.success(t('pi.navcfg.testOk')); else toast.error(r.result?.error_message || t('pi.navcfg.testFailed'));
                    })}>
                    {busy === `test-${c.id}` ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <PlugZap className="h-3.5 w-3.5 mr-1" />}
                    {t('pi.navcfg.testConnection')}
                  </Button>
                  {!c.enabled ? (
                    <>
                      {c.environment === 'production' && (
                        <label className="flex items-center gap-2 text-[11px] max-w-[360px]">
                          <Checkbox checked={!!confirmProd[c.id]} onCheckedChange={(v) => setConfirmProd((s) => ({ ...s, [c.id]: v === true }))} />
                          {t('pi.navcfg.confirmProduction')}
                        </label>
                      )}
                      <Button size="sm" disabled={!c.last_test_ok || !data.software.configured || !c.sync_from_date || !!busy || (c.environment === 'production' && !confirmProd[c.id])}
                        onClick={() => act(`en-${c.id}`, () => navAdmin('enable', { connection_id: c.id, confirm_production: !!confirmProd[c.id] }), t('pi.navcfg.status.active'))}>
                        <Power className="h-3.5 w-3.5 mr-1" />{t('pi.navcfg.enable')}
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button size="sm" variant="outline" disabled={!!busy}
                        onClick={() => act(`sync-${c.id}`, () => syncNavNow(c.id), t('pi.overview.syncDone'))}>
                        {busy === `sync-${c.id}` ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
                        {t('pi.navcfg.syncNow')}
                      </Button>
                      <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => act(`dis-${c.id}`, () => navAdmin('disable', { connection_id: c.id }))}>
                        {t('pi.navcfg.disable')}
                      </Button>
                    </>
                  )}
                </div>
              )}
              {!manage && c.enabled && (
                <Button size="sm" variant="outline" disabled={!!busy} onClick={() => act(`sync-${c.id}`, () => syncNavNow(c.id), t('pi.overview.syncDone'))}>
                  <RefreshCw className="h-3.5 w-3.5 mr-1" />{t('pi.navcfg.syncNow')}
                </Button>
              )}
              {c.last_error_message && <p className="text-[11px] text-destructive">{c.last_error_code ? `${c.last_error_code}: ` : ''}{c.last_error_message}</p>}
            </CardContent>
          </Card>
        );
      })}

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">{t('pi.navcfg.runs')}</CardTitle></CardHeader>
        <CardContent className="space-y-1">
          {runs.length === 0 ? <p className="text-xs text-muted-foreground">{t('pi.navcfg.noRuns')}</p> : runs.map((r) => (
            <div key={r.id} className="text-[11px] flex flex-wrap gap-2 border-b last:border-0 py-1">
              <span className="tabular-nums text-muted-foreground">{new Date(r.started_at).toLocaleString(locale)}</span>
              <span>{companyLabel(data.connections.find((c) => c.id === r.connection_id)?.company_id)}</span>
              <span className="font-medium">{r.mode} · {r.status}</span>
              <span>{r.digests_received} / {r.records_upserted} / {r.details_fetched}</span>
              {r.error_message && <span className="text-destructive truncate max-w-[420px]">{r.error_message}</span>}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
