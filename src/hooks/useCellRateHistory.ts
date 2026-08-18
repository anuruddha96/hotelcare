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
  // Names for the people behind these rows. The shared audit window only covers
  // the newest hotel-wide rows, so older cell rows had no name and read as
  // "Someone"; they are resolved here, for the ids actually on screen.
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const knownIds = useRef(new Set<string>());
  const loaded = useRef(new Set<string>());
  const inflight = useRef(new Set<string>());
  /** Newest row this hook has for a date — used to spot a stale cache. */
  const newestByDate = useRef(new Map<string, string>());

  useEffect(() => {
    loaded.current = new Set();
    inflight.current = new Set();
    newestByDate.current = new Map();
    setByCell(new Map());
    knownIds.current = new Set();
    setNames(new Map());
  }, [hotelId]);

  /**
   * `freshAsOf` is the newest change the calendar KNOWS about for this date
   * (from the marker read). If the cache is older than that — or empty while a
   * marker exists — the drawer would open blank next to a coloured dot, so the
   * date is re-read instead of served from cache.
   */
  const loadDate = useCallback(async (date: string, force = false, freshAsOf?: string | null) => {
    if (!hotelId || !date) return;
    const cachedNewest = newestByDate.current.get(date);
    const stale = !!freshAsOf && (!cachedNewest || cachedNewest < freshAsOf);
    if (!force && !stale && (loaded.current.has(date) || inflight.current.has(date))) return;
    if (inflight.current.has(date)) return;
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
      let newest = "";
      for (const r of rows) if (r.performed_at > newest) newest = r.performed_at;
      newestByDate.current.set(date, newest);

      const ids = Array.from(new Set(
        rows.map((r) => r.performed_by).filter((id): id is string => !!id && !knownIds.current.has(id)),
      ));
      if (ids.length > 0) {
        ids.forEach((id) => knownIds.current.add(id));
        const { data: profs } = await supabase
          .from("profiles").select("id, full_name, nickname").in("id", ids);
        if (profs && profs.length > 0) {
          setNames((prev) => {
            const next = new Map(prev);
            for (const p of profs as any[]) {
              const label = p.nickname || p.full_name;
              if (label) next.set(p.id, label);
            }
            return next;
          });
        }
      }
    } catch (err) {
      if (import.meta.env.DEV) console.warn("[rate_cell_history] failed", err);
    } finally {
      inflight.current.delete(date);
    }
  }, [hotelId, perCell]);

  /** Forget everything so the next open re-reads fresh rows. */
  const invalidate = useCallback(() => {
    loaded.current = new Set();
    setByCell(new Map());
  }, []);

  return { byCell, names, loadDate, invalidate };
}
