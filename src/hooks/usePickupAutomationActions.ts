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
  /** Machine code: no_pickup | cancellation | positive_pickup | strong_demand | cancellation_cooldown */
  decision_reason: string | null;
  /** One plain sentence explaining why the automation moved (or held) the price. */
  reason_detail: string | null;
  /** Set while a price drop is waiting out the cancellation cooldown. */
  hold_until: string | null;
  decision_type: string | null;
}

/** A price drop the automation is deliberately delaying, with its release time. */
export function isHoldAction(a: AutomationAction): boolean {
  return a.decision_reason === "cancellation_cooldown" || a.decision_type === "cancellation_cooldown";
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
      .select("id, stay_date, room_type_name, occupancy, old_price, new_price, increase_amount, pickup_sequence, reservation_id, pickup_at, status, created_at, decision_reason, reason_detail, hold_until, decision_type")
      .eq("hotel_id", hotelId)
      .gte("created_at", from)
      .order("created_at", { ascending: false })
      .limit(limit);
    setRows((data ?? []) as unknown as AutomationAction[]);
  }, [hotelId, limit]);

  useEffect(() => { void load(); }, [load]);

  /** Live holds only: a cooldown that has already elapsed is not news. */
  const holdsByCell = useMemo(() => {
    const map = new Map<string, AutomationAction>();
    const now = Date.now();
    for (const r of rows) {
      if (!isHoldAction(r) || !r.hold_until) continue;
      if (Date.parse(r.hold_until) <= now) continue;
      const key = cellKey(r.stay_date, r.room_type_name ?? "", r.occupancy);
      const seen = map.get(key);
      if (!seen || r.created_at > seen.created_at) map.set(key, r);
    }
    return map;
  }, [rows]);

  const byCell = useMemo(() => {
    const map = new Map<string, AutomationAction[]>();
    for (const r of rows) {
      if (isHoldAction(r)) continue;   // a hold is not a price change
      const key = cellKey(r.stay_date, r.room_type_name ?? "", r.occupancy);
      const list = map.get(key) ?? [];
      list.push(r);
      map.set(key, list);
    }
    return map;
  }, [rows]);

  return { rows, byCell, holdsByCell, reload: load };
}
