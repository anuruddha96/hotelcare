import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isTransientBackendError } from "@/lib/transientRetry";

export interface PortfolioRateBenchmarkDay {
  date: string;
  propertiesReporting: number;
  medianRate: number | null;
  trimmedAverageRate: number | null;
}

export interface PortfolioRateBenchmark {
  available: boolean;
  marketCity: string;
  marketCountry: string;
  propertiesReporting: number;
  minimumProperties: number;
  source: string;
  generatedAt?: string;
  days: PortfolioRateBenchmarkDay[];
}

const EMPTY: PortfolioRateBenchmark = {
  available: false, marketCity: "Budapest", marketCountry: "Hungary",
  propertiesReporting: 0, minimumProperties: 3,
  source: "hotelcare_portfolio_booked_adr", days: [],
};

export function usePortfolioRateBenchmark(hotelId: string | null, horizonDays = 210) {
  return useQuery({
    queryKey: ["portfolio-rate-benchmark", hotelId, horizonDays],
    enabled: !!hotelId,
    queryFn: async (): Promise<PortfolioRateBenchmark> => {
      const { data, error } = await supabase.rpc("get_portfolio_rate_benchmark", {
        _hotel_id: hotelId!, _horizon_days: horizonDays,
      } as never);
      if (error) throw error;
      const raw = (data ?? EMPTY) as unknown as PortfolioRateBenchmark;
      return {
        ...EMPTY, ...raw,
        days: Array.isArray(raw.days) ? raw.days.map((d) => ({
          ...d,
          date: String(d.date).slice(0, 10),
          propertiesReporting: Number(d.propertiesReporting) || 0,
          medianRate: d.medianRate == null ? null : Number(d.medianRate),
          trimmedAverageRate: d.trimmedAverageRate == null ? null : Number(d.trimmedAverageRate),
        })) : [],
      };
    },
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: true,
    retry: (failureCount, error) => failureCount < 2 && isTransientBackendError(error),
  });
}
