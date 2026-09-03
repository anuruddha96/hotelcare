import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';
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
  inserted?: number;
  updated?: number;
  errors?: number;
  unmappedRooms?: number;
}

/**
 * Manual "Sync from PMS" control for Previo-connected hotels.
 * Hidden when the hotel has no active Previo configuration.
 */
export function PmsSyncButton({ hotelId, onSynced, compact }: PmsSyncButtonProps) {
  const { t } = useTranslation();
  const [connected, setConnected] = useState<boolean | null>(null);
  const [lastSync, setLastSync] = useState<LastSync | null>(null);
  const [busy, setBusy] = useState(false);

  const loadStatus = useCallback(async () => {
    if (!hotelId) return;
    const [{ data: accounts }, { data: legacy }, { data: history }] = await Promise.all([
      supabase.from('pms_accounts').select('id').eq('hotel_id', hotelId).eq('pms_type', 'previo').eq('is_active', true).limit(1),
      supabase.from('pms_configurations').select('id').eq('hotel_id', hotelId).eq('pms_type', 'previo').eq('is_active', true).limit(1),
      supabase
        .from('pms_sync_history')
        .select('created_at, sync_status, data')
        .eq('hotel_id', hotelId)
        .eq('sync_type', 'reservations')
        .order('created_at', { ascending: false })
        .limit(1),
    ]);
    setConnected(((accounts?.length ?? 0) > 0) || ((legacy?.length ?? 0) > 0));
    const latest = history?.[0];
    if (latest) {
      const d = (latest.data ?? {}) as Record<string, unknown>;
      setLastSync({
        at: latest.created_at,
        status: latest.sync_status,
        inserted: Number(d.inserted ?? 0),
        updated: Number(d.updated ?? 0),
        errors: Array.isArray(d.errors) ? d.errors.length : 0,
        unmappedRooms: Number(d.unmapped_rooms ?? 0),
      });
    } else {
      setLastSync(null);
    }
  }, [hotelId]);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  const runSync = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('previo-sync-reservations', {
        body: { hotelId },
      });
      if (error) {
        let msg = error.message;
        try {
          const ctx = (error as any).context;
          if (ctx && typeof ctx.text === 'function') {
            const txt = await ctx.text();
            try { const j = JSON.parse(txt); msg = j.error || msg; } catch { msg = txt || msg; }
          }
        } catch { /* ignore */ }
        toast.error(`${t('pms.sync.syncFailed')}: ${msg}`);
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
      const errorCount = Array.isArray(data?.errors) ? data.errors.length : 0;
      const counts = `${t('pms.sync.imported')}: ${inserted} · ${t('pms.sync.updatedCount')}: ${updated}${unmappedRooms > 0 ? ` · ${t('pms.res.unassigned')}: ${unmappedRooms}` : ''}${errorCount > 0 ? ` · ${t('pms.sync.errorsCount')}: ${errorCount}` : ''}`;

      if (data?.success === false) {
        // A multi-account import may be partial: some reservations can be safely
        // imported even when another Previo account fails. Do not present that
        // as an empty hard-error toast and hide the useful import counts.
        if (inserted + updated > 0) toast.warning(`${t('pms.sync.syncDone')} · ${counts}`);
        else toast.error(`${t('pms.sync.syncFailed')} · ${counts}${data?.error ? ` · ${data.error}` : ''}`);
      } else {
        const message = `${t('pms.sync.syncDone')} · ${counts}`;
        if (unmappedRooms > 0) toast.warning(message);
        else toast.success(message);
      }
      await loadStatus();
      onSynced?.();
    } finally {
      setBusy(false);
    }
  };

  if (connected === false || !hotelId) return null;

  return (
    <div className="flex flex-col items-end gap-0.5" data-training="fd-sync">
      <Button size="sm" variant="outline" onClick={runSync} disabled={busy || connected === null} className="gap-1.5">
        <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />
        {busy ? t('pms.sync.syncing') : t('pms.sync.syncNow')}
      </Button>
      {!compact && (
        <span className={`text-[10px] ${lastSync?.unmappedRooms ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}>
          {t('pms.sync.lastSync')}: {lastSync ? `${new Date(lastSync.at).toLocaleString()} (${lastSync.status ?? '—'})${lastSync.unmappedRooms ? ` · ${t('pms.res.unassigned')}: ${lastSync.unmappedRooms}` : ''}` : t('pms.sync.never')}
        </span>
      )}
    </div>
  );
}
