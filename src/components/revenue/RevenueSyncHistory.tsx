import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, RefreshCw, History, AlertTriangle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface Row {
  id: string;
  changed_at: string;
  sync_status: string;
  sync_type: string;
  error_message: string | null;
  data: any;
  hotel_id: string | null;
}

interface Props {
  hotelId?: string;
  limit?: number;
  /** When true, also include `daily_overview_live` syncs (default true). */
  includeDailyOverview?: boolean;
}

const TYPE_LABEL: Record<string, string> = {
  revenue_live: "Revenue (pickup+occ)",
  daily_overview_live: "Daily overview",
};

function statusBadge(status: string) {
  if (status === "success") {
    return <Badge variant="default" className="gap-1"><CheckCircle2 className="h-3 w-3"/>Success</Badge>;
  }
  if (status === "partial") {
    return <Badge variant="outline" className="gap-1 border-amber-400 text-amber-700"><AlertTriangle className="h-3 w-3"/>Partial</Badge>;
  }
  return <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3"/>Failed</Badge>;
}

function summary(r: Row): string {
  const d = r.data || {};
  if (r.sync_type === "daily_overview_live") {
    const w = d.window || {};
    return `${d.rowsInserted ?? 0} rows · ${d.reservations ?? 0} reservations · ${w.from ?? "?"}→${w.to ?? "?"}`;
  }
  // revenue_live
  const parts = [
    `${d.occInserted ?? 0} occ`,
    `${d.pickupInserted ?? 0} pickup`,
    d.dailyRatesPms != null ? `${d.dailyRatesPms} PMS rates` : null,
    d.dailyRatesRealized != null ? `${d.dailyRatesRealized} ADR` : null,
    d.breakfastUpserted != null ? `${d.breakfastUpserted} breakfast` : null,
  ].filter(Boolean);
  return parts.join(" · ");
}

export default function RevenueSyncHistory({ hotelId, limit = 12, includeDailyOverview = true }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    const types = includeDailyOverview
      ? ["revenue_live", "daily_overview_live"]
      : ["revenue_live"];
    let q = supabase
      .from("pms_sync_history")
      .select("id, changed_at, sync_status, sync_type, error_message, data, hotel_id")
      .in("sync_type", types)
      .order("changed_at", { ascending: false })
      .limit(limit);
    if (hotelId) q = q.eq("hotel_id", hotelId);
    const { data } = await q;
    setRows((data as Row[]) || []);
    setBusy(false);
  }

  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [hotelId, includeDailyOverview, limit]);

  return (
    <Card>
      <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base flex items-center gap-2">
          <History className="h-4 w-4" /> Sync History{hotelId ? "" : " (all hotels)"}
        </CardTitle>
        <Button variant="ghost" size="sm" onClick={() => void load()} disabled={busy}>
          <RefreshCw className={`h-3 w-3 ${busy ? "animate-spin" : ""}`} />
        </Button>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <div className="text-xs text-muted-foreground py-4 text-center">No syncs recorded yet.</div>
        ) : (
          <div className="space-y-1.5 text-xs">
            <div className="grid grid-cols-12 gap-2 text-[10px] uppercase tracking-wide text-muted-foreground pb-1 border-b">
              <div className="col-span-3">When</div>
              <div className="col-span-3">Job</div>
              <div className="col-span-2">Status</div>
              <div className="col-span-4">Summary</div>
            </div>
            {rows.map((r) => (
              <div key={r.id} className="grid grid-cols-12 gap-2 items-start py-1 border-b border-dashed last:border-b-0">
                <div className="col-span-3 text-muted-foreground" title={new Date(r.changed_at).toLocaleString()}>
                  {formatDistanceToNow(new Date(r.changed_at), { addSuffix: true })}
                </div>
                <div className="col-span-3 font-medium">{TYPE_LABEL[r.sync_type] ?? r.sync_type}</div>
                <div className="col-span-2">{statusBadge(r.sync_status)}</div>
                <div className="col-span-4 text-muted-foreground truncate" title={summary(r)}>
                  {summary(r)}
                </div>
                {r.error_message && (
                  <div className="col-span-12 text-[11px] text-destructive truncate" title={r.error_message}>
                    {r.error_message}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
