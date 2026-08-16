import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AlertTriangle, BrainCircuit, CheckCircle2, ChevronDown, Clock, HelpCircle,
  Info, Loader2, Sparkles, TrendingUp, XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { eur } from "@/lib/revenueAnalytics";
import DemandRateOutlookChart, { type OutlookDay } from "./DemandRateOutlookChart";
import MarketSignalsPanel from "./MarketSignalsPanel";
import EventsPanel from "./EventsPanel";
import RecommendationOutcomesPanel from "./RecommendationOutcomesPanel";


/* ---------------------------------------------------------------- types */
interface Evidence { metric: string; value: string; comparison: string }
interface Impact {
  adr_change: number | null; revenue_change: number | null;
  occupancy_change: number | null; currency: string; method: string;
}
export interface AiRecommendation {
  id: string; priority: number; category: string;
  arrival_date: string | null; room_type: string | null;
  headline: string; action: string; reason: string;
  evidence: Evidence[]; expected_impact: Impact;
  confidence: number; urgency: string; risk: string; recommended_cta: string;
}
interface DemandAlert {
  arrival_date: string; demand_score: number; confidence: number; classification: string;
  drivers: string[]; recommended_adr_min: number | null; recommended_adr_max: number | null;
}
interface Leak {
  dimension: string; name: string; adr: number | null; target_adr: number | null;
  room_nights: number; revenue_impact: number | null; explanation: string; recommended_action: string;
}
interface AiOutput {
  executive_summary: { headline: string; summary: string; overall_status: string };
  priority_recommendations: AiRecommendation[];
  demand_alerts: DemandAlert[];
  adr_leakage: Leak[];
  monitoring_items: { signal: string; current_value: string; trigger: string; next_review: string }[];
  data_quality: { confidence: number; missing_sources: string[]; warnings: string[] };
}
type DayForecast = OutlookDay;
interface Metrics {
  forecasts: DayForecast[];
  forecast_horizon?: {
    room_nights: number; occupancy_pct: number; room_revenue_eur: number; sellout_dates: string[];
  };
  kpi_horizon: Record<string, number | null>;
  data_quality: Record<string, string | number>;
  market_signals?: { events?: { title: string; start: string; end: string; impact: string | null; source: string }[] };
}


type Status = "new" | "applied" | "partially_applied" | "not_useful" | "incorrect" | "already_planned" | "dismissed" | "snoozed";

const URGENCY_LABEL: Record<string, string> = {
  now: "Act now", today: "Today", within_3_days: "Within 3 days", monitor: "Monitor",
};

function fmtDay(d: string | null) {
  if (!d) return null;
  return new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, {
    timeZone: "UTC", weekday: "short", day: "numeric", month: "short",
  });
}
function ago(iso: string | null) {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const h = Math.round(mins / 60);
  if (h < 48) return `${h} hour${h === 1 ? "" : "s"} ago`;
  return `${Math.round(h / 24)} days ago`;
}
function confidenceLabel(c: number) {
  return c >= 75 ? "High confidence" : c >= 50 ? "Medium confidence" : "Low confidence";
}

/* ------------------------------------------------------------ component */
interface Props { hotelId: string | null }

export default function RevenueIntelligencePanel({ hotelId }: Props) {
  const [loading, setLoading] = useState(false);
  const [initialising, setInitialising] = useState(true);
  const [output, setOutput] = useState<AiOutput | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<Record<string, Status>>({});
  const [rowIds, setRowIds] = useState<Record<string, string>>({});
  const [leakFilter, setLeakFilter] = useState<string>("all");

  /* last stored run, so the section is never empty on load */
  const loadLatest = useCallback(async () => {
    if (!hotelId) { setInitialising(false); return; }
    setInitialising(true);
    const { data } = await supabase.from("rm_analysis_runs")
      .select("id, output, metrics, model, created_at")
      .eq("hotel_id", hotelId).eq("status", "ok")
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (data?.output) {
      setOutput(data.output as unknown as AiOutput);
      setMetrics(data.metrics as unknown as Metrics);
      setGeneratedAt(data.created_at);
      setModel(data.model);
      setRunId(data.id);
    }
    setInitialising(false);
  }, [hotelId]);

  useEffect(() => { void loadLatest(); }, [loadLatest]);

  /* stored per-recommendation status */
  useEffect(() => {
    if (!runId) return;
    void (async () => {
      const { data } = await supabase.from("rm_recommendations")
        .select("id, headline, arrival_date, status").eq("run_id", runId);
      const s: Record<string, Status> = {}; const ids: Record<string, string> = {};
      for (const r of data ?? []) {
        const key = `${r.headline}|${r.arrival_date ?? ""}`;
        s[key] = (r.status as Status) ?? "new";
        ids[key] = r.id;
      }
      setStatuses(s); setRowIds(ids);
    })();
  }, [runId]);

  const run = useCallback(async (mode: "standard" | "deep", force = false) => {
    if (!hotelId) return;
    setLoading(true); setAiError(null);
    try {
      const { data, error } = await supabase.functions.invoke("generate-rm-intelligence", {
        body: { hotel_id: hotelId, mode, force },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      const res = data as { output: AiOutput; metrics: Metrics; generated_at: string; model: string; run_id: string; cached?: boolean; throttled?: boolean };
      setOutput(res.output); setMetrics(res.metrics);
      setGeneratedAt(res.generated_at); setModel(res.model); setRunId(res.run_id);
      toast.success(res.throttled ? "Showing the most recent analysis" : mode === "deep" ? "Deep analysis ready" : "Analysis updated");
    } catch (e) {
      setAiError(e instanceof Error ? e.message : String(e));
      toast.error("AI analysis is temporarily unavailable");
    } finally {
      setLoading(false);
    }
  }, [hotelId]);

  const setFeedback = async (rec: AiRecommendation, status: Status) => {
    const key = `${rec.headline}|${rec.arrival_date ?? ""}`;
    setStatuses((s) => ({ ...s, [key]: status }));
    const id = rowIds[key];
    if (!id) return;
    const { data: session } = await supabase.auth.getUser();
    await supabase.from("rm_recommendations").update({
      status, feedback: status, acted_at: new Date().toISOString(), acted_by: session.user?.id ?? null,
    }).eq("id", id);
  };

  const forecastByDate = useMemo(() => {
    const m = new Map<string, DayForecast>();
    for (const f of metrics?.forecasts ?? []) m.set(f.stay_date, f);
    return m;
  }, [metrics]);

  const eventCount = metrics?.market_signals?.events?.length ?? 0;

  const leaks = useMemo(() => {
    const rows = output?.adr_leakage ?? [];
    const filtered = leakFilter === "all" ? rows : rows.filter((r) => r.dimension === leakFilter);
    return [...filtered].sort((a, b) => Math.abs(b.revenue_impact ?? 0) - Math.abs(a.revenue_impact ?? 0));
  }, [output, leakFilter]);

  const statusTone = output?.executive_summary.overall_status === "risk"
    ? "text-red-600 dark:text-red-400"
    : output?.executive_summary.overall_status === "opportunity"
      ? "text-emerald-600 dark:text-emerald-400"
      : output?.executive_summary.overall_status === "watch"
        ? "text-amber-600 dark:text-amber-400"
        : "text-muted-foreground";

  return (
    <TooltipProvider>
      <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="space-y-1">
              <CardTitle className="text-base flex items-center gap-2">
                <BrainCircuit className="h-4 w-4 text-primary" />
                Revenue Intelligence
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button type="button" aria-label="About these recommendations">
                      <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs text-xs">
                    Recommendations are generated from your booking, pickup, inventory, historical and
                    available market data. Verify pricing decisions before applying them.
                  </TooltipContent>
                </Tooltip>
              </CardTitle>
              <p className="text-[11px] text-muted-foreground">
                AI analysis using OpenAI · Updated {ago(generatedAt)}{model ? ` · ${model}` : ""}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" className="h-9" disabled={loading || !hotelId} onClick={() => run("deep", true)}>
                {loading
                  ? <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  : <Sparkles className="h-4 w-4 mr-2" />}
                Analyse with AI
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {aiError && (
            <div className="rounded-md border border-amber-300/70 bg-amber-50/60 dark:border-amber-700/60 dark:bg-amber-950/20 p-3 text-sm">
              AI analysis is temporarily unavailable. Metrics and forecasts remain current.
              <span className="block text-[11px] text-muted-foreground mt-1">{aiError}</span>
            </div>
          )}

          {initialising ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading the latest analysis…
            </div>
          ) : !output ? (
            <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              No analysis has been generated for this property yet. Run a standard analysis to get
              prioritised, evidence-backed recommendations for the next 90 arrival dates.
            </div>
          ) : (
            <>
              {/* -------------------------------------- executive summary */}
              <div className="rounded-lg border bg-muted/30 p-3 space-y-1">
                <div className="flex items-center gap-2">
                  <TrendingUp className={`h-4 w-4 ${statusTone}`} />
                  <p className="text-sm font-semibold">{output.executive_summary.headline}</p>
                </div>
                <p className="text-sm text-muted-foreground">{output.executive_summary.summary}</p>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  <Badge variant="outline" className="text-[10px] font-normal capitalize">
                    {output.executive_summary.overall_status}
                  </Badge>
                  <Badge variant="secondary" className="text-[10px] font-normal">
                    Data confidence {output.data_quality?.confidence ?? 0}%
                  </Badge>
                  {(output.data_quality?.missing_sources ?? []).map((s) => (
                    <Badge key={s} variant="outline" className="text-[10px] font-normal text-muted-foreground">{s}</Badge>
                  ))}
                </div>
              </div>

              {/* ------------------------------------- recommendation cards */}
              <div className="space-y-2">
                <h3 className="text-sm font-medium">Prioritised recommendations</h3>
                {output.priority_recommendations.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No action is warranted right now — keep monitoring.</p>
                ) : (
                  [...output.priority_recommendations]
                    .sort((a, b) => a.priority - b.priority)
                    .map((rec) => {
                      const key = `${rec.headline}|${rec.arrival_date ?? ""}`;
                      const state = statuses[key] ?? "new";
                      const fc = rec.arrival_date ? forecastByDate.get(rec.arrival_date) : undefined;
                      const dismissed = state === "dismissed" || state === "not_useful" || state === "incorrect";
                      return (
                        <div key={rec.id + key}
                          className={`rounded-lg border p-3 space-y-2 ${dismissed ? "opacity-55" : ""}`}>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge className="text-[10px]">Priority {rec.priority}</Badge>
                            <Badge variant="outline" className="text-[10px] font-normal capitalize">{rec.category}</Badge>
                            <Badge variant={rec.urgency === "now" ? "destructive" : "secondary"} className="text-[10px] font-normal">
                              <Clock className="h-3 w-3 mr-1" />{URGENCY_LABEL[rec.urgency] ?? rec.urgency}
                            </Badge>
                            {rec.arrival_date && (
                              <Badge variant="outline" className="text-[10px] font-normal">{fmtDay(rec.arrival_date)}</Badge>
                            )}
                            {rec.room_type && (
                              <Badge variant="secondary" className="text-[10px] font-normal">{rec.room_type}</Badge>
                            )}
                            {state !== "new" && (
                              <Badge variant="outline" className="text-[10px] font-normal capitalize">
                                {state.replace(/_/g, " ")}
                              </Badge>
                            )}
                          </div>

                          <p className="text-sm font-semibold">{rec.headline}</p>
                          <p className="text-sm">{rec.action}</p>
                          <p className="text-xs text-muted-foreground">{rec.reason}</p>

                          {rec.evidence?.length > 0 && (
                            <ul className="space-y-1">
                              {rec.evidence.slice(0, 3).map((e, i) => (
                                <li key={i} className="text-xs flex gap-2">
                                  <span className="text-muted-foreground shrink-0">{e.metric}:</span>
                                  <span className="font-medium">{e.value}</span>
                                  <span className="text-muted-foreground">{e.comparison}</span>
                                </li>
                              ))}
                            </ul>
                          )}

                          {fc && (
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 rounded-md bg-muted/40 p-2 text-[11px]">
                              <Fact label="Current ADR" value={fc.adr_eur === null ? "—" : eur(Math.round(fc.adr_eur))} />
                              <Fact label="Recommended ADR"
                                value={fc.recommended_adr_min === null ? "—"
                                  : `${eur(Math.round(fc.recommended_adr_min))}–${eur(Math.round(fc.recommended_adr_max ?? fc.recommended_adr_min))}`} />
                              <Fact label="Occupancy" value={`${Math.round(fc.occupancy_pct)}% → ${Math.round(fc.forecast_occupancy_pct)}% forecast`} />
                              <Fact label="Pickup / pace"
                                value={`${fc.pickup_7d} in 7d${fc.pace_variance_pct === null ? "" : ` · ${fc.pace_variance_pct > 0 ? "+" : ""}${Math.round(fc.pace_variance_pct)}%`}`} />
                            </div>
                          )}

                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                            {rec.expected_impact?.revenue_change != null && (
                              <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                                Estimated effect {eur(Math.round(rec.expected_impact.revenue_change))} room revenue
                              </span>
                            )}
                            <span>{confidenceLabel(rec.confidence)} · {rec.confidence}%</span>
                            <span>{eventCount ? `${eventCount} event signal(s) in horizon` : "No event signals recorded"}</span>
                          </div>

                          <Collapsible>
                            <CollapsibleTrigger asChild>
                              <Button variant="ghost" size="sm" className="h-8 px-2 text-xs">
                                <Info className="h-3.5 w-3.5 mr-1" /> Why am I seeing this?
                                <ChevronDown className="h-3.5 w-3.5 ml-1" />
                              </Button>
                            </CollapsibleTrigger>
                            <CollapsibleContent className="pt-1 space-y-1 text-[11px] text-muted-foreground">
                              <p>Based on: internal booking data, pickup and pace history from your own reservations.</p>
                              <p>Market rates unavailable · {eventCount ? `${eventCount} manually recorded event signal(s) considered.` : "No event signals recorded for this property."}</p>
                              {rec.risk && <p>Risk: {rec.risk}</p>}
                              {rec.expected_impact?.method && <p>Impact method: {rec.expected_impact.method}</p>}
                              <p>Data through {generatedAt ? new Date(generatedAt).toLocaleString() : "—"}.</p>
                            </CollapsibleContent>
                          </Collapsible>

                          <div className="flex flex-wrap gap-1.5 pt-1">
                            <Button size="sm" variant="outline" className="h-8 text-xs"
                              onClick={() => setFeedback(rec, "applied")}>
                              <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Mark as applied
                            </Button>
                            <Button size="sm" variant="ghost" className="h-8 text-xs"
                              onClick={() => setFeedback(rec, "partially_applied")}>Partially applied</Button>
                            <Button size="sm" variant="ghost" className="h-8 text-xs"
                              onClick={() => setFeedback(rec, "already_planned")}>Already planned</Button>
                            <Button size="sm" variant="ghost" className="h-8 text-xs"
                              onClick={() => setFeedback(rec, "not_useful")}>
                              <XCircle className="h-3.5 w-3.5 mr-1" /> Not useful
                            </Button>
                            <Button size="sm" variant="ghost" className="h-8 text-xs"
                              onClick={() => setFeedback(rec, "dismissed")}>Dismiss</Button>
                          </div>
                        </div>
                      );
                    })
                )}
              </div>

              {/* -------------------------------------------- demand alerts */}
              {output.demand_alerts?.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-medium">Demand alerts</h3>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {output.demand_alerts.map((d) => (
                      <div key={d.arrival_date} className="rounded-md border p-2 space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-medium">{fmtDay(d.arrival_date)}</span>
                          <Badge variant={d.classification.includes("high") ? "default" : "secondary"} className="text-[10px] font-normal">
                            Demand {d.demand_score} · {d.classification.replace("_", " ")}
                          </Badge>
                        </div>
                        <ul className="text-[11px] text-muted-foreground list-disc pl-4">
                          {d.drivers.slice(0, 3).map((x, i) => <li key={i}>{x}</li>)}
                        </ul>
                        {d.recommended_adr_min != null && (
                          <p className="text-[11px]">
                            Recommended ADR {eur(Math.round(d.recommended_adr_min))}–{eur(Math.round(d.recommended_adr_max ?? d.recommended_adr_min))}
                            {" "}· confidence {d.confidence}%
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ------------------------------- demand and rate outlook */}
              {(metrics?.forecasts?.length ?? 0) > 0 && (
                <>
                  <DemandRateOutlookChart forecasts={metrics!.forecasts} />
                  {metrics?.forecast_horizon && (
                    <p className="text-[11px] text-muted-foreground">
                      Full {metrics.forecasts.length}-day horizon forecast:{" "}
                      {Math.round(metrics.forecast_horizon.occupancy_pct)}% occupancy,{" "}
                      {Math.round(metrics.forecast_horizon.room_nights)} room nights,{" "}
                      {eur(Math.round(metrics.forecast_horizon.room_revenue_eur))} room revenue.
                      {metrics.forecast_horizon.sellout_dates.length > 0 &&
                        ` ${metrics.forecast_horizon.sellout_dates.length} date(s) forecast to close out.`}
                    </p>
                  )}
                </>
              )}

              {/* ------------------------------------------- ADR leakage */}

              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-medium">What is lowering ADR?</h3>
                  <Select value={leakFilter} onValueChange={setLeakFilter}>
                    <SelectTrigger className="h-9 w-[170px] text-xs" aria-label="Leakage dimension"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All dimensions</SelectItem>
                      <SelectItem value="channel">Channel</SelectItem>
                      <SelectItem value="room_type">Room type</SelectItem>
                      <SelectItem value="stay_date">Arrival date</SelectItem>
                      <SelectItem value="length_of_stay">Length of stay</SelectItem>
                      <SelectItem value="rate_plan">Rate plan</SelectItem>
                      <SelectItem value="promotion">Promotion</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {leaks.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No ADR leakage identified for this dimension.</p>
                ) : (
                  <ul className="divide-y rounded-md border">
                    {leaks.map((l, i) => (
                      <li key={`${l.dimension}-${l.name}-${i}`} className="p-2 space-y-1">
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="font-medium">{l.name}</span>
                          <Badge variant="outline" className="text-[10px] font-normal capitalize">{l.dimension.replace(/_/g, " ")}</Badge>
                        </div>
                        <div className="flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
                          <span>{l.room_nights} room nights</span>
                          {l.adr != null && <span>ADR {eur(Math.round(l.adr))}</span>}
                          {l.target_adr != null && <span>target {eur(Math.round(l.target_adr))}</span>}
                          {l.revenue_impact != null && (
                            <span className={l.revenue_impact < 0 ? "text-red-600 dark:text-red-400" : ""}>
                              impact {eur(Math.round(l.revenue_impact))}
                            </span>
                          )}
                        </div>
                        <p className="text-xs">{l.explanation}</p>
                        <p className="text-[11px] text-muted-foreground">{l.recommended_action}</p>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-[11px] text-muted-foreground">
                  A rate below target is not automatically harmful: low-rated business can still be valuable when it
                  fills weak-demand dates, adds length of stay, closes orphan gaps or carries low acquisition cost.
                </p>
              </div>

              {/* ------------------------------------------- monitoring */}
              {output.monitoring_items?.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-medium">Monitoring</h3>
                  <ul className="space-y-1">
                    {output.monitoring_items.map((m, i) => (
                      <li key={i} className="rounded-md border p-2 text-xs">
                        <span className="font-medium">{m.signal}</span>
                        <span className="text-muted-foreground"> — now {m.current_value}. Trigger: {m.trigger}.</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {(output.data_quality?.warnings ?? []).length > 0 && (
                <div className="rounded-md border p-2 text-[11px] text-muted-foreground space-y-1">
                  {output.data_quality.warnings.map((w, i) => (
                    <p key={i} className="flex gap-2"><AlertTriangle className="h-3.5 w-3.5 shrink-0" />{w}</p>
                  ))}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Phase 3 — external demand signals feeding the analysis */}
      <MarketSignalsPanel hotelId={hotelId} />

      {/* Events calendar — manual entries plus AI-found events feeding the surcharge */}
      <EventsPanel hotelId={hotelId} />

      {/* Phase 4 — measured outcomes of applied recommendations */}
      <RecommendationOutcomesPanel hotelId={hotelId} />
      </div>
    </TooltipProvider>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}
