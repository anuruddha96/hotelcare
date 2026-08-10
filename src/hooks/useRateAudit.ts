import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cellKey, type RateAuditRow } from "@/lib/rateAudit";

/**
 * Price-change activity for one hotel: the newest entries for the activity
 * panel, plus an index by cell so the grid can show a date/room type's own
 * history on hover.
 */
export function useRateAudit(hotelId?: string | null, limit = 400) {
  const [rows, setRows] = useState<RateAuditRow[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!hotelId) { setRows([]); return; }
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("rate_change_audit")
        .select("id, stay_date, action, source, old_rate_eur, new_rate_eur, delta_eur, notes, performed_at, performed_by, payload")
        .eq("hotel_id", hotelId)
        .order("performed_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      const list = (data ?? []) as unknown as RateAuditRow[];
      setRows(list);

      const ids = Array.from(new Set(list.map((r) => r.performed_by).filter(Boolean))) as string[];
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
  }, [hotelId, limit]);

  useEffect(() => { void load(); }, [load]);

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

  return { rows, byCell, names, loading, reload: load };
}
