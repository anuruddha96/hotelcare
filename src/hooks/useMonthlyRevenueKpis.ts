import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface MonthlyRevenueKpi {
  month_key: string;
  days: number;
  rooms_sold: number;
  revenue_eur: number;
  sync_completed_at: string;
  complete: boolean;
}

interface MonthlyResult {
  hotelId: string;
  rows: MonthlyRevenueKpi[];
}

/** Six compact monthly totals, fetched independently of the 30-day price grid.
 *  Never reuse another hotel's numbers and never interpret a failed request as zero.
 */
export function useMonthlyRevenueKpis(hotelId: string | null | undefined, lastSyncAt: string | null) {
  const [result, setResult] = useState<MonthlyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const retry = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    if (!hotelId) {
      setResult(null);
      setError(null);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 4500);
    setError(null);
    setResult(null);

    (async () => {
      try {
        const { data, error: rpcError } = await (supabase as any)
          .rpc('get_revenue_monthly_kpis', { _hotel_id: hotelId })
          .abortSignal(controller.signal);
        if (rpcError) throw rpcError;
        if (!Array.isArray(data) || data.length !== 6) throw new Error('Monthly figures are not available');
        const rows: MonthlyRevenueKpi[] = data.map((value: any) => ({
          month_key: String(value.month_key ?? ''),
          days: Number(value.days),
          rooms_sold: Number(value.rooms_sold),
          revenue_eur: Number(value.revenue_eur),
          sync_completed_at: String(value.sync_completed_at ?? ''),
          complete: value.complete === true,
        }));
        if (rows.some((row) => !/^\d{4}-\d{2}$/.test(row.month_key) ||
          !Number.isInteger(row.days) || row.days <= 0 ||
          !Number.isInteger(row.rooms_sold) || row.rooms_sold < 0 ||
          !Number.isFinite(row.revenue_eur) || !row.sync_completed_at)) {
          throw new Error('Invalid monthly figures received');
        }
        if (!cancelled) setResult({ hotelId, rows });
      } catch (caught) {
        if (!cancelled) {
          setError(controller.signal.aborted ? 'Monthly figures timed out; retry' :
            caught instanceof Error ? caught.message : 'Could not load monthly figures');
        }
      } finally {
        window.clearTimeout(timeout);
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [hotelId, lastSyncAt, revision]);

  // Explicit property check stops one frame of cross-property numbers on hotel switches.
  return { rows: result?.hotelId === hotelId ? result.rows : [], error, retry };
}
