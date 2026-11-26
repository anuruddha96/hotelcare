import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { todayBudapest } from '@/lib/budapestTime';
import type { BreakfastSignal } from '@/lib/housekeepingTaskOrder';

const fields = 'id,room_id,signal_date,first_seen_at,last_seen_at,window_ends_at,guests_seen,guests_expected,closed_at';

export function useHousekeepingBreakfastSignals(userId: string | undefined, org: string | null | undefined, date: string, roomIds: string[]) {
  const ids = JSON.stringify([...new Set(roomIds)].sort());
  const [now, setNow] = useState(() => new Date());
  const scope = JSON.stringify([userId, org, date, ids]);
  const [snapshot, setSnapshot] = useState<{ scope: string; rows: BreakfastSignal[] }>({ scope: '', rows: [] });
  const refreshRef = useRef<() => void>(() => {});
  const refresh = useCallback(() => refreshRef.current(), []);

  useEffect(() => {
    const tick = () => setNow(new Date());
    const timer = window.setInterval(tick, 60_000);
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', tick);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', tick); document.removeEventListener('visibilitychange', tick); };
  }, []);

  const isToday = date === todayBudapest(now);
  useEffect(() => {
    const rooms: string[] = JSON.parse(ids);
    if (!userId || !org || !isToday || !rooms.length) return;
    let live = true;
    let request = 0;
    let debounce: number | undefined;
    const load = async () => {
      const version = ++request;
      try {
        const { data, error } = await (supabase as any).from('housekeeping_breakfast_signals')
          .select(fields).eq('organization_slug', org).eq('signal_date', date).in('room_id', rooms);
        if (live && version === request) setSnapshot({ scope, rows: error ? [] : data || [] });
      } catch {
        if (live && version === request) setSnapshot({ scope, rows: [] });
      }
    };
    const schedule = () => {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(() => void load(), 100);
    };
    refreshRef.current = schedule;
    void load();
    const channel = supabase.channel('housekeeping-breakfast-' + userId + '-' + crypto.randomUUID())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'housekeeping_breakfast_signals', filter: 'organization_slug=eq.' + org }, schedule)
      .subscribe(status => { if (status === 'SUBSCRIBED') schedule(); });
    window.addEventListener('focus', schedule);
    window.addEventListener('online', schedule);
    document.addEventListener('visibilitychange', schedule);
    return () => {
      live = false;
      refreshRef.current = () => {};
      window.clearTimeout(debounce);
      window.removeEventListener('focus', schedule);
      window.removeEventListener('online', schedule);
      document.removeEventListener('visibilitychange', schedule);
      void supabase.removeChannel(channel);
    };
  }, [userId, org, date, ids, scope, isToday]);

  const signals = useMemo(() => new Map((isToday && snapshot.scope === scope ? snapshot.rows : []).map(s => [s.room_id, s])), [isToday, snapshot, scope]);
  return { signals, now, refresh };
}
