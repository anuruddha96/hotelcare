import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  monthBounds, shiftMonth, toEconomicsRow, toMonthlyRow,
  type EconomicsRow, type MonthlyEconomicsRow,
} from "@/lib/channelEconomics";

// The RPCs are newer than the generated Supabase types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const PAGE = 1000;

/**
 * Pages through a set-returning RPC. The first page asks for the exact count, so
 * a lower server-side row cap can never silently cut a month short.
 */
export async function fetchAllRpcRows(
  fn: string,
  args: Record<string, unknown>,
  order: string[],
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  let total: number | null = null;
  for (let offset = 0; offset < 60_000; offset += PAGE) {
    let query = db.rpc(fn, args, offset === 0 ? { count: "exact" } : undefined);
    for (const column of order) query = query.order(column);
    const { data, error, count } = await query.range(offset, offset + PAGE - 1);
    if (error) throw error;
    if (offset === 0 && typeof count === "number") total = count;
    const page = (data ?? []) as Record<string, unknown>[];
    out.push(...page);
    if (page.length === 0) break;
    if (total !== null ? out.length >= total : page.length < PAGE) break;
  }
  if (total !== null && out.length < total) throw new Error("Channel report was cut short; please reload.");
  return out;
}

export interface ChannelEconomicsData {
  /** Stay-date x booking rows for the selected month. */
  rows: EconomicsRow[];
  /** Monthly totals for the trend window. */
  monthly: MonthlyEconomicsRow[];
  trendMonths: string[];
  loadedKey: string;
}

export function trendWindow(month: string): string[] {
  return Array.from({ length: 6 }, (_, i) => shiftMonth(month, i - 3));
}

/**
 * Channel economics for one hotel and stay month, plus a six-month trend
 * (three months back, the month, two ahead). Keeps the previous result on
 * screen while the next month loads.
 */
export function useChannelEconomics(hotelId: string | null, month: string, reloadToken = 0) {
  const [data, setData] = useState<ChannelEconomicsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = `${hotelId ?? ""}|${month}|${reloadToken}`;

  useEffect(() => {
    if (!hotelId || !/^\d{4}-\d{2}$/.test(month)) {
      setData(null);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    const { from, to } = monthBounds(month);
    const trendMonths = trendWindow(month);
    const trendFrom = monthBounds(trendMonths[0]).from;
    const trendTo = monthBounds(trendMonths[trendMonths.length - 1]).to;
    void (async () => {
      try {
        const [nightRows, monthlyRows] = await Promise.all([
          fetchAllRpcRows("revenue_channel_economics", { p_hotel_id: hotelId, p_from: from, p_to: to }, ["stay_date", "booking_ref"]),
          fetchAllRpcRows("revenue_channel_economics_monthly", { p_hotel_id: hotelId, p_from: trendFrom, p_to: trendTo },
            ["month", "channel_key", "commission_source", "amount_basis", "currency"]),
        ]);
        if (!active) return;
        setData({
          rows: nightRows.map(toEconomicsRow),
          monthly: monthlyRows.map(toMonthlyRow),
          trendMonths,
          loadedKey: key,
        });
      } catch (reason) {
        if (!active) return;
        const message = reason instanceof Error ? reason.message : String((reason as { message?: string })?.message ?? reason);
        setError(message || "Channel report unavailable");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [hotelId, month, key]);

  return { data, loading, error, stale: !!data && data.loadedKey !== key };
}
