import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Loader2, CheckCircle2, AlertTriangle, XCircle, Clock, DoorOpen, Radio } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useLiveSync } from '@/contexts/LiveSyncContext';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';

interface Props {
  onRefreshed?: () => void;
}

const MANAGER_ROLES = new Set([
  'admin',
  'top_management',
  'manager',
  'housekeeping_manager',
  'front_office',
]);

/**
 * PMS Sync status pill — shows live status from the global LiveSync context
 * and lets managers force a refresh. Visible to managers on hotels that have
 * an active Previo PMS configuration.
 *
 * The actual sync runs in the LiveSync context (auto-triggered on login,
 * focus, and via this button). It NEVER touches assignments.
 */
export function PmsRefreshButton({ onRefreshed }: Props) {
  const { profile } = useAuth();
  const { enabled, tasks, refresh } = useLiveSync();
  const isManager = profile?.role ? MANAGER_ROLES.has(profile.role) : false;

  if (!enabled || !isManager) return null;

  const t = tasks.pms;
  const busy = t.status === 'syncing';

  const statusMeta = (() => {
    if (busy) {
      return {
        label: 'Syncing…',
        Icon: Loader2,
        iconClass: 'animate-spin text-primary',
        wrapClass: 'border-primary/30 bg-primary/5',
        dotClass: 'bg-primary animate-pulse',
      };
    }
    if (!t.lastAt) {
      return {
        label: 'Live · ready',
        Icon: Radio,
        iconClass: 'text-muted-foreground',
        wrapClass: 'border-border bg-muted/30',
        dotClass: 'bg-muted-foreground/50',
      };
    }
    if (t.status === 'error') {
      return {
        label: 'Sync failed',
        Icon: XCircle,
        iconClass: 'text-destructive',
        wrapClass: 'border-destructive/30 bg-destructive/5',
        dotClass: 'bg-destructive',
      };
    }
    if (t.status === 'partial') {
      return {
        label: 'Partial',
        Icon: AlertTriangle,
        iconClass: 'text-amber-600 dark:text-amber-500',
        wrapClass: 'border-amber-500/30 bg-amber-500/5',
        dotClass: 'bg-amber-500',
      };
    }
    return {
      label: 'Up to date',
      Icon: CheckCircle2,
      iconClass: 'text-emerald-600 dark:text-emerald-500',
      wrapClass: 'border-emerald-500/30 bg-emerald-500/5',
      dotClass: 'bg-emerald-500',
    };
  })();

  const StatusIcon = statusMeta.Icon;
  const meta = (t.meta || {}) as any;
  const updated = meta.updated ?? meta.upserted ?? 0;
  const total = meta.total ?? meta.rowCount ?? 0;
  const checkouts = meta.checkouts ?? 0;
  const notFound = meta.notFound ?? 0;
  const relTime = t.lastAt ? `${formatDistanceToNow(t.lastAt)} ago` : '—';

  const handleClick = async () => {
    await refresh('pms');
    onRefreshed?.();
  };

  return (
    <div
      className={cn(
        'flex w-full flex-col gap-2 rounded-lg border px-3 py-2 transition-colors',
        'sm:w-auto sm:flex-row sm:items-center sm:gap-3',
        statusMeta.wrapClass,
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="relative flex h-2.5 w-2.5 shrink-0">
          <span className={cn('absolute inline-flex h-full w-full rounded-full opacity-60', busy ? 'animate-ping' : '', statusMeta.dotClass)} />
          <span className={cn('relative inline-flex h-2.5 w-2.5 rounded-full', statusMeta.dotClass)} />
        </span>
        <div className="flex min-w-0 flex-col leading-tight">
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
            <StatusIcon className={cn('h-3.5 w-3.5 shrink-0', statusMeta.iconClass)} />
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">PMS Sync</span>
            <Badge variant="outline" className="h-4 px-1.5 text-[10px] font-medium">{statusMeta.label}</Badge>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{relTime}</span>
            {t.lastAt && total > 0 && (
              <>
                <span className="opacity-40">·</span>
                <span>
                  <span className="font-medium text-foreground">{updated}</span>
                  <span>/{total}</span> rooms
                </span>
                {checkouts > 0 && (
                  <>
                    <span className="opacity-40">·</span>
                    <span className="inline-flex items-center gap-1">
                      <DoorOpen className="h-3 w-3" />
                      <span className="font-medium text-foreground">{checkouts}</span>
                      <span className="hidden md:inline">checkouts</span>
                    </span>
                  </>
                )}
                {notFound > 0 && (
                  <>
                    <span className="opacity-40">·</span>
                    <span className="text-amber-600 dark:text-amber-500">{notFound} unmatched</span>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={handleClick}
        disabled={busy}
        className="h-8 w-full shrink-0 gap-1.5 bg-background/60 backdrop-blur sm:w-auto sm:self-center"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        <span>{busy ? 'Refreshing' : 'PMS Refresh'}</span>
      </Button>
    </div>
  );
}
