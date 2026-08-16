import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  decision_reason?: string | null;
  /** One plain sentence explaining why the automation moved (or held) the price. */
  reason_detail?: string | null;
  /** Set while a price drop is waiting out the cancellation cooldown. */
  hold_until?: string | null;
  decision_type?: string | null;
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

  /**
   * The hotel-wide read above is capped, and the engine writes hundreds of rows
   * an hour, so a date a few weeks out falls outside it and its cells lose the
   * "why did this move?" line. Load one stay date on demand and merge it in.
   */
  const loadedDates = useRef(new Set<string>());
  useEffect(() => { loadedDates.current = new Set(); }, [hotelId]);

  const loadDate = useCallback(async (date: string, force = false) => {
    if (!hotelId || !date) return;
    if (!force && loadedDates.current.has(date)) return;
    loadedDates.current.add(date);
    const { data } = await supabase
      .from("revenue_pickup_automation_actions")
      .select("id, stay_date, room_type_name, occupancy, old_price, new_price, increase_amount, pickup_sequence, reservation_id, pickup_at, status, created_at, decision_reason, reason_detail, hold_until, decision_type")
      .eq("hotel_id", hotelId)
      .eq("stay_date", date)
      .order("created_at", { ascending: false })
      .limit(400);
    const fresh = (data ?? []) as unknown as AutomationAction[];
    if (fresh.length === 0) return;
    setRows((prev) => {
      const seen = new Set(prev.map((r) => r.id));
      const added = fresh.filter((r) => !seen.has(r.id));
      return added.length > 0 ? [...prev, ...added] : prev;
    });
  }, [hotelId]);

  /**
   * Live cancellation holds, per STAY DATE — the cooldown applies to the whole
   * date, not to one room type. A cooldown that has already elapsed is dropped.
   */
  const holdsByDate = useMemo(() => {
    const map = new Map<string, AutomationAction>();
    const now = Date.now();
    for (const r of rows) {
      if (!isHoldAction(r) || !r.hold_until) continue;
      if (Date.parse(r.hold_until) <= now) continue;
      const seen = map.get(r.stay_date);
      if (!seen || r.created_at > seen.created_at) map.set(r.stay_date, r);
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

  return { rows, byCell, holdsByDate, reload: load };
}
