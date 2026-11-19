import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Building2, ClipboardCheck, Settings2 } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { NtakClosureDialog } from './NtakClosureDialog';
import { NtakPanel } from './NtakPanel';
import { callNtak, type NtakStatus } from './ntakApi';

/**
 * NTAK reporting health in Reception: yesterday's closure, missing days,
 * NTAK warnings/errors and blocked sending are always visible (certification
 * criterion: warnings and errors returned by NTAK must be shown to users).
 */
export function NtakStatusCard({ hotelId }: { hotelId: string }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<NtakStatus | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [closureOpen, setClosureOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setStatus(await callNtak<NtakStatus>({ action: 'status', hotel_id: hotelId }));
    } catch {
      setStatus(null); // no access or function not deployed: show nothing
    }
  }, [hotelId]);
  useEffect(() => { void refresh(); }, [refresh]);

  if (!status || (!status.settings && !status.can_manage)) return null;
  const s = status.settings;
  const canManage = status.can_manage;
  const yesterday = addDay(status.today, -1);
  const yc = status.closures.find((c) => c.closed_day === yesterday);
  const recentProblems = status.messages.filter((m) => m.errors.length > 0 && ['rejected', 'failed'].includes(m.state)).length;
  const recentWarnings = status.messages.filter((m) => m.warnings.length > 0 && m.state === 'verified').length;
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
