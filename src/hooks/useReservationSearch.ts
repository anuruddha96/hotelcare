// Server-side reception search across ALL dates, merged with the instant
// in-memory matches. The planner only loads a window of reservations
// (-45d..+210d), so a direct booking far in the future — or a passport
// number, which the window rows don't carry — was unfindable from the
// search box. The pms_reservation_search RPC searches the whole table
// (passport/ID number first, then reservation number, room number, guest
// name, contact fields) under the caller's own RLS.
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

const DEBOUNCE_MS = 250;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

export function useReservationSearch(hotelKeys: string[], term: string) {
  const [serverResults, setServerResults] = useState<Row[]>([]);
  const [searching, setSearching] = useState(false);
  const seq = useRef(0);
  const keysKey = hotelKeys.join('|');

  useEffect(() => {
    const mySeq = ++seq.current;
    const q = term.trim();
    if (q.length < 2 || !keysKey) {
      setServerResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc('pms_reservation_search', {
        _hotel_ids: keysKey.split('|'),
        _term: q,
      });
      if (mySeq !== seq.current) return; // A newer keystroke superseded this call.
      setServerResults(error ? [] : ((data ?? []) as Row[]));
      setSearching(false);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [keysKey, term]);

  return { serverResults, searching };
}

/** Server hits first (already ranked passport → res no. → room → status), then
 *  any local-only instant matches the server call hasn't returned (yet). */
export function mergeSearchResults(server: Row[], local: Row[], limit = 20): Row[] {
  const seen = new Set<string>();
  const out: Row[] = [];
  for (const row of [...server, ...local]) {
    const id = String(row.id ?? '');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(row);
    if (out.length >= limit) break;
  }
  return out;
}
