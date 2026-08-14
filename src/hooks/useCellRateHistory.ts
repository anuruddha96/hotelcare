import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cellKey, type RateAuditRow } from "@/lib/rateAudit";
import { RECENT_WINDOW_MS } from "@/lib/rateOrigin";

/**
 * Real, per-cell price history — read on demand, one stay date at a time.
 *
 * The shared audit window could only ever hold the newest rows for the whole
 * hotel, so on a busy day the lower room types (Deluxe Queen, Luxury Triple …)
 * had a change dot but an empty drawer. `rate_cell_history` returns the last
 * few rows for EVERY cell on one date, which is a few hundred rows at most and
 * is fetched only when a cell is actually opened or hovered.
 */
export function useCellRateHistory(hotelId?: string | null, perCell = 8) {
  const [byCell, setByCell] = useState<Map<string, RateAuditRow[]>>(new Map());
  const loaded = useRef(new Set<string>());
  const inflight = useRef(new Set<string>());

  useEffect(() => {
    loaded.current = new Set();
    inflight.current = new Set();
    setByCell(new Map());
  }, [hotelId]);

  const loadDate = useCallback(async (date: string, force = false) => {
    if (!hotelId || !date) return;
    if (!force && (loaded.current.has(date) || inflight.current.has(date))) return;
    inflight.current.add(date);
    try {
      const since = new Date(Date.now() - RECENT_WINDOW_MS * 4).toISOString();
      const { data, error } = await supabase.rpc("rate_cell_history", {
        p_hotel_id: hotelId,
        p_stay_date: date,
        p_since: since,
        p_per_cell: perCell,
      });
      if (error) throw error;
      const rows = (data ?? []) as unknown as RateAuditRow[];
      setByCell((prev) => {
        const next = new Map(prev);
        // Replace everything previously known for this date so a refresh never
        // duplicates rows.
        for (const key of Array.from(next.keys())) {
          if (key.startsWith(`${date}|`)) next.delete(key);
        }
        for (const r of rows) {
          const rt = r.payload?.room_type_name;
          const occ = r.payload?.occupancy;
          if (!r.stay_date || !rt || occ === undefined) continue;
          const key = cellKey(r.stay_date, rt, occ);
          const bucket = next.get(key);
          if (bucket) bucket.push(r); else next.set(key, [r]);
        }
        return next;
      });
      loaded.current.add(date);
    } catch {
      /* history is a read-only convenience */
    } finally {
      inflight.current.delete(date);
    }
  }, [hotelId, perCell]);

  /** Forget everything so the next open re-reads fresh rows. */
  const invalidate = useCallback(() => {
    loaded.current = new Set();
    setByCell(new Map());
  }, []);

  return { byCell, loadDate, invalidate };
}
