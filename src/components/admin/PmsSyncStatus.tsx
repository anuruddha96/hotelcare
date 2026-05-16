import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import {
  CheckCircle2,
  XCircle,
  AlertCircle,
  RefreshCw,
  Copy,
  Loader2,
  ListChecks,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface Props {
  /** HotelCare hotel slug (e.g. 'previo-test'). */
  hotelId: string;
  /** Compact variant for embedding in PMS Upload tab. */
  compact?: boolean;
}

interface PmsConfigRow {
  id: string;
  hotel_id: string;
  pms_hotel_id: string | null;
  credentials_secret_name: string | null;
  is_active: boolean;
  sync_enabled: boolean;
  last_sync_at: string | null;
  last_test_at: string | null;
  last_test_status: string | null;
  last_test_error: string | null;
}

interface SyncRow {
  id: string;
  changed_at: string;
  sync_status: string;
  error_message: string | null;
  data: any;
}

/**
 * Reusable component that surfaces the current Previo sync state for a hotel:
 *   - Setup checklist (what's missing before sync can run)
 *   - Last sync timestamp + counts + last error
 *   - One-click "Sync rooms now"
 *
 * Safe by design: guards out and renders an explanatory empty state when
 * the hotel does not have a Previo PMS configuration at all (so production
 * hotels without Previo are unaffected).
 */
export default function PmsSyncStatus({ hotelId, compact = false }: Props) {
  const [config, setConfig] = useState<PmsConfigRow | null>(null);
  const [mappingCount, setMappingCount] = useState(0);
  const [lastSync, setLastSync] = useState<SyncRow | null>(null);
  const [lastNightly, setLastNightly] = useState<SyncRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: cfg } = await supabase
      .from('pms_configurations')
      .select('id, hotel_id, pms_hotel_id, credentials_secret_name, is_active, sync_enabled, last_sync_at, last_test_at, last_test_status, last_test_error')
      .eq('hotel_id', hotelId)
      .eq('pms_type', 'previo')
      .maybeSingle();
    setConfig(cfg as PmsConfigRow | null);

    if (cfg?.id) {
      const { count } = await supabase
        .from('pms_room_mappings')
        .select('id', { count: 'exact', head: true })
        .eq('pms_config_id', cfg.id);
      setMappingCount(count ?? 0);
    } else {
      setMappingCount(0);
    }

    const { data: hist } = await supabase
      .from('pms_sync_history')
      .select('id, changed_at, sync_status, error_message, data')
      .eq('hotel_id', hotelId)
      .eq('sync_type', 'rooms')
      .order('changed_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    setLastSync(hist as SyncRow | null);

    const { data: nightly } = await supabase
      .from('pms_sync_history')
      .select('id, changed_at, sync_status, error_message, data')
      .eq('hotel_id', hotelId)
      .eq('sync_type', 'nightly_auto')
      .order('changed_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    setLastNightly(nightly as SyncRow | null);
    setLoading(false);
  }, [hotelId]);

  useEffect(() => {
    if (hotelId) load();
  }, [hotelId, load]);

  const checklist = [
    { ok: !!config, label: 'PMS configuration row exists' },
    { ok: !!config?.pms_hotel_id, label: 'Previo Hotel ID is set' },
    { ok: !!config?.credentials_secret_name, label: 'Credentials secret name is set' },
    { ok: config?.last_test_status === 'ok', label: 'Connection test passed' },
    { ok: mappingCount > 0 || lastSync !== null, label: 'Rooms have been imported at least once' },
  ];

  const blockers = checklist.filter((c) => !c.ok).map((c) => c.label);
  const ready = blockers.length === 0 || (!!config?.pms_hotel_id && !!config?.credentials_secret_name);

  const handleSync = async () => {
    if (!config?.pms_hotel_id || !config?.credentials_secret_name) {
      toast.error('Cannot sync — fill PMS Hotel ID and Credentials secret name first.');
      return;
    }
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke('previo-sync-rooms', {
        body: { hotelId, importLocal: hotelId === 'previo-test' },
      });
      if (error) throw error;
      if (!data?.success) {
        toast.error(`Sync failed: ${data?.error || 'unknown error'}`);
      } else {
        const r = data.results || {};
        const imported = r.upserted ?? r.updated ?? 0;
        toast.success(`Sync complete — ${imported} rooms${r.errors?.length ? `, ${r.errors.length} errors` : ''}`);
      }
    } catch (e: any) {
      toast.error(`Sync failed: ${e?.message || 'unknown error'}`);
    } finally {
      setSyncing(false);
      await load();
    }
  };

  if (loading) {
    return (
      <Card className="p-4 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading sync status…
      </Card>
    );
  }

  if (!config) {
    return (
      <Card className="p-4 text-sm">
        <div className="flex items-center gap-2 mb-1">
          <AlertCircle className="h-4 w-4 text-amber-600" />
          <span className="font-medium">Previo not configured for this hotel</span>
        </div>
        <p className="text-muted-foreground">
          Open <strong>Admin → PMS Configuration</strong>, create a Previo configuration for{' '}
          <code>{hotelId}</code> and enter the Previo Hotel ID + credentials secret name.
        </p>
      </Card>
    );
  }

  const lastResult = lastSync?.data || {};
  const lastImported = lastResult.upserted ?? lastResult.updated ?? 0;
  const lastErrors: string[] = lastResult.errors || (lastSync?.error_message ? [lastSync.error_message] : []);

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-medium">
          <ListChecks className="h-4 w-4" />
          Previo sync — {hotelId}
        </div>
        {!compact && (
          <Button size="sm" onClick={handleSync} disabled={syncing || !ready}>
            {syncing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Sync rooms now
          </Button>
        )}
      </div>

      {!compact && (
        <ul className="space-y-1 text-sm">
          {checklist.map((c) => (
            <li key={c.label} className="flex items-center gap-2">
              {c.ok ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
              ) : (
                <XCircle className="h-4 w-4 text-destructive shrink-0" />
              )}
              <span className={c.ok ? 'text-muted-foreground' : 'text-foreground'}>{c.label}</span>
            </li>
          ))}
        </ul>
      )}

      {lastNightly && (
        <div className="flex items-center gap-2 text-xs rounded-md border border-border bg-muted/30 px-3 py-2">
          <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-muted-foreground">Last nightly auto-sync:</span>
          <span className="font-medium">{formatDistanceToNow(new Date(lastNightly.changed_at))} ago</span>
          <Badge
            variant={lastNightly.sync_status === 'success' ? 'default' : lastNightly.sync_status === 'partial' ? 'secondary' : 'destructive'}
            className="ml-1"
          >
            {lastNightly.sync_status}
          </Badge>
          {lastNightly.data?.rooms_updated != null && (
            <span className="text-muted-foreground ml-2">· {lastNightly.data.rooms_updated} updated</span>
          )}
          {lastNightly.data?.rooms_created ? (
            <span className="text-emerald-700 ml-2">· {lastNightly.data.rooms_created} new</span>
          ) : null}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
        <div>
          <div className="text-xs text-muted-foreground">Last sync</div>
          <div className="font-medium">
            {lastSync?.changed_at
              ? `${formatDistanceToNow(new Date(lastSync.changed_at))} ago`
              : 'Never'}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Rooms imported (last run)</div>
          <div className="font-medium">{lastSync ? lastImported : '—'}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Status</div>
          <div>
            {lastSync ? (
              <Badge
                variant={
                  lastSync.sync_status === 'success'
                    ? 'default'
                    : lastSync.sync_status === 'partial'
                    ? 'secondary'
                    : 'destructive'
                }
              >
                {lastSync.sync_status}
              </Badge>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </div>
        </div>
      </div>

      {lastErrors.length > 0 && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-destructive">Last error(s)</span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                navigator.clipboard.writeText(lastErrors.join('\n'));
                toast.success('Copied');
              }}
            >
              <Copy className="h-3 w-3 mr-1" /> Copy
            </Button>
          </div>
          <pre className="text-xs whitespace-pre-wrap break-all max-h-40 overflow-auto">
            {lastErrors.slice(0, 8).join('\n')}
            {lastErrors.length > 8 ? `\n…and ${lastErrors.length - 8} more` : ''}
          </pre>
        </div>
      )}
    </Card>
  );
}
