import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Activity, CheckCircle2, Loader2, PauseCircle, RefreshCw, ShieldAlert } from "lucide-react";

type RuleRow = {
  hotel_id: string;
  mode: string | null;
  auto_publish: boolean;
  shadow_started_at: string | null;
  live_activated_at: string | null;
  auto_pause_reason: string | null;
  gate_results: Record<string, unknown> | null;
  last_evaluation_status: string | null;
  last_evaluation_error: string | null;
};

type RunRow = {
  id: string;
  hotel_id: string;
  mode: string;
  status: string;
  started_at: string;
  duration_ms: number | null;
  dates_evaluated: number;
  dates_increased: number;
  dates_decreased: number;
  dates_held: number;
  cells_queued: number;
  skip_reasons: Record<string, number> | null;
  failure_reason: string | null;
};

const GATE_LABELS: Record<string, string> = {
  pass_min_runs: "Enough observation runs",
  pass_no_failures: "Every run finished cleanly",
  pass_budget: "No day moved more than its daily limit",
  pass_bounds: "No price below the minimum or above the maximum",
  pass_markdown_share: "Markdowns stayed a small share of decisions",
};

const timeAgo = (iso: string | null) => {
  if (!iso) return "—";
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
};

/**
 * What the rebuilt pricing engine is doing right now: whether a property is
 * still watching quietly, which safety checks it has passed, and what the last
 * few runs decided. Read-only on purpose — activation is automatic and pausing
 * happens through the master brake above.
 */
export default function RevenueEngineV2Status() {
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: ruleRows }, { data: runRows }] = await Promise.all([
      supabase
        .from("revenue_pickup_automation_rules")
        .select("hotel_id, mode, auto_publish, shadow_started_at, live_activated_at, auto_pause_reason, gate_results, last_evaluation_status, last_evaluation_error")
        .gte("engine_version", 2)
        .order("hotel_id"),
      supabase
        .from("revenue_automation_runs")
        .select("id, hotel_id, mode, status, started_at, duration_ms, dates_evaluated, dates_increased, dates_decreased, dates_held, cells_queued, skip_reasons, failure_reason")
        .order("started_at", { ascending: false })
        .limit(12),
    ]);
    setRules((ruleRows ?? []) as RuleRow[]);
    setRuns((runRows ?? []) as RunRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 120_000);
    return () => window.clearInterval(timer);
  }, [load]);

  if (!loading && rules.length === 0) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-4 w-4" />
            New pricing engine
          </CardTitle>
          <CardDescription>
            Properties on the rebuilt engine watch quietly for 24 hours. Prices only go
            out once every safety check has passed.
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </Button>
      </CardHeader>

      <CardContent className="space-y-5">
        {rules.map((rule) => {
          const gate = (rule.gate_results ?? {}) as Record<string, unknown>;
          const live = rule.mode === "live" && rule.auto_publish;
          return (
            <div key={rule.hotel_id} className="rounded-lg border p-4 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium capitalize">{rule.hotel_id}</span>
                {rule.auto_pause_reason ? (
                  <Badge variant="destructive" className="gap-1">
                    <PauseCircle className="h-3 w-3" /> Paused
                  </Badge>
                ) : live ? (
                  <Badge className="gap-1">
                    <CheckCircle2 className="h-3 w-3" /> Live pricing
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="gap-1">
                    <ShieldAlert className="h-3 w-3" /> Watching only
                  </Badge>
                )}
                <span className="text-xs text-muted-foreground">
                  {live
                    ? `Live since ${timeAgo(rule.live_activated_at)}`
                    : `Watching since ${timeAgo(rule.shadow_started_at)}`}
                </span>
              </div>

              {rule.auto_pause_reason && (
                <p className="text-sm text-destructive">{rule.auto_pause_reason}</p>
              )}
              {rule.last_evaluation_error && (
                <p className="text-sm text-destructive">{rule.last_evaluation_error}</p>
              )}

              {Object.keys(gate).length > 0 && (
                <ul className="grid gap-1 sm:grid-cols-2">
                  {Object.entries(GATE_LABELS).map(([key, label]) => (
                    <li key={key} className="flex items-center gap-2 text-sm">
                      <span className={gate[key] ? "text-emerald-600" : "text-muted-foreground"}>
                        {gate[key] ? "✓" : "•"}
                      </span>
                      <span className={gate[key] ? "" : "text-muted-foreground"}>{label}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}

        <div className="space-y-2">
          <p className="text-sm font-medium">Recent runs</p>
          {runs.length === 0 && <p className="text-sm text-muted-foreground">No runs recorded yet.</p>}
          {runs.map((run) => (
            <div key={run.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3 py-2 text-sm">
              <span className="font-medium capitalize">{run.hotel_id}</span>
              <Badge variant={run.status === "completed" ? "secondary" : "destructive"}>{run.status.replace(/_/g, " ")}</Badge>
              <span className="text-muted-foreground">{timeAgo(run.started_at)}</span>
              <span>{run.dates_evaluated} dates</span>
              <span className="text-emerald-600">{run.dates_increased} up</span>
              <span className="text-amber-600">{run.dates_decreased} down</span>
              <span className="text-muted-foreground">{run.dates_held} left alone</span>
              {run.mode !== "live" && <span className="text-muted-foreground">(watching only)</span>}
              {run.duration_ms != null && <span className="text-muted-foreground">{Math.round(run.duration_ms / 100) / 10}s</span>}
              {run.failure_reason && <span className="text-destructive">{run.failure_reason}</span>}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
