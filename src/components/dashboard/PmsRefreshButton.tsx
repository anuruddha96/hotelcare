import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Loader2, CheckCircle2, AlertTriangle, XCircle, Clock, DoorOpen, Radio, Activity } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useLiveSync } from '@/contexts/LiveSyncContext';
import { formatDistanceToNowStrict } from 'date-fns';
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
 * and lets managers force a refresh. The relative "time ago" ticks every
 * second so the user feels the live connection.
 */
export function PmsRefreshButton({ onRefreshed }: Props) {
  const { profile } = useAuth();
  const { enabled, tasks, refresh } = useLiveSync();
  const isManager = profile?.role ? MANAGER_ROLES.has(profile.role) : false;

  // Tick every second so relative time + freshness ring stay live.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  if (!enabled || !isManager) return null;

  const t = tasks.pms;
  const busy = t.status === 'syncing';
  const ageMs = t.lastAt ? Date.now() - t.lastAt.getTime() : null;
  // Fresh = updated within the last 60s -> stronger live feel.
  const isFresh = ageMs !== null && ageMs < 60_000;

  const statusMeta = (() => {
    if (busy) {
      return {
        label: 'Syncing…',
        Icon: Loader2,
        iconClass: 'animate-spin text-primary',
        wrapClass: 'border-primary/40 bg-primary/5 shadow-[0_0_0_3px_hsl(var(--primary)/0.08)]',
        dotClass: 'bg-primary',
        ringClass: 'bg-primary/60',
      };
    }
    if (!t.lastAt) {
      return {
        label: 'Live · ready',
        Icon: Radio,
        iconClass: 'text-muted-foreground',
        wrapClass: 'border-border bg-muted/30',
        dotClass: 'bg-muted-foreground/50',
        ringClass: 'bg-muted-foreground/30',
      };
    }
    if (t.status === 'error') {
      return {
        label: 'Sync failed',
        Icon: XCircle,
        iconClass: 'text-destructive',
        wrapClass: 'border-destructive/30 bg-destructive/5',
        dotClass: 'bg-destructive',
        ringClass: 'bg-destructive/60',
      };
    }
    if (t.status === 'partial') {
      return {
        label: 'Partial',
        Icon: AlertTriangle,
        iconClass: 'text-amber-600 dark:text-amber-500',
        wrapClass: 'border-amber-500/30 bg-amber-500/5',
        dotClass: 'bg-amber-500',
        ringClass: 'bg-amber-500/60',
      };
    }
    return {
      label: 'Up to date',
      Icon: CheckCircle2,
      iconClass: 'text-emerald-600 dark:text-emerald-500',
      wrapClass: cn(
        'border-emerald-500/30 bg-emerald-500/5',
        isFresh && 'shadow-[0_0_0_3px_hsl(142_71%_45%/0.10)]',
      ),
      dotClass: 'bg-emerald-500',
      ringClass: 'bg-emerald-500/60',
    };
  })();

  const StatusIcon = statusMeta.Icon;
  const meta = (t.meta || {}) as any;
  const updated = meta.updated ?? meta.upserted ?? 0;
  const total = meta.total ?? meta.rowCount ?? 0;
  const checkouts = meta.checkouts ?? 0;
  const notFound = meta.notFound ?? 0;
  const relTime = busy
    ? 'syncing now'
    : t.lastAt
      ? ageMs !== null && ageMs < 5_000
        ? 'just now'
        : `${formatDistanceToNowStrict(t.lastAt)} ago`
      : '—';

  // Heartbeat ping cadence: fast when syncing, slow when fresh, none when stale.
  const showPing = busy || isFresh || t.status === 'error';

  const handleClick = async () => {
    await refresh('pms');
    onRefreshed?.();
  };

  return (
    <div
      className={cn(
        'relative flex w-full flex-col gap-2 overflow-hidden rounded-lg border px-3 py-2 transition-all duration-300',
        'sm:w-auto sm:flex-row sm:items-center sm:gap-3',
        statusMeta.wrapClass,
      )}
    >
      {/* Animated shimmer while syncing — sweeps across the pill */}
      {busy && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 w-1/3 -translate-x-full animate-[pms-shimmer_1.6s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-primary/15 to-transparent"
          style={{ animationName: 'pms-shimmer' }}
        />
      )}
      <style>{`
        @keyframes pms-shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(400%); }
        }
        @keyframes pms-heartbeat {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.25); opacity: 0.85; }
        }
      `}</style>

      <div className="relative flex min-w-0 flex-1 items-center gap-2">
        {/* Live dot with dual ripple */}
        <span className="relative flex h-2.5 w-2.5 shrink-0 items-center justify-center">
          {showPing && (
            <>
              <span
                className={cn(
                  'absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping',
                  statusMeta.ringClass,
                )}
              />
              <span
                className={cn(
                  'absolute inline-flex h-full w-full rounded-full opacity-30 animate-ping [animation-delay:0.6s]',
                  statusMeta.ringClass,
                )}
              />
            </>
          )}
          <span
            className={cn('relative inline-flex h-2.5 w-2.5 rounded-full', statusMeta.dotClass)}
            style={busy ? { animation: 'pms-heartbeat 1s ease-in-out infinite' } : undefined}
          />
        </span>

        <div className="flex min-w-0 flex-col leading-tight">
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
            <StatusIcon className={cn('h-3.5 w-3.5 shrink-0', statusMeta.iconClass)} />
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">PMS Sync</span>
            <Badge variant="outline" className="h-4 px-1.5 text-[10px] font-medium">{statusMeta.label}</Badge>
            {isFresh && !busy && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-px text-[9px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                <Activity className="h-2.5 w-2.5" />
                Live
              </span>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1 tabular-nums">
              <Clock className="h-3 w-3" />
              {relTime}
            </span>
            {t.lastAt && total > 0 && (
              <>
                <span className="opacity-40">·</span>
                <span>
                  <span className="font-medium text-foreground tabular-nums">{updated}</span>
                  <span className="tabular-nums">/{total}</span> rooms
                </span>
                {checkouts > 0 && (
                  <>
                    <span className="opacity-40">·</span>
                    <span className="inline-flex items-center gap-1">
                      <DoorOpen className="h-3 w-3" />
                      <span className="font-medium text-foreground tabular-nums">{checkouts}</span>
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
        className={cn(
          'relative z-10 h-8 w-full shrink-0 gap-1.5 overflow-hidden bg-background/60 backdrop-blur sm:w-auto sm:self-center',
          busy && 'border-primary/60 text-primary',
        )}
      >
        {/* Blue progress fill that sweeps across the button while syncing */}
        {busy && (
          <>
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-primary/15"
            />
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 left-0 w-full origin-left bg-gradient-to-r from-primary/40 via-primary/30 to-primary/10"
              style={{ animation: 'pms-fill 1.8s ease-in-out infinite' }}
            />
            <style>{`
              @keyframes pms-fill {
                0%   { transform: scaleX(0);   opacity: 0.9; }
                70%  { transform: scaleX(1);   opacity: 0.85; }
                100% { transform: scaleX(1);   opacity: 0; }
              }
            `}</style>
          </>
        )}
        <span className="relative z-10 inline-flex items-center gap-1.5">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          <span>{busy ? 'Refreshing' : 'PMS Refresh'}</span>
        </span>
      </Button>
    </div>
  );
}
