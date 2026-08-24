import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, Lock, Unlock, CheckCircle2, XCircle, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import RevenueSyncHistory from "@/components/revenue/RevenueSyncHistory";

interface SyncStateRow {
  hotel_id: string;
  organization_slug: string | null;
  last_success_at: string | null;
  last_success_by_name: string | null;
  lease_started_at: string | null;
  lease_expires_at: string | null;
  last_error: string | null;
  updated_at: string | null;
}

const STALE_MS = 30 * 60 * 1000;

function isLeaseActive(row: SyncStateRow) {
  return !!row.lease_expires_at && new Date(row.lease_expires_at).getTime() > Date.now();
}

function rel(ts: string | null) {
  if (!ts) return "never";
  return formatDistanceToNow(new Date(ts), { addSuffix: true });
}

export default function RevenueSyncMonitor() {
  const [rows, setRows] = useState<SyncStateRow[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    const [{ data: state }, { data: hotels }] = await Promise.all([
      supabase
        .from("revenue_sync_state")
        .select(
          "hotel_id, organization_slug, last_success_at, last_success_by_name, lease_started_at, lease_expires_at, last_error, updated_at",
        )
        .order("last_success_at", { ascending: true, nullsFirst: true }),
      supabase.from("hotels").select("id, name"),
    ]);
    setRows(((state as SyncStateRow[]) || []));
    const map: Record<string, string> = {};
    for (const h of (hotels as any[]) || []) map[h.id] = h.name;
    setNames(map);
    setBusy(false);
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  }, [load]);

  const running = rows.filter(isLeaseActive);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base flex items-center gap-2">
            {running.length > 0 ? <Lock className="h-4 w-4 text-amber-600" /> : <Unlock className="h-4 w-4 text-emerald-600" />}
            Scheduler lock
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={() => void load()} disabled={busy}>
            <RefreshCw className={`h-3 w-3 ${busy ? "animate-spin" : ""}`} />
          </Button>
        </CardHeader>
        <CardContent className="text-sm">
          {running.length === 0 ? (
            <p className="text-muted-foreground">Idle — no property is syncing right now.</p>
          ) : (
            <div className="space-y-2">
              {running.length > 1 && (
                <p className="text-xs text-destructive">
                  {running.length} concurrent leases detected — only one is expected at a time.
                </p>
              )}
              {running.map((r) => (
                <div key={r.hotel_id} className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="border-amber-400 text-amber-700 gap-1">
                    <Clock className="h-3 w-3" /> Syncing
                  </Badge>
                  <span className="font-medium">{names[r.hotel_id] ?? r.hotel_id}</span>
                  <span className="text-muted-foreground text-xs">
                    started {rel(r.lease_started_at)} · lease expires {rel(r.lease_expires_at)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Sync state per venue</CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <div className="text-xs text-muted-foreground py-4 text-center">No revenue sync state recorded yet.</div>
          ) : (
            <div className="space-y-1.5 text-xs">
              <div className="grid grid-cols-12 gap-2 text-[10px] uppercase tracking-wide text-muted-foreground pb-1 border-b">
                <div className="col-span-4">Venue</div>
                <div className="col-span-2">Organization</div>
                <div className="col-span-3">Last success</div>
                <div className="col-span-3">Status</div>
              </div>
              {rows.map((r) => {
                const stale =
                  !r.last_success_at || Date.now() - new Date(r.last_success_at).getTime() > STALE_MS;
                const active = isLeaseActive(r);
                return (
                  <div key={r.hotel_id}>
                    <button
                      type="button"
                      onClick={() => setSelected(selected === r.hotel_id ? null : r.hotel_id)}
                      className="w-full text-left grid grid-cols-12 gap-2 items-center py-1.5 border-b border-dashed hover:bg-muted/50 rounded-sm"
                    >
                      <div className="col-span-4 font-medium truncate">{names[r.hotel_id] ?? r.hotel_id}</div>
                      <div className="col-span-2 text-muted-foreground truncate">{r.organization_slug ?? "—"}</div>
                      <div
                        className="col-span-3 text-muted-foreground"
                        title={r.last_success_at ? new Date(r.last_success_at).toLocaleString() : undefined}
                      >
                        {rel(r.last_success_at)}
                        {r.last_success_by_name ? ` · ${r.last_success_by_name}` : ""}
                      </div>
                      <div className="col-span-3">
                        {active ? (
                          <Badge variant="outline" className="gap-1 border-amber-400 text-amber-700">
                            <Clock className="h-3 w-3" /> Syncing
                          </Badge>
                        ) : r.last_error ? (
                          <Badge variant="destructive" className="gap-1">
                            <XCircle className="h-3 w-3" /> Error
                          </Badge>
                        ) : stale ? (
                          <Badge variant="secondary" className="gap-1">
                            <Clock className="h-3 w-3" /> Stale
                          </Badge>
                        ) : (
                          <Badge variant="default" className="gap-1">
                            <CheckCircle2 className="h-3 w-3" /> Fresh
                          </Badge>
                        )}
                      </div>
                      {r.last_error && (
                        <div className="col-span-12 text-[11px] text-destructive truncate" title={r.last_error}>
                          {r.last_error}
                        </div>
                      )}
                    </button>
                    {selected === r.hotel_id && (
                      <div className="py-3">
                        <RevenueSyncHistory hotelId={r.hotel_id} limit={10} />
                      </div>
                    )}
                  </div>
                );
              })}
              <p className="pt-2 text-[11px] text-muted-foreground">
                Select a venue to see its recent sync runs. Refreshes automatically every 30 seconds.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
