import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from '@/hooks/useTranslation';

interface PmsSyncButtonProps {
  hotelId: string;
  onSynced?: () => void;
  compact?: boolean;
}

interface LastSync {
  at: string;
  status: string | null;
  inserted: number;
  updated: number;
  errors: number;
  unmappedRooms: number;
}

/** Previo sync is property scoped; displaying a snapshot is not proof of a successful import. */
export function PmsSyncButton({ hotelId, onSynced, compact }: PmsSyncButtonProps) {
  const { t } = useTranslation();
  const [connected, setConnected] = useState<boolean | null>(null);
  const [lastSync, setLastSync] = useState<LastSync | null>(null);
  const [busy, setBusy] = useState(false);
  const [statusError, setStatusError] = useState(false);

  const loadStatus = useCallback(async () => {
    if (!hotelId) return;
    try {
      const [accounts, legacy, history] = await Promise.all([
        supabase.from('pms_accounts').select('id').eq('hotel_id', hotelId).eq('pms_type', 'previo').eq('is_active', true).limit(1),
        supabase.from('pms_configurations').select('id').eq('hotel_id', hotelId).eq('pms_type', 'previo').eq('is_active', true).limit(1),
        supabase.from('pms_sync_history').select('created_at, sync_status, data').eq('hotel_id', hotelId).eq('sync_type', 'reservations').order('created_at', { ascending: false }).limit(1),
      ]);
      if (accounts.error && legacy.error) {
        setConnected(null);
        setStatusError(true);
        return;
      }
      setStatusError(Boolean(history.error));
      setConnected(Boolean(accounts.data?.length || legacy.data?.length));
      const latest = history.data?.[0];
      if (!latest) { setLastSync(null); return; }
      const data = (latest.data ?? {}) as Record<string, unknown>;
      setLastSync({
        at: latest.created_at,
        status: latest.sync_status,
        inserted: Number(data.inserted ?? 0),
        updated: Number(data.updated ?? 0),
        errors: Array.isArray(data.errors) ? data.errors.length : 0,
        unmappedRooms: Number(data.unmapped_rooms ?? 0),
      });
    } catch {
      setStatusError(true);
      setConnected(null);
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
      const partial = data?.success === false || errors > 0 || unmappedRooms > 0;
      if (partial) {
        if (inserted + updated > 0) toast.warning(`${t('pms.sync.syncDone')} · ${details}`);
        else toast.error(`${t('pms.sync.syncFailed')} · ${details}`);
      } else {
        toast.success(`${t('pms.sync.syncDone')} · ${details}`);
      }
      await loadStatus();
      // A partial import may have changed reservations; reload the view even then.
      onSynced?.();
    } catch {
      toast.error(t('pms.sync.syncFailed'));
    } finally {
      setBusy(false);
    }
  };

  if (!hotelId || connected === false) return null;
  const failed = statusError || (lastSync !== null && (lastSync.status === 'failed' || lastSync.status === 'error' || lastSync.errors > 0 || lastSync.unmappedRooms > 0));
  const lastSyncLabel = lastSync
    ? `${new Date(lastSync.at).toLocaleString()} (${lastSync.status ?? 'unknown'})${lastSync.unmappedRooms ? ` · ${lastSync.unmappedRooms} unmapped rooms` : ''}${lastSync.errors ? ` · ${lastSync.errors} errors` : ''}`
    : t('pms.sync.never');

  return <div className="flex flex-col items-start sm:items-end gap-1" data-training="fd-sync">
    <Button type="button" size="sm" variant="outline" onClick={() => void runSync()} disabled={busy || connected !== true} className="gap-1.5">
      <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />
      {busy ? t('pms.sync.syncing') : t('pms.sync.syncNow')}
    </Button>
    <span className={`max-w-[245px] text-[10px] leading-tight ${failed ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground'} ${compact ? 'hidden sm:flex' : 'flex'} items-center gap-1`} role={failed ? 'alert' : 'status'} title={`Latest Previo reservation import: ${lastSyncLabel}`}>
      {failed && <AlertTriangle className="h-3 w-3 shrink-0" />}
      <span className="truncate">{statusError ? 'Cannot verify Previo sync health' : `${t('pms.sync.lastSync')}: ${lastSyncLabel}`}</span>
    </span>
  </div>;
}
