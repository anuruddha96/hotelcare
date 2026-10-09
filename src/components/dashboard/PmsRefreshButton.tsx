import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Loader2, CheckCircle2, AlertTriangle, XCircle, Clock, DoorOpen, Radio, Activity, Sparkles } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useLiveSync } from '@/contexts/LiveSyncContext';
import { formatDistanceToNowStrict, formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { PmsSyncHistoryPanel } from '@/components/pms/PmsSyncHistoryPanel';

interface Props {
  onRefreshed?: () => void;
}


const MANAGER_ROLES = new Set([
  'admin',
  'top_management',
  'top_management_manager',
  'manager',
  'housekeeping_manager',
  'reception_manager',
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

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [coverageOpen, setCoverageOpen] = useState(false);
  const [justSuccess, setJustSuccess] = useState(false);

  // Show for all eligible managers regardless of whether the hotel has a
  // Previo config wired up — the refresh will simply no-op / show an error
  // toast for hotels on manual PMS uploads, and managers still want to see
  // and click the button.
  if (!isManager) return null;

  const t = tasks.pms;
  const queued = t.status === 'queued';
  const busy = t.status === 'syncing' || queued;
  const ageMs = t.lastAt ? Date.now() - t.lastAt.getTime() : null;
  // Fresh = updated within the last 60s -> stronger live feel.
  const isFresh = ageMs !== null && ageMs < 60_000;

  const statusMeta = (() => {
    if (queued) {
      return {
        label: 'Queued',
        Icon: Clock,
        iconClass: 'text-amber-600',
        wrapClass: 'border-amber-400/50 bg-amber-50/60 dark:bg-amber-900/10',
        dotClass: 'bg-amber-500',
        ringClass: 'bg-amber-400',
      };
    }
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
  const syncedRooms: string[] = Array.isArray(meta.syncedRooms)
    ? meta.syncedRooms
    : Array.from(new Set([...(meta.checkoutRooms || []), ...(meta.dailyRooms || [])]));
  const missingRooms: string[] = Array.isArray(meta.missingRooms) ? meta.missingRooms : [];
  const unmatchedRooms: string[] = Array.isArray(meta.unmatchedRooms) ? meta.unmatchedRooms : [];
  const excludedRooms: string[] = Array.isArray(meta.excludedRooms) ? meta.excludedRooms : [];
  const coverageIssueCount = missingRooms.length + unmatchedRooms.length;
  const relTime = busy
    ? 'syncing now'
    : t.lastAt
      ? ageMs !== null && ageMs < 5_000
        ? 'just now'
        : `${formatDistanceToNowStrict(t.lastAt)} ago`
      : '—';

  // Heartbeat ping cadence: fast when syncing, slow when fresh, none when stale.
  const showPing = busy || isFresh || t.status === 'error';

  const doRefresh = async () => {
    if (!enabled) {
      toast.error('PMS not connected', {
        description: 'This hotel has no active Previo integration. Ask an admin to configure PMS to enable Team View sync.',
        duration: 5000,
      });
      return;
    }
    const outcome = await refresh('pms');
    // refresh('pms') always returns a RefreshOutcome from the context.
    const result = outcome as { ran: boolean; status: string; message?: string; meta?: any } | undefined;

    if (!result || result.ran === false) {
      toast.message('PMS sync skipped', {
        description: result?.message || 'Nothing to sync right now.',
        duration: 4000,
      });
      return;
    }
    if (result.status === 'error') {
      toast.error('PMS sync failed', {
        description: result.message || 'Could not reach Previo. Check the connection and try again.',
        duration: 6000,
      });
      return;
    }
    if (result.status === 'queued') {
      toast.message('PMS refresh queued', {
        description: result.message || 'Another refresh is in progress. Your request is next.',
        duration: 6000,
      });
      return; // No success toast or completed broadcast until server jobs finish.
    }
    const meta = result.meta || {};
    const updatedCount = meta.updated ?? meta.upserted ?? 0;
    const totalCount = meta.total ?? meta.rowCount ?? 0;
    if (result.status === 'partial') {
      toast.warning('PMS data incomplete', {
        description: result.message || `${updatedCount}/${totalCount} rooms synced. Please review PMS sync history.`,
        duration: 6000,
      });
    } else {
      setJustSuccess(true);
      toast.success('✨ PMS sync complete', {
        description: totalCount > 0
          ? `Team View is now up to date with Previo (${updatedCount}/${totalCount} rooms).`
          : 'Team View is now up to date with Previo.',
        duration: 3500,
      });
      setTimeout(() => setJustSuccess(false), 1600);
    }
    // Broadcast so the Hotel Room Overview card can flash a matching glow —
    // only when we actually ran and didn't outright fail.
    try { window.dispatchEvent(new CustomEvent('pms-sync-completed')); } catch { /* noop */ }
    onRefreshed?.();
  };

  const handleClick = async () => {
    // If last sync <10 min old, ask for confirmation.
    if (t.lastAt && Date.now() - t.lastAt.getTime() < 10 * 60 * 1000) {
      setConfirmOpen(true);
      return;
    }
    await doRefresh();
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
            <button
              type="button"
              onClick={() => setHistoryOpen(true)}
              className="inline-flex items-center gap-1 tabular-nums underline-offset-2 hover:underline"
              title="View PMS sync history"
            >
              <Clock className="h-3 w-3" />
              {relTime}
            </button>
            {t.lastAt && total > 0 && (
              <>
                <span className="opacity-40">·</span>
                <button
                  type="button"
                  onClick={() => setCoverageOpen(true)}
                  className="rounded px-1 py-0.5 underline-offset-2 hover:bg-background/70 hover:underline"
                  title="View synced and unsynced room coverage"
                >
                  <span className="font-medium text-foreground tabular-nums">{updated}</span>
                  <span className="tabular-nums">/{total}</span> rooms
                </button>
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
                {(coverageIssueCount > 0 || notFound > 0) && (
                  <>
                    <span className="opacity-40">·</span>
                    <button
                      type="button"
                      onClick={() => setCoverageOpen(true)}
                      className="font-medium text-amber-700 underline-offset-2 hover:underline dark:text-amber-400"
                    >
                      {missingRooms.length > 0 && `${missingRooms.length} active room${missingRooms.length === 1 ? '' : 's'} not synced`}
                      {missingRooms.length > 0 && (unmatchedRooms.length > 0 || notFound > 0) ? ' · ' : ''}
                      {(unmatchedRooms.length > 0 || notFound > 0) && `${unmatchedRooms.length || notFound} PMS listing${(unmatchedRooms.length || notFound) === 1 ? '' : 's'} not mapped`}
                    </button>
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
        data-training-id="pms-refresh-btn"
        className={cn(
          'relative z-10 h-8 w-full shrink-0 gap-1.5 overflow-hidden bg-background/60 backdrop-blur sm:w-auto sm:self-center',
          busy && 'border-primary/60 text-primary',
          justSuccess && 'ring-2 ring-emerald-400 ring-offset-2',
        )}
      >
        {busy && (
          <>
            <span aria-hidden className="pointer-events-none absolute inset-0 bg-primary/15" />
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
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : justSuccess ? <Sparkles className="h-3.5 w-3.5 text-emerald-500" /> : <RefreshCw className="h-3.5 w-3.5" />}
          <span>{queued ? 'Queued' : busy ? 'Refreshing' : justSuccess ? 'Synced!' : 'PMS Refresh'}</span>
        </span>
      </Button>

      <Dialog open={coverageOpen} onOpenChange={setCoverageOpen}>
        <DialogContent className="max-h-[88dvh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>PMS room coverage</DialogTitle>
            <DialogDescription>
              Operational SLNT coverage only. Confirmed inactive inventory — Technikai, WR Pension, Sobi Apartment Budapest and Downtown Terrace Passion — is ignored and never creates a warning.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border bg-emerald-500/5 p-3">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Synced</div>
              <div className="mt-1 text-2xl font-semibold text-emerald-700 dark:text-emerald-400">{updated}</div>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Operational total</div>
              <div className="mt-1 text-2xl font-semibold">{total}</div>
            </div>
            <div className={cn('rounded-lg border p-3', coverageIssueCount ? 'border-amber-300 bg-amber-50 dark:bg-amber-950/20' : 'bg-emerald-500/5')}>
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Needs attention</div>
              <div className={cn('mt-1 text-2xl font-semibold', coverageIssueCount ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400')}>{coverageIssueCount}</div>
            </div>
          </div>

          <div className="space-y-4">
            <section>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold">Successfully synced</h3>
                <Badge variant="secondary">{syncedRooms.length}</Badge>
              </div>
              {syncedRooms.length > 0 ? (
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {syncedRooms.map(room => (
                    <div key={room} className="flex items-center gap-2 rounded-md border px-2.5 py-2 text-sm">
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                      <span className="min-w-0 truncate">{room}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Run PMS Refresh to populate room-level coverage.</p>
              )}
            </section>

            {missingRooms.length > 0 && (
              <section>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-300">Active rooms not synced</h3>
                  <Badge variant="outline">{missingRooms.length}</Badge>
                </div>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {missingRooms.map(room => (
                    <div key={room} className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-2 text-sm dark:bg-amber-950/20">
                      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                      <span className="min-w-0 truncate">{room}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {unmatchedRooms.length > 0 && (
              <section>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-300">PMS listings not mapped</h3>
                  <Badge variant="outline">{unmatchedRooms.length}</Badge>
                </div>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {unmatchedRooms.map(room => (
                    <div key={room} className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-2 text-sm dark:bg-amber-950/20">
                      <XCircle className="h-4 w-4 shrink-0 text-amber-600" />
                      <span className="min-w-0 truncate">{room}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {excludedRooms.length > 0 && (
              <section>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-muted-foreground">Ignored confirmed inactive PMS listings</h3>
                  <Badge variant="secondary">{excludedRooms.length}</Badge>
                </div>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {excludedRooms.map(room => (
                    <div key={room} className="rounded-md border bg-muted/30 px-2.5 py-2 text-sm text-muted-foreground">
                      {room}
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <PmsSyncHistoryPanel
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        hotelId={profile?.assigned_hotel ?? null}
      />

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sync again so soon?</AlertDialogTitle>
            <AlertDialogDescription>
              Last PMS sync was <b>{t.lastAt ? formatDistanceToNow(t.lastAt) : 'just now'} ago</b>. Running another sync will contact Previo again and may briefly re-shuffle the room chips as fresh data arrives.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConfirmOpen(false); void doRefresh(); }}>
              Sync again
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
