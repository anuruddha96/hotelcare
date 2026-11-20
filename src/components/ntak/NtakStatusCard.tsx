import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, Building2, ClipboardCheck, Settings2 } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { NtakClosureDialog } from './NtakClosureDialog';
import { NtakPanel } from './NtakPanel';
import { callNtak, type NtakMessage, type NtakStatus } from './ntakApi';

/**
 * NTAK reporting health in Reception: yesterday's closure, missing days,
 * NTAK warnings/errors and blocked sending are always visible (certification
 * criterion: warnings and errors returned by NTAK must be shown to users).
 */
export function NtakStatusCard({ hotelId, report = false }: { hotelId: string; report?: boolean }) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<NtakMessage['kind'] | 'all'>('all');
  const [failed, setFailed] = useState(false);
  const [status, setStatus] = useState<NtakStatus | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [closureOpen, setClosureOpen] = useState(false);

  const refresh = useCallback(async () => {
    setFailed(false);
    try {
      setStatus(await callNtak<NtakStatus>({ action: 'status', hotel_id: hotelId }));
    } catch {
      setFailed(true);
      setStatus(null); // no access or function not deployed: show nothing
    }
  }, [hotelId]);
  useEffect(() => { void refresh(); }, [refresh]);

  if (!status || (!status.settings && !status.can_manage)) {
    if (!report) return null;
    return <section className="rounded-lg border bg-card p-4 space-y-2">
      <h2 className="font-semibold">{t('ntak.title')}</h2>
      {failed ? <div role="alert" className="flex items-center gap-3 text-sm">{t('pms.rep.loadFailed')} <Button variant="outline" size="sm" onClick={refresh}>{t('pms.viza.retry')}</Button></div>
        : status ? <p className="text-sm text-muted-foreground">{t('ntak.notConfigured')}</p> : <Loader2 aria-label={t('ntak.title')} className="h-5 w-5 animate-spin" />}
    </section>;
  }
  const s = status.settings;
  const canManage = status.can_manage;
  const yesterday = addDay(status.today, -1);
  const yc = status.closures.find((c) => c.closed_day === yesterday);
  const recentProblems = status.messages.filter((m) => m.errors.length > 0 && ['rejected', 'failed'].includes(m.state)).length;
  const recentWarnings = status.messages.filter((m) => m.warnings.length > 0 && m.state === 'verified').length;
  const messages = kind === 'all' ? status.messages : status.messages.filter(m => m.kind === kind);
  const corrections = status.closures.filter((c) => c.needs_correction).length;

  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2" data-training="fd-ntak-card" title={t('ntak.tip')}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
        <span className="flex items-center gap-1.5 font-semibold"><Building2 className="h-4 w-4 text-primary" /> {t('ntak.title')}</span>
        {!s ? <span className="text-muted-foreground">{t('ntak.notConfigured')}</span> : (
          <>
            <Badge variant={s.enabled ? (s.environment === 'production' ? 'default' : 'secondary') : 'outline'} className="text-[10px]">
              {!s.enabled ? t('ntak.off') : s.environment === 'production' ? t('ntak.production') : t('ntak.test')}
            </Badge>
            <span>{t('ntak.yesterday')}: <strong className={yc && ['errors', 'failed', 'resend_required'].includes(yc.state) ? 'text-destructive' : ''}>{yc ? t(`ntak.state.${yc.state}`) : t('ntak.notClosed')}</strong></span>
            {status.missing_closures.length > 0 && <span className="text-amber-700 dark:text-amber-400">{t('ntak.missing')}: <strong>{status.missing_closures.length}</strong></span>}
            {recentProblems > 0 && <span className="text-destructive">✕ {recentProblems}</span>}
            {recentWarnings > 0 && <span className="text-amber-700 dark:text-amber-400">⚠ {recentWarnings}</span>}
            {corrections > 0 && <span className="text-destructive">{t('ntak.needsCorrection')}</span>}
          </>
        )}
        <div className="ml-auto flex gap-1">
          {s?.enabled && (
            <Button type="button" size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => setClosureOpen(true)}>
              <ClipboardCheck className="h-3.5 w-3.5" /> {t('ntak.closeDay')}
            </Button>
          )}
          {(canManage || s) && (
            <Button type="button" size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => setPanelOpen(true)}>
              <Settings2 className="h-3.5 w-3.5" /> {canManage ? t('ntak.manage') : t('ntak.tab.messages')}
            </Button>
          )}
        </div>
      </div>
      {s?.sending_blocked_reason && <p className="mt-1 text-[11px] text-destructive">{t('ntak.blocked')}: {s.sending_blocked_reason}</p>}
      {!s?.sending_blocked_reason && s?.last_error && <p className="mt-1 text-[11px] text-destructive truncate" title={s.last_error}>{s.last_error}</p>}
      {report && <div className="mt-3 border-t pt-3 text-sm">
        <div className="flex items-center justify-between gap-2"><h3 className="font-semibold">{t('ntak.recentActivity')}</h3>
          <Button size="sm" variant="ghost" onClick={refresh}>{t('ntak.refreshReports')}</Button></div>
        <div className="my-2 flex flex-wrap gap-1">
          {(['all', 'closure', 'booking', 'event', 'start_date'] as const).map(key =>
            <Button key={key} size="sm" variant={key === kind ? 'secondary' : 'ghost'} aria-pressed={key === kind} onClick={() => setKind(key)}>
              {key === 'all' ? t('ntak.allReports') : t(`ntak.kind.${key}`)}
            </Button>)}
        </div>
        {messages.length === 0 ? <p className="py-2 text-muted-foreground">{t('ntak.noActivity')}</p> :
          <ul className="divide-y text-xs">{messages.slice(0, 20).map(m => <li key={m.id} className="flex flex-wrap items-baseline gap-x-3 py-2">
                <span className="font-medium">{t(`ntak.kind.${m.kind}`)}</span>
                <span>{t(m.state === 'accepted' ? 'ntak.state.sent' : m.state === 'verified' && m.warnings.length ? 'ntak.state.warnings' : `ntak.state.${m.state}`)}</span>
                <time className="ml-auto text-muted-foreground">{new Date(m.verified_at ?? m.sent_at ?? m.created_at).toLocaleString(undefined, {timeZone: 'Europe/Budapest'})}</time>
                {(m.ntak_status || m.errors.length > 0 || m.warnings.length > 0) && <span className="basis-full break-words">
                  {[m.ntak_status, ...m.errors.map(issue => issue.message || issue.key), ...m.warnings.map(issue => issue.message || issue.key)].filter(Boolean).join(' · ')}
                </span>}
                {m.processing_id && <span className="basis-full break-all text-muted-foreground">{m.processing_id}</span>}
              </li>)}</ul>}
      </div>}
      {closureOpen && <NtakClosureDialog hotelId={hotelId} day={yesterday} open={closureOpen} onOpenChange={setClosureOpen} onQueued={refresh} />}
      {panelOpen && <NtakPanel hotelId={hotelId} open={panelOpen} onOpenChange={(o) => { setPanelOpen(o); if (!o) void refresh(); }} onChanged={refresh} />}
    </div>
  );
}

function addDay(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
