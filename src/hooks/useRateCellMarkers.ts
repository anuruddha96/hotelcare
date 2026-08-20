import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { indexCellMarkers, dayMarkers, type CellMarkerRow } from "@/lib/rateMarkers";
import { RECENT_WINDOW_MS } from "@/lib/rateOrigin";

/**
 * One bounded fetch per visible calendar range: the newest change on every
 * price cell, straight from the database. This is what keeps the blue/purple
 * dots alive across a browser reload — no optimistic state involved.
 *
 * `rate_cell_markers` collapses the trail server-side (one row per cell), so a
 * four-month range costs a couple of thousand rows instead of the tens of
 * thousands the raw audit table writes every day.
 */
export function useRateCellMarkers(hotelId?: string | null, from?: string, to?: string, sinceMs?: number) {
  const [rows, setRows] = useState<CellMarkerRow[]>([]);
  const [loading, setLoading] = useState(false);
  /** Re-derive the Budapest day boundary as the clock crosses midnight. */
  const [tick, setTick] = useState(() => Date.now());

  const load = useCallback(async () => {
    if (!hotelId || !from || !to) { setRows([]); return; }
    setLoading(true);
    try {
      const since = new Date(Date.now() - RECENT_WINDOW_MS).toISOString();
      // ONE call. This read collapses a week of audit rows per cell, which on a
      // busy property costs several seconds — paging it in 1000-row chunks re-ran
      // that whole scan for every page, so the dots arrived far too late (or not
      // at all) and only a hovered cell's own history could colour them.
      const { data, error } = await supabase.rpc("rate_cell_markers", {
        p_hotel_id: hotelId,
        p_from: from,
        p_to: to,
        p_since: since,
        p_limit: 20000,
        p_offset: 0,
      } as never);
      if (error) throw error;
      setRows((data ?? []) as unknown as CellMarkerRow[]);

    } catch (err) {
      // A failed refresh must never erase markers we already have on screen —
      // that is exactly how a reload used to lose every change dot.
      if (import.meta.env.DEV) console.warn("[rate_cell_markers] failed", err);
    } finally {
      setLoading(false);
    }
  }, [hotelId, from, to]);



  useEffect(() => { void load(); }, [load]);

  /** Never show one property's markers on another's calendar. */
  useEffect(() => { setRows([]); }, [hotelId]);

  const loadRef = useRef(load);

  loadRef.current = load;
  useEffect(() => {
    const timer = window.setInterval(() => setTick(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const byCell = useMemo(() => indexCellMarkers(rows), [rows]);
  const byDate = useMemo(() => dayMarkers(byCell, tick, sinceMs), [byCell, tick, sinceMs]);

  return { rows, byCell, byDate, loading, reload: load };
}
