import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Gauge, HelpCircle, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { eur } from "@/lib/revenueAnalytics";

interface Outcome {
  measured_at: string;
  days_observed: number;
  settled: boolean;
  rooms_before: number;
  rooms_after: number;
  adr_before_eur: number | null;
  adr_after_eur: number | null;
  adr_delta_eur: number | null;
  revenue_delta_eur: number;
  expected_revenue_eur: number | null;
  accuracy_pct: number | null;
  verdict: string;
}
interface Row {
  id: string;
  headline: string;
  category: string;
  arrival_date: string | null;
  status: string;
  acted_at: string | null;
  outcome: Outcome | null;
}

const VERDICT: Record<string, { label: string; tone: string }> = {
  positive: { label: "Worked", tone: "text-emerald-600 dark:text-emerald-400" },
  mixed: { label: "Mixed", tone: "text-amber-600 dark:text-amber-400" },
  negative: { label: "Did not work", tone: "text-red-600 dark:text-red-400" },
  no_effect: { label: "No effect", tone: "text-muted-foreground" },
  pending: { label: "No pickup yet", tone: "text-muted-foreground" },
  too_early: { label: "Too early", tone: "text-muted-foreground" },
};

function fmtDay(d: string | null) {
  if (!d) return "—";
  return new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, {
    timeZone: "UTC", day: "numeric", month: "short",
  });
}

/** Phase 4 — did the recommendations we applied actually move revenue? */
export default function RecommendationOutcomesPanel({ hotelId }: { hotelId: string | null }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [measuring, setMeasuring] = useState(false);

  const load = useCallback(async () => {
    if (!hotelId) { setLoading(false); return; }
    setLoading(true);
    const { data } = await supabase.from("rm_recommendations")
      .select("id, headline, category, arrival_date, status, acted_at, outcome")
      .eq("hotel_id", hotelId)
      .not("acted_at", "is", null)
      .order("acted_at", { ascending: false }).limit(40);
    setRows((data ?? []) as unknown as Row[]);
    setLoading(false);
  }, [hotelId]);

  useEffect(() => { void load(); }, [load]);

  const measure = async () => {
    if (!hotelId) return;
    setMeasuring(true);
    try {
      const { data, error } = await supabase.functions.invoke("rm-measure-outcomes", {
        body: { hotel_id: hotelId },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      const measured = (data as { measured: number }).measured ?? 0;
      toast.success(measured ? `Measured ${measured} applied recommendation(s)` : "No applied recommendations to measure yet");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not measure outcomes");
    } finally {
      setMeasuring(false);
    }
  };

  const summary = useMemo(() => {
    const measured = rows.filter((r) => r.outcome && r.outcome.verdict !== "too_early");
    const wins = measured.filter((r) => r.outcome!.verdict === "positive").length;
    const delta = measured.reduce((s, r) => s + Number(r.outcome!.revenue_delta_eur || 0), 0);
    const applied = rows.filter((r) => r.status === "applied" || r.status === "partially_applied").length;
    const accs = measured.map((r) => r.outcome!.accuracy_pct).filter((x): x is number => x != null);
    return {
      applied,
      measured: measured.length,
      hitRate: measured.length ? Math.round((wins / measured.length) * 100) : null,
      delta,
      accuracy: accs.length ? Math.round(accs.reduce((s, x) => s + x, 0) / accs.length) : null,
    };
  }, [rows]);

  // Nothing has been marked as applied yet, so there is nothing to grade.
  // An empty "Did it work?" card only adds noise to the page.
  if (!loading && rows.length === 0) return null;

  return (
    <TooltipProvider>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Gauge className="h-4 w-4 text-primary" />
                Did it work?
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button type="button" aria-label="How outcomes are measured">
                      <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs text-xs">
                    For each recommendation you marked as applied, we compare the room nights and ADR
                    booked for that stay date before you applied it with everything booked since.
                    It shows correlation, not proof of causation.
                  </TooltipContent>
                </Tooltip>
              </CardTitle>
              <p className="text-[11px] text-muted-foreground">
                Outcome tracking of applied AI recommendations
              </p>
            </div>
            <Button size="sm" variant="outline" className="h-9" onClick={measure} disabled={measuring || !hotelId}>
              {measuring ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              <span className="ml-2">Measure now</span>
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Kpi label="Applied" value={String(summary.applied)} />
            <Kpi label="Measured" value={String(summary.measured)} />
            <Kpi label="Hit rate" value={summary.hitRate === null ? "—" : `${summary.hitRate}%`} />
            <Kpi label="Revenue since action"
              value={eur(Math.round(summary.delta))}
              tone={summary.delta > 0 ? "text-emerald-600 dark:text-emerald-400" : undefined} />
          </div>
          {summary.accuracy !== null && (
            <p className="text-[11px] text-muted-foreground">
              Forecast accuracy of the AI revenue estimates: {summary.accuracy}% on measured items.
            </p>
          )}

          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading outcomes…
            </div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing to measure yet. Mark a recommendation as applied and the result will be tracked here.
            </p>
          ) : (
            <ul className="divide-y rounded-md border">
              {rows.map((r) => {
                const o = r.outcome;
                const v = VERDICT[o?.verdict ?? "too_early"] ?? VERDICT.too_early;
                return (
                  <li key={r.id} className="p-2 space-y-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium">{r.headline}</p>
                      <Badge variant="outline" className={`text-[10px] font-normal ${v.tone}`}>{v.label}</Badge>
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                      <span className="capitalize">{r.category?.replace(/_/g, " ")}</span>
                      <span>Stay {fmtDay(r.arrival_date)}</span>
                      <span className="capitalize">{r.status.replace(/_/g, " ")}</span>
                      {o && <span>{o.rooms_after} room night(s) since action</span>}
                      {o && o.adr_delta_eur != null && (
                        <span>ADR {o.adr_delta_eur >= 0 ? "+" : ""}{eur(Math.round(o.adr_delta_eur))}</span>
                      )}
                      {o && (
                        <span className={o.revenue_delta_eur > 0 ? "text-emerald-600 dark:text-emerald-400" : ""}>
                          {eur(Math.round(o.revenue_delta_eur))} booked
                        </span>
                      )}
                      {o?.expected_revenue_eur != null && (
                        <span>vs {eur(Math.round(o.expected_revenue_eur))} expected</span>
                      )}
                    </div>
                    {!o && (
                      <p className="text-[11px] text-muted-foreground">
                        Not measured yet — press “Measure now”.
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </TooltipProvider>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-md border p-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-sm font-semibold ${tone ?? ""}`}>{value}</div>
    </div>
  );
}
