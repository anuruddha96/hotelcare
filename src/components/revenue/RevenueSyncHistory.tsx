import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, RefreshCw, History } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface Row {
  id: string;
  changed_at: string;
  sync_status: string;
  error_message: string | null;
  data: any;
}

interface Props {
  hotelId?: string;
  limit?: number;
}

export default function RevenueSyncHistory({ hotelId, limit = 10 }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    let q = supabase
      .from("pms_sync_history")
      .select("id, changed_at, sync_status, error_message, data")
      .eq("sync_type", "revenue_live")
      .order("changed_at", { ascending: false })
      .limit(limit);
    if (hotelId) q = q.eq("hotel_id", hotelId);
    const { data } = await q;
    setRows((data as Row[]) || []);
    setBusy(false);
  }

  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [hotelId]);

  return (
    <Card>
      <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base flex items-center gap-2">
          <History className="h-4 w-4" /> Revenue Sync History
        </CardTitle>
        <Button variant="ghost" size="sm" onClick={() => void load()} disabled={busy}>
          <RefreshCw className={`h-3 w-3 ${busy ? "animate-spin" : ""}`} />
        </Button>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <div className="text-xs text-muted-foreground py-4 text-center">No revenue syncs recorded yet.</div>
        ) : (
          <div className="space-y-1.5 text-xs">
            <div className="grid grid-cols-12 gap-2 text-[10px] uppercase tracking-wide text-muted-foreground pb-1 border-b">
              <div className="col-span-3">When</div>
              <div className="col-span-2">Status</div>
              <div className="col-span-1 text-right">Days</div>
              <div className="col-span-2 text-right">Occupancy</div>
              <div className="col-span-2 text-right">Pickup</div>
              <div className="col-span-2 text-right">Breakfast</div>
            </div>
            {rows.map((r) => {
              const ok = r.sync_status === "success";
              const d = r.data || {};
              return (
                <div key={r.id} className="grid grid-cols-12 gap-2 items-center py-1 border-b border-dashed last:border-b-0">
                  <div className="col-span-3 text-muted-foreground" title={new Date(r.changed_at).toLocaleString()}>
                    {formatDistanceToNow(new Date(r.changed_at), { addSuffix: true })}
                  </div>
                  <div className="col-span-2">
                    <Badge variant={ok ? "default" : "destructive"} className="gap-1">
                      {ok ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                      {ok ? "Success" : "Failed"}
                    </Badge>
                  </div>
                  <div className="col-span-1 text-right tabular-nums">{d.days ?? "—"}</div>
                  <div className="col-span-2 text-right tabular-nums">{d.occInserted ?? 0}</div>
                  <div className="col-span-2 text-right tabular-nums">{d.pickupInserted ?? 0}</div>
                  <div className="col-span-2 text-right tabular-nums">{d.breakfastUpserted ?? 0}</div>
                  {r.error_message && (
                    <div className="col-span-12 text-[11px] text-destructive truncate" title={r.error_message}>
                      {r.error_message}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
