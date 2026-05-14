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
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);

  const isAllowedHotel = profile?.assigned_hotel === ALLOWED_HOTEL;
  const isManager = profile?.role ? MANAGER_ROLES.has(profile.role) : false;
  const visible = isAllowedHotel && isManager;

  useEffect(() => {
    if (!visible) return;
    (async () => {
      const { data } = await supabase
        .from('pms_sync_history')
        .select('changed_at, created_at')
        .eq('hotel_id', ALLOWED_HOTEL)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      const ts = (data as any)?.changed_at || (data as any)?.created_at;
      if (ts) setLastSyncAt(new Date(ts));
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

      // Log a sync history entry so the timestamp stays accurate.
      try {
        await supabase.from('pms_sync_history').insert({
          hotel_id: ALLOWED_HOTEL,
          sync_type: 'rooms_refresh',
          sync_status: errors.length ? 'partial' : 'success',
          error_message: errors.length ? errors.slice(0, 5).join(' | ') : null,
          data: { updated, notFound, total: rows.length },
        } as any);
      } catch (_) { /* non-fatal */ }

      setLastSyncAt(new Date());
      const checkouts = rows.filter((r) => r.Departure).length;
      toast.success(
        `PMS refreshed — ${updated} rooms updated, ${checkouts} checkouts today`
          + (notFound ? ` · ${notFound} not matched` : ''),
      );
      onRefreshed?.();
    } catch (e: any) {
      console.error('[PmsRefresh] failed:', e);
      toast.error(`PMS refresh failed: ${e?.message || 'unknown error'}`);
    } finally {
      setBusy(false);
    }
  };

  if (!visible) return null;

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        onClick={handleRefresh}
        disabled={busy}
        className="flex items-center gap-2 w-full sm:w-auto touch-manipulation relative z-10 pointer-events-auto"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        <span className="truncate">PMS Refresh</span>
      </Button>
      {lastSyncAt && (
        <span className="hidden md:inline text-xs text-muted-foreground">
          {formatDistanceToNow(lastSyncAt)} ago
        </span>
      )}
    </div>
  );
}
