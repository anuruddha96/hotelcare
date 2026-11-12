import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ReconciliationDay } from "@/lib/kpiReconciliation";

export const monthReconciliationKey = (hotelId: string | null | undefined, month: string) =>
  ["kpi-reconciliation-days", hotelId ?? null, month] as const;

/**
 * Every night of one hotel-month from public.revenue_kpi_reconciliation_days():
 * nights already stayed and nights on the books, with booking value and the
 * breakfasts on the housekeeping lists. One access check on the server.
 *
 * Shared by the month header and the occupancy cross-check, so the page makes
 * one request per hotel-month.
 */
export async function fetchMonthReconciliationDays(hotelId: string, month: string): Promise<ReconciliationDay[]> {
  if (!/^\d{4}-\d{2}$/.test(month)) return [];
  const { data, error } = await (supabase as unknown as {
    rpc: (fn: string, args: Record<string, string>) => Promise<{ data: ReconciliationDay[] | null; error: unknown }>;
  }).rpc("revenue_kpi_reconciliation_days", {
    p_hotel_id: hotelId, p_from: `${month}-01`, p_to: `${month}-01`,
  });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export function useMonthReconciliationDays(hotelId: string | null | undefined, month: string) {
  return useQuery({
    queryKey: monthReconciliationKey(hotelId, month),
    enabled: Boolean(hotelId) && /^\d{4}-\d{2}$/.test(month),
    staleTime: 60_000,
    retry: false,
    queryFn: () => fetchMonthReconciliationDays(hotelId as string, month),
  });
}
