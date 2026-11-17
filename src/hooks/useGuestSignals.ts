import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { isReservationId, normalizeGuestSignal, type GuestSignal } from '@/lib/guestJourney';

const EMPTY = new Map<string, GuestSignal>();

/**
 * Returning-guest signals (previous stays, VIP, preferences) for the
 * reservations on screen. One small request per distinct set of ids; the
 * server matches each guest by name key and reads only what reception needs.
 */
export function useGuestSignals(ids: Array<string | null | undefined>, version = 0): Map<string, GuestSignal> {
  const key = Array.from(new Set(ids.filter(isReservationId))).sort().slice(0, 300).join(',');
  const [signals, setSignals] = useState<Map<string, GuestSignal>>(EMPTY);

  useEffect(() => {
    if (!key) {
      setSignals(EMPTY);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc('pms_guest_signals', { _reservation_ids: key.split(',') });
      if (cancelled || error || !Array.isArray(data)) return;
      setSignals(new Map(data.map((row: Record<string, unknown>) => {
        const signal = normalizeGuestSignal(row);
        return [signal.reservation_id, signal] as const;
      })));
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key, version]);

  return signals;
}
