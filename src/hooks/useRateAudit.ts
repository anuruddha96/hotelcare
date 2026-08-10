import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cellKey, type RateAuditRow } from "@/lib/rateAudit";

/** Sources written by a person acting in the app (not the alert engine). */
export const HUMAN_SOURCES = ["day-tool", "cell-edit", "demand", "push", "autopilot", "bulk-editor", "pickup-board"];

/**
 * Short-range, hand-made price work. Only these earn the blue marker on a cell:
 * a season-wide bulk edit must not sprinkle dots across every day.
 */
export const MANUAL_SOURCES = ["day-tool", "cell-edit", "pickup-board"];

/**
 * A direct push carries no source of its own, so a short-range push (a handful
 * of dates sent in one go) counts as hand-made work too; a season-wide bulk
 * push does not.
 */
const SHORT_RANGE_DAYS = 7;



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
      // The rate-alert engine writes tens of thousands of rows with no user and
      // no room type; without this filter they bury everything a person did.
      if (!includeSystem) query = query.in("source", HUMAN_SOURCES);
      const { data, error } = await query
        .order("performed_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      const list = (data ?? []) as unknown as RateAuditRow[];
      setRows(list);

      // Hand-made changes are fetched on their own: a season-wide bulk edit can
      // write thousands of rows and would otherwise push every manual entry out
      // of the shared window, making the blue dots disappear from the grid.
      const { data: manualData } = await supabase
        .from("rate_change_audit")
        .select("id, stay_date, action, source, old_rate_eur, new_rate_eur, delta_eur, notes, performed_at, performed_by, payload")
        .eq("hotel_id", hotelId)
        .in("source", [...MANUAL_SOURCES, "push"])
        .order("performed_at", { ascending: false })
        .limit(3000);
      setManualRows((manualData ?? []) as unknown as RateAuditRow[]);



      if (!includeSystem) {
        const { count } = await supabase
          .from("rate_change_audit")
          .select("id", { count: "exact", head: true })
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

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!hotelId) return;
    const channel = supabase
      .channel(`rate-audit:${hotelId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "rate_change_audit", filter: `hotel_id=eq.${hotelId}` },
        () => { void load(); },
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [hotelId, load]);

  const byCell = useMemo(() => {
    const map = new Map<string, RateAuditRow[]>();
    for (const r of rows) {
      const rt = r.payload?.room_type_name;
      const occ = r.payload?.occupancy;
      if (!r.stay_date || !rt || occ === undefined) continue;
      const key = cellKey(r.stay_date, rt, occ);
      const bucket = map.get(key);
      if (bucket) bucket.push(r); else map.set(key, [r]);
    }
    return map;
  }, [rows]);

  /** Only hand-made, short-range changes — this drives the blue cell marker. */
  const manualByCell = useMemo(() => {
    // Direct pushes carry no origin, so cluster them by user and time: a
    // cluster covering a handful of dates was hand-made, a season-wide bulk
    // push was not and must not sprinkle dots everywhere.
    const clusters = new Map<string, Set<string>>();
    const clusterKey = (r: RateAuditRow) =>
      `${r.performed_by ?? "-"}|${Math.floor(new Date(r.performed_at).getTime() / 300000)}`;
    for (const r of manualRows) {
      if (r.source !== "push" || !r.stay_date) continue;
      const k = clusterKey(r);
      const set = clusters.get(k);
      if (set) set.add(r.stay_date); else clusters.set(k, new Set([r.stay_date]));
    }

    const map = new Map<string, RateAuditRow[]>();
    for (const r of manualRows) {
      const rt = r.payload?.room_type_name;
      const occ = r.payload?.occupancy;
      if (!r.stay_date || !rt || occ === undefined || !r.source) continue;
      const handMade = MANUAL_SOURCES.includes(r.source)
        || (r.source === "push" && (clusters.get(clusterKey(r))?.size ?? 0) <= SHORT_RANGE_DAYS);
      if (!handMade) continue;
      const key = cellKey(r.stay_date, rt, occ);
      const bucket = map.get(key);
      if (bucket) bucket.push(r); else map.set(key, [r]);
    }
    return map;
  }, [manualRows]);


  return { rows, byCell, manualByCell, names, loading, systemCount, reload: load };

}
