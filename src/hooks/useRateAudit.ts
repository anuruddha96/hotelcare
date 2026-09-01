import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cellKey, type RateAuditRow } from "@/lib/rateAudit";

/** Sources written by a person acting in the app (not the alert engine). */
export const HUMAN_SOURCES = ["day-tool", "cell-edit", "demand", "push", "push_automation", "autopilot", "bulk-editor", "pickup-board", "previo_confirmed", "previo_automation_confirmed", "previo_bulk_confirmed", "previo_external", "previo_different"];

/** Only rates confirmed by an authoritative Previo pull earn a cell marker. */
export const MANUAL_SOURCES = ["previo_confirmed"];

/** Where a confirmed price came from, for the cell marker and its wording. */
export type CellOrigin = "hotelcare" | "automation" | "previo" | "different";

export interface CellOriginInfo {
  origin: CellOrigin;
  at: string;
  by: string | null;
  price: number | null;
  requested?: number | null;
}

/**
 * Price-change activity for one hotel: the newest entries for the activity
 * panel, plus an index by cell so the grid can show a date/room type's own
 * history on hover.
 */
export function useRateAudit(hotelId?: string | null, limit = 400, includeSystem = false) {
  const [rows, setRows] = useState<RateAuditRow[]>([]);
  const [manualRows, setManualRows] = useState<RateAuditRow[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [systemCount, setSystemCount] = useState(0);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!hotelId) { setRows([]); setManualRows([]); return; }
    setLoading(true);
    try {
      let query = supabase
        .from("rate_change_audit")
        .select("id, stay_date, action, source, old_rate_eur, new_rate_eur, delta_eur, notes, performed_at, performed_by, payload")
        .eq("hotel_id", hotelId);
      if (!includeSystem) query = query.in("source", HUMAN_SOURCES);
      const { data, error } = await query
        .order("performed_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      const list = (data ?? []) as unknown as RateAuditRow[];
      setRows(list);

      const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
      const { data: manualData } = await supabase
        .from("rate_change_audit")
        .select("id, stay_date, action, source, old_rate_eur, new_rate_eur, delta_eur, notes, performed_at, performed_by, payload")
        .eq("hotel_id", hotelId)
        .gte("performed_at", since)
        .in("source", [...MANUAL_SOURCES, "previo_automation_confirmed", "push_automation", "previo_external", "previo_different"])
        .order("performed_at", { ascending: false })
        .limit(1500);
      setManualRows((manualData ?? []) as unknown as RateAuditRow[]);

      if (!includeSystem) {
        const { count } = await supabase
          .from("rate_change_audit")
          .select("id", { count: "planned", head: true })
          .eq("hotel_id", hotelId)
          .not("source", "in", `(${HUMAN_SOURCES.join(",")})`);
        setSystemCount(count ?? 0);
      } else {
        setSystemCount(0);
      }

      const ids = Array.from(new Set(
        [...list, ...((manualData ?? []) as unknown as RateAuditRow[])]
          .map((r) => r.performed_by)
          .filter(Boolean),
      )) as string[];
      if (ids.length > 0) {
        const { data: profs } = await supabase
          .from("profiles").select("id, full_name, nickname").in("id", ids);
        setNames(new Map((profs ?? []).map((p: any) => [p.id, p.nickname || p.full_name || "Someone"])));
      }
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [hotelId, limit, includeSystem]);

  const loadRef = useRef(load);
  loadRef.current = load;

  // Audit history is useful context, but it is not needed to paint live rates.
  // Delay its initial read until after the browser has had a chance to make the
  // rate grid interactive. Hover/tap-specific history still loads on demand.
  useEffect(() => {
    if (!hotelId) { setRows([]); setManualRows([]); return; }
    const run = () => { void loadRef.current(); };
    const idleWindow = window as typeof window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (idleWindow.requestIdleCallback) {
      const id = idleWindow.requestIdleCallback(run, { timeout: 2600 });
      return () => idleWindow.cancelIdleCallback?.(id);
    }
    const t = window.setTimeout(run, 1600);
    return () => window.clearTimeout(t);
  }, [hotelId, load]);

  useEffect(() => {
    if (!hotelId) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pending = false;
    const schedule = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        if (document.visibilityState !== "visible") { pending = true; return; }
        void loadRef.current();
      }, 12_000);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible" && pending) { pending = false; void loadRef.current(); }
    };
    document.addEventListener("visibilitychange", onVisible);
    const channel = supabase
      .channel(`rate-audit:${hotelId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "rate_change_audit", filter: `hotel_id=eq.${hotelId}` },
        () => { schedule(); },
      )
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      void supabase.removeChannel(channel);
    };
  }, [hotelId]);

  const byCell = useMemo(() => {
    const map = new Map<string, RateAuditRow[]>();
    const seen = new Set<string>();
    const merged = [...rows, ...manualRows]
      .filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)))
      .sort((a, b) => b.performed_at.localeCompare(a.performed_at));
    for (const r of merged) {
      const rt = r.payload?.room_type_name;
      const occ = r.payload?.occupancy;
      if (!r.stay_date || !rt || occ === undefined) continue;
      const key = cellKey(r.stay_date, rt, occ);
      const bucket = map.get(key);
      if (bucket) bucket.push(r); else map.set(key, [r]);
    }
    return map;
  }, [rows, manualRows]);

  const manualByCell = useMemo(() => {
    const map = new Map<string, RateAuditRow[]>();
    for (const r of manualRows) {
      const rt = r.payload?.room_type_name;
      const occ = r.payload?.occupancy;
      if (!r.stay_date || !rt || occ === undefined || !r.source) continue;
      const handMade = MANUAL_SOURCES.includes(r.source);
      if (!handMade) continue;
      const key = cellKey(r.stay_date, rt, occ);
      const bucket = map.get(key);
      if (bucket) bucket.push(r); else map.set(key, [r]);
    }
    return map;
  }, [manualRows]);

  const originByCell = useMemo(() => {
    const map = new Map<string, CellOriginInfo>();
    const ordered = [...manualRows].sort((a, b) => b.performed_at.localeCompare(a.performed_at));
    for (const r of ordered) {
      const rt = r.payload?.room_type_name;
      const occ = r.payload?.occupancy;
      if (!r.stay_date || !rt || occ === undefined || !r.source) continue;
      if (r.source === "previo_different" && r.payload?.resolved_at) continue;
      const key = cellKey(r.stay_date, rt, occ);
      if (map.has(key)) continue;
      const origin: CellOrigin =
        r.source === "previo_confirmed" ? "hotelcare"
          : r.source === "previo_automation_confirmed" ? "automation"
            : r.source === "previo_different" ? "different"
              : "previo";
      map.set(key, {
        origin,
        at: r.performed_at,
        by: r.performed_by,
        price: r.new_rate_eur,
        requested: r.payload?.requested_price ?? null,
      });
    }
    return map;
  }, [manualRows]);

  return { rows, manualRows, byCell, manualByCell, originByCell, names, loading, systemCount, reload: load };
}
