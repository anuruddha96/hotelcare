import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from '@/hooks/useTranslation';
import { buildReceptionSyncHealth, syncEventCount, type ReceptionSyncEvent, type ReceptionSyncSignal } from '@/lib/receptionSyncHealth';

interface PmsSyncButtonProps {
  hotelId: string;
  onSynced?: () => void;
  compact?: boolean;
}

const SYNC_TYPES = ['reservations', 'daily_overview_live', 'status_update', 'rate_push'] as const;

/** Read-only, hotel-scoped health: a checkout poll is NOT a reservation import. */
export function PmsSyncButton({ hotelId, onSynced, compact }: PmsSyncButtonProps) {
  const { t } = useTranslation();
  const [connected, setConnected] = useState<boolean | null>(null);
  const [health, setHealth] = useState<ReceptionSyncSignal[]>([]);
  const [busy, setBusy] = useState(false);
  const [statusError, setStatusError] = useState(false);
  const [checking, setChecking] = useState(true);

  const loadStatus = useCallback(async () => {
    if (!hotelId) return;
    setChecking(true);
    try {
      const [accounts, legacy, ...history] = await Promise.all([
        supabase.from('pms_accounts').select('id').eq('hotel_id', hotelId).eq('pms_type', 'previo').eq('is_active', true).limit(1),
        supabase.from('pms_configurations').select('id').eq('hotel_id', hotelId).eq('pms_type', 'previo').eq('is_active', true).limit(1),
        ...SYNC_TYPES.flatMap((type) => [
          supabase.from('pms_sync_history').select('hotel_id, sync_type, sync_status, created_at, data, error_message').eq('hotel_id', hotelId).eq('sync_type', type).order('created_at', { ascending: false }).limit(1),
          supabase.from('pms_sync_history').select('hotel_id, sync_type, sync_status, created_at, data, error_message').eq('hotel_id', hotelId).eq('sync_type', type).eq('sync_status', 'success').order('created_at', { ascending: false }).limit(1),
        ]),
      ]);
      const connectionUnknown = Boolean(accounts.error && legacy.error);
      const historyFailed = history.some((result) => Boolean(result.error));
      setConnected(connectionUnknown ? null : Boolean(accounts.data?.length || legacy.data?.length));
      setStatusError(connectionUnknown || historyFailed);
      if (historyFailed) {
        setHealth([]); // Do not turn failed reads into a reassuring 'never synced'.
      } else {
        const events = history.flatMap((result) => (result.data ?? []) as ReceptionSyncEvent[]);
        setHealth(buildReceptionSyncHealth(events, Date.now(), [hotelId]));
      }
    } catch {
      setStatusError(true);
      setConnected(null);
      setHealth([]);
    } finally {
      setChecking(false);
    }
  }, [hotelId]);

  useEffect(() => { void loadStatus(); }, [loadStatus]);

  const runSync = async () => {
    if (busy || connected !== true) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('previo-sync-reservations', { body: { hotelId } });
      if (error) {
        toast.error(`${t('pms.sync.syncFailed')}: ${error.message}`);
        await loadStatus();
        return;
      }
      if (data?.supported === false) {
        setConnected(false);
        toast.info(data.message ?? t('pms.sync.notConnected'));
        return;
      }
      const inserted = Math.max(0, Number(data?.inserted ?? 0));
      const updated = Math.max(0, Number(data?.updated ?? 0));
      const unmappedRooms = Math.max(0, Number(data?.unmapped_rooms ?? 0));
      const errors = Array.isArray(data?.errors) ? data.errors.length : 0;
      const details = `${t('pms.sync.imported')}: ${inserted} · ${t('pms.sync.updatedCount')}: ${updated}${unmappedRooms ? ` · ${t('pms.res.unassigned')}: ${unmappedRooms}` : ''}${errors ? ` · ${t('pms.sync.errorsCount')}: ${errors}` : ''}`;
      const partial = data?.success !== true || errors > 0 || unmappedRooms > 0;
      if (partial) {
        if (inserted + updated > 0) toast.warning(`${t('pms.sync.syncDone')} · ${details}`);
        else toast.error(`${t('pms.sync.syncFailed')} · ${details}`);
      } else {
        toast.success(`${t('pms.sync.syncDone')} · ${details}`);
      }
      await loadStatus();
      onSynced?.(); // A partial import may have persisted some bookings.
    } catch {
      toast.error(t('pms.sync.syncFailed'));
      await loadStatus();
    } finally {
      setBusy(false);
    }
  };

  if (!hotelId || connected === false) return null;
  const reservations = health.find((signal) => signal.category === 'reservations');
  const reservationWarning = statusError || (reservations != null && reservations.state !== 'ok');
  const attention = health.filter((signal) => signal.state === 'warning' || (signal.category === 'reservations' && signal.state === 'missing')).length;
  const humanTime = (value: string | null | undefined) => value ? new Date(value).toLocaleString() : 'Not recorded';

  return <div className="flex flex-col items-start sm:items-end gap-1 min-w-0" data-training="fd-sync">
    <Button type="button" size="sm" variant="outline" onClick={() => void runSync()} disabled={busy || connected !== true || checking} className="gap-1.5">
      <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />
      {busy ? t('pms.sync.syncing') : t('pms.sync.syncNow')}
    </Button>
    {statusError ? <span role="alert" className="text-[11px] text-amber-700 dark:text-amber-400 flex items-center gap-1"><AlertTriangle className="h-3 w-3" />Could not verify PMS sync history</span> :
      <details className="relative text-[11px] max-w-[320px] w-full sm:w-auto" data-training="pms-sync-health">
        <summary className={`cursor-pointer select-none flex items-center gap-1 ${reservationWarning ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground'}`}>
          {reservationWarning ? <AlertTriangle className="h-3 w-3 shrink-0" /> : <CheckCircle2 className="h-3 w-3 shrink-0" />}
          <span>{checking ? 'Checking PMS activity…' : `Reservation import: ${humanTime(reservations?.lastAttempt?.created_at)}`}</span>
          {attention > 0 && <span className="font-semibold">· {attention} alerts</span>}
          <span className="ml-1 underline underline-offset-2">Details</span>
        </summary>
        <div className={`mt-1 rounded-md border border-border bg-card shadow-sm p-2 space-y-2 w-[min(310px,88vw)] ${compact ? 'sm:absolute sm:right-0 sm:top-full sm:z-50' : ''}`}>
          <p className="font-semibold text-foreground">Independent Previo activity · this hotel only</p>
          {health.map((signal) => <div key={signal.category} className="border-b border-border/50 last:border-b-0 pb-1">
            <div className="flex items-center gap-1 font-medium">{signal.state === 'ok' ? <CheckCircle2 className="h-3 w-3 text-emerald-600" /> : <AlertTriangle className="h-3 w-3 text-amber-600" />}{signal.label} · {signal.lastAttempt?.sync_status ?? 'not recorded'}</div>
            <p className="text-muted-foreground">Attempt: {humanTime(signal.lastAttempt?.created_at)}</p>
            <p className="text-muted-foreground">Last success: {humanTime(signal.lastSuccess?.created_at)}</p>
            <p className={signal.state === 'ok' ? 'text-muted-foreground' : 'text-amber-700 dark:text-amber-400'}>{signal.note}{signal.lastAttempt?.error_message ? ` · ${signal.lastAttempt.error_message.slice(0, 160)}` : ''}</p>
            {syncEventCount(signal.lastAttempt) && <p className="text-muted-foreground">{syncEventCount(signal.lastAttempt)}</p>}
          </div>)}
          <p className="text-muted-foreground">This does not verify Previo-to-OTA delivery, live inventory parity or government reporting.</p>
        </div>
      </details>}
  </div>;
}
