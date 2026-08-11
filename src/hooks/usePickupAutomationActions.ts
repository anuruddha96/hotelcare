import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cellKey } from "@/lib/rateAudit";

export interface AutomationAction {
  id: string;
  stay_date: string;
  room_type_name: string | null;
  occupancy: number;
  old_price: number | null;
  new_price: number | null;
  increase_amount: number | null;
  pickup_sequence: number | null;
  reservation_id: string | null;
  pickup_at: string | null;
  status: string;
  created_at: string;
}

/**
 * Price moves the pickup automation made for one hotel, indexed by grid cell so
 * the calendar can mark them apart from a human price change.
 */
export function usePickupAutomationActions(hotelId?: string | null, limit = 1000) {
  const [rows, setRows] = useState<AutomationAction[]>([]);

  const load = useCallback(async () => {
    if (!hotelId) { setRows([]); return; }
    const from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data } = await supabase
      .from("revenue_pickup_automation_actions")
      .select("id, stay_date, room_type_name, occupancy, old_price, new_price, increase_amount, pickup_sequence, reservation_id, pickup_at, status, created_at")
      .eq("hotel_id", hotelId)
      .gte("created_at", from)
      .order("created_at", { ascending: false })
      .limit(limit);
    setRows((data ?? []) as unknown as AutomationAction[]);
  }, [hotelId, limit]);

  useEffect(() => { void load(); }, [load]);

  const byCell = useMemo(() => {
    const map = new Map<string, AutomationAction[]>();
    for (const r of rows) {
      const key = cellKey(r.stay_date, r.room_type_name ?? "", r.occupancy);
      const list = map.get(key) ?? [];
      list.push(r);
      map.set(key, list);
    }
    return map;
  }, [rows]);

  return { rows, byCell, reload: load };
}
