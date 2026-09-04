import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { isTransientBackendError } from "@/lib/transientRetry";

export interface PortfolioSnapshot {
  hotel_id: string;
  stay_date: string;
  rooms_sold: number | null;
  occupancy_pct: number | null;
  adr_eur: number | null;
  revenue_eur: number | null;
  rooms_available: number | null;
}

const PAGE_SIZE = 500;

/** Read current portfolio figures, with recovery from transient API failures. */
export function usePortfolioSnapshots(hotelIds: string[], from: string, to: string) {
  const { user, profile } = useAuth();
  const ids = [...new Set(hotelIds)].sort();

  return useQuery({
    // Never reuse another user's or property's authorised comparison results.
    queryKey: ["revenue-portfolio-snapshots", user?.id, profile?.organization_slug,
      profile?.role, profile?.assigned_hotel, ids, from, to],
    enabled: !!user?.id && ids.length > 0 && from <= to,
    queryFn: async ({ signal }): Promise<PortfolioSnapshot[]> => {
      const snapshots: PortfolioSnapshot[] = [];
      // The API caps response sizes. Page so large portfolios retain every hotel.
      for (let offset = 0; ; offset += PAGE_SIZE) {
        const { data, error } = await supabase.rpc("revenue_portfolio_latest_snapshots", {
          _hotel_ids: ids, _from: from, _to: to,
        }).range(offset, offset + PAGE_SIZE - 1).abortSignal(signal);
        if (error) throw error;
        const page = data ?? [];
        snapshots.push(...page);
        if (page.length < PAGE_SIZE) return snapshots;
      }
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    retry: (failureCount, error) => failureCount < 2 && isTransientBackendError(error),
  });
}
