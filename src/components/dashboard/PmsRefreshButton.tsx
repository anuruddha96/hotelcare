import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Loader2, CheckCircle2, AlertTriangle, XCircle, Clock, DoorOpen } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { resolveHotelKeys } from '@/lib/hotelKeys';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';

interface Props {
  /** Called after a successful refresh so parent views can re-fetch. */
  onRefreshed?: () => void;
}

type SyncStatus = 'success' | 'partial' | 'error' | 'idle';

interface LastSyncInfo {
  at: Date;
  status: SyncStatus;
  updated: number;
  total: number;
  notFound: number;
  checkouts: number;
}

const ALLOWED_HOTEL = 'previo-test';
const MANAGER_ROLES = new Set([
  'admin',
  'top_management',
  'manager',
  'housekeeping_manager',
  'front_office',
]);

/**
 * PMS Refresh — gated to the Previo test hotel.
 *
 * Pulls today's snapshot from Previo (catalog + reservations) and updates
 * ONLY PMS-derived fields on the rooms table:
 *   - is_checkout_room / checkout_time
 *   - guest_count / guest_nights_stayed / towel & linen flags
 *   - room_name / room_type / room_category / bed_type
 *   - notes
 *
 * It NEVER touches `room_assignments` or `rooms.status` — housekeeper
 * assignments and cleaning progress are preserved. Only manual / auto room
 * assignment by a manager resets assignments.
 *
 * Other hotels (OttoFiori etc.) are not touched: the button is not rendered
 * for them and the edge function refuses any other hotel id.
 */
export function PmsRefreshButton({ onRefreshed }: Props) {
  const { profile, user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [lastSync, setLastSync] = useState<LastSyncInfo | null>(null);
  const [tick, setTick] = useState(0); // re-render so "x min ago" stays fresh

  const isAllowedHotel = profile?.assigned_hotel === ALLOWED_HOTEL;
  const isManager = profile?.role ? MANAGER_ROLES.has(profile.role) : false;
  const visible = isAllowedHotel && isManager;

  // Re-render every 30s for relative time accuracy.
  useEffect(() => {
    if (!visible) return;
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    (async () => {
      const { data } = await supabase
        .from('pms_sync_history')
        .select('changed_at, created_at, sync_status, data')
        .eq('hotel_id', ALLOWED_HOTEL)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      const ts = (data as any)?.changed_at || (data as any)?.created_at;
      if (!ts) return;
      const d = (data as any)?.data || {};
      setLastSync({
        at: new Date(ts),
        status: ((data as any)?.sync_status as SyncStatus) || 'success',
        updated: d.updated ?? d.upserted ?? d.updated_rooms ?? 0,
        total: d.total ?? d.rowCount ?? 0,
        notFound: d.notFound ?? 0,
        checkouts: d.checkouts ?? 0,
      });
    })();
  }, [visible]);

  const extractRoomNumber = (raw: string): string => {
    const m = String(raw).match(/\d+/);
    return m ? m[0] : String(raw).trim();
  };

  const excelTimeToString = (val: any): string | null => {
    if (val === null || val === undefined || val === '') return null;
    const s = String(val).trim();
    return s.length > 0 ? s : null;
  };

  const parseNightTotal = (val: any): { currentNight: number; totalNights: number } | null => {
    if (!val) return null;
    const m = String(val).match(/(\d+)\s*\/\s*(\d+)/);
    if (!m) return null;
    return { currentNight: parseInt(m[1], 10), totalNights: parseInt(m[2], 10) };
  };

  const handleRefresh = async () => {
    if (!visible || !user) return;
    setBusy(true);
    try {
      // Step 1 — make sure the rooms catalog is in sync.
      try {
        await supabase.functions.invoke('previo-sync-rooms', {
          body: { hotelId: ALLOWED_HOTEL, importLocal: true },
        });
      } catch (e) {
        console.warn('[PmsRefresh] catalog sync warning (non-fatal):', e);
      }

      // Step 2 — pull today's PMS snapshot.
      const { data, error } = await supabase.functions.invoke('previo-pms-sync', {
        body: { hotelId: ALLOWED_HOTEL },
      });
      if (error || (data && data.ok === false)) {
        throw new Error((data as any)?.error || error?.message || 'PMS sync failed');
      }
      const rows: any[] = (data as any)?.rows || [];
      if (rows.length === 0) {
        toast.warning('Previo returned no rooms');
        return;
      }

      // Resolve hotel keys for room scoping.
      const keys = await resolveHotelKeys(ALLOWED_HOTEL);
      const hotelKeys = keys.length ? keys : [ALLOWED_HOTEL];

      let updated = 0;
      let notFound = 0;
      let checkouts = 0;
      const errors: string[] = [];
      const today = new Date().toISOString().split('T')[0];

      for (const row of rows) {
        try {
          const rawRoomName = String(row.Room ?? '').trim();
          if (!rawRoomName) continue;
          const roomNumber = extractRoomNumber(rawRoomName);

          const lookup = async (matcher: (q: any) => any) => {
            let q = supabase
              .from('rooms')
              .select('id, room_number, status, is_checkout_room')
              .in('hotel', hotelKeys);
            return await matcher(q);
          };

          let { data: rooms } = await lookup((q) => q.eq('room_number', rawRoomName));
          if ((!rooms || rooms.length === 0) && rawRoomName !== roomNumber) {
            ({ data: rooms } = await lookup((q) => q.ilike('room_number', rawRoomName)));
          }
          if ((!rooms || rooms.length === 0) && roomNumber && roomNumber !== rawRoomName) {
            ({ data: rooms } = await lookup((q) => q.eq('room_number', roomNumber)));
          }
          if (!rooms || rooms.length === 0) {
            notFound++;
            continue;
          }
          const room = rooms[0];

          const departureParsed = excelTimeToString(row.Departure);
          const isCheckout = departureParsed !== null;

          const nightTotal = parseNightTotal(row['Night / Total']);
          let guestNightsStayed = 0;
          let totalNights = 0;
          let towel = false;
          let linen = false;
          if (nightTotal) {
            guestNightsStayed = nightTotal.currentNight;
            totalNights = nightTotal.totalNights;
            if (guestNightsStayed >= 3) {
              const cyc = (guestNightsStayed - 3) % 4;
              if (cyc === 0) towel = true;
              else if (cyc === 2) linen = true;
            }
          }

          const updateData: Record<string, any> = {
            // PMS-derived only — never mutate `status` or assignment fields.
            is_checkout_room: isCheckout,
            checkout_time: isCheckout ? new Date().toISOString() : null,
            guest_count: row.People ?? 0,
            guest_nights_stayed: guestNightsStayed,
            towel_change_required: towel,
            linen_change_required: linen,
            updated_at: new Date().toISOString(),
          };
          if (towel) updateData.last_towel_change = today;
          if (linen) updateData.last_linen_change = today;
          if (row.Note) updateData.notes = String(row.Note);

          const { error: updErr } = await supabase
            .from('rooms')
            .update(updateData)
            .eq('id', room.id);
          if (updErr) {
            errors.push(`Room ${rawRoomName}: ${updErr.message}`);
          } else {
            updated++;
          }
        } catch (e: any) {
          errors.push(`Row error: ${e?.message || String(e)}`);
        }
      }

      const checkouts = rows.filter((r) => r.Departure).length;
      const status: SyncStatus = errors.length ? 'partial' : 'success';

      // Log a sync history entry so the timestamp stays accurate.
      try {
        await supabase.from('pms_sync_history').insert({
          hotel_id: ALLOWED_HOTEL,
          sync_type: 'rooms_refresh',
          sync_status: status,
          error_message: errors.length ? errors.slice(0, 5).join(' | ') : null,
          data: { updated, notFound, total: rows.length, checkouts },
        } as any);
      } catch (_) { /* non-fatal */ }

      setLastSync({
        at: new Date(),
        status,
        updated,
        total: rows.length,
        notFound,
        checkouts,
      });
      toast.success(
        `PMS refreshed — ${updated} rooms updated, ${checkouts} checkouts today`
          + (notFound ? ` · ${notFound} not matched` : ''),
      );
      onRefreshed?.();
    } catch (e: any) {
      console.error('[PmsRefresh] failed:', e);
      setLastSync((prev) => ({
        at: new Date(),
        status: 'error',
        updated: 0,
        total: 0,
        notFound: 0,
        checkouts: 0,
        ...(prev ? {} : {}),
      }));
      toast.error(`PMS refresh failed: ${e?.message || 'unknown error'}`);
    } finally {
      setBusy(false);
    }
  };

  if (!visible) return null;

  // Status visuals
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
    if (!lastSync) {
      return {
        label: 'Not synced yet',
        Icon: Clock,
        iconClass: 'text-muted-foreground',
        wrapClass: 'border-border bg-muted/30',
        dotClass: 'bg-muted-foreground/50',
      };
    }
    if (lastSync.status === 'error') {
      return {
        label: 'Sync failed',
        Icon: XCircle,
        iconClass: 'text-destructive',
        wrapClass: 'border-destructive/30 bg-destructive/5',
        dotClass: 'bg-destructive',
      };
    }
    if (lastSync.status === 'partial') {
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
  const relTime = lastSync ? `${formatDistanceToNow(lastSync.at)} ago` : '—';
  // touch tick so eslint doesn't complain about unused state
  void tick;

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-lg border px-3 py-2 transition-colors',
        statusMeta.wrapClass,
      )}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="relative flex h-2.5 w-2.5 shrink-0">
          <span
            className={cn(
              'absolute inline-flex h-full w-full rounded-full opacity-60',
              busy ? 'animate-ping' : '',
              statusMeta.dotClass,
            )}
          />
          <span className={cn('relative inline-flex h-2.5 w-2.5 rounded-full', statusMeta.dotClass)} />
        </span>
        <div className="flex flex-col leading-tight min-w-0">
          <div className="flex items-center gap-1.5">
            <StatusIcon className={cn('h-3.5 w-3.5 shrink-0', statusMeta.iconClass)} />
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              PMS Sync
            </span>
            <Badge variant="outline" className="h-4 px-1.5 text-[10px] font-medium">
              {statusMeta.label}
            </Badge>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5 truncate">
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {relTime}
            </span>
            {lastSync && (
              <>
                <span className="opacity-40">·</span>
                <span>
                  <span className="font-medium text-foreground">{lastSync.updated}</span>
                  <span className="hidden sm:inline">/{lastSync.total}</span> rooms
                </span>
                {lastSync.checkouts > 0 && (
                  <>
                    <span className="opacity-40">·</span>
                    <span className="inline-flex items-center gap-1">
                      <DoorOpen className="h-3 w-3" />
                      <span className="font-medium text-foreground">{lastSync.checkouts}</span>
                      <span className="hidden md:inline">checkouts</span>
                    </span>
                  </>
                )}
                {lastSync.notFound > 0 && (
                  <>
                    <span className="opacity-40">·</span>
                    <span className="text-amber-600 dark:text-amber-500">
                      {lastSync.notFound} unmatched
                    </span>
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
        onClick={handleRefresh}
        disabled={busy}
        className="h-8 shrink-0 gap-1.5 bg-background/60 backdrop-blur"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        <span>{busy ? 'Refreshing' : 'PMS Refresh'}</span>
      </Button>
    </div>
  );
}
