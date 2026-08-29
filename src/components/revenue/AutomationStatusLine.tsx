// Honest, always-visible status for automatic pricing.
//
// Shadow mode looks identical to "broken" from the outside: runs happen, no
// price moves, nothing is sent. This line says so in plain language, shows
// when the last run happened and which safety checks are still outstanding.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { FlaskConical, Zap, PauseCircle } from "lucide-react";

interface RuleRow {
  is_enabled: boolean | null;
  mode: string | null;
  auto_publish: boolean | null;
  last_run_at: string | null;
  last_evaluated_at: string | null;
  last_evaluation_status: string | null;
  last_evaluation_error: string | null;
  next_run_at: string | null;
  shadow_started_at: string | null;
  gate_results: Record<string, unknown> | null;
  engine_version: number | null;
}

const CHECK_LABELS: Record<string, string> = {
  shadow_24h_complete: "24 hours of shadow testing",
  runs_healthy: "12 clean runs in a row",
  dates_evaluated: "dates evaluated",
  markdown_share_sane: "sensible number of markdowns",
  whole_euro_only: "whole-euro prices only",
  within_floor_and_ceiling: "prices inside floor and ceiling",
  no_dual_direction_dates: "no date moved both ways",
  daily_budget_respected: "daily movement limits respected",
  inventory_correct: "room count correct",
  child_cells_consistent: "every moved date has price cells",
  no_stale_data_decisions: "no decisions on stale data",
};

function when(v: string | null | undefined) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString();
}

export function AutomationStatusLine({ hotelId }: { hotelId: string | null }) {
  const [rule, setRule] = useState<RuleRow | null>(null);

  useEffect(() => {
    if (!hotelId) { setRule(null); return; }
    let cancelled = false;
    const load = async () => {
      const { data } = await supabase
        .from("revenue_pickup_automation_rules")
        .select("is_enabled, mode, auto_publish, last_run_at, last_evaluated_at, last_evaluation_status, last_evaluation_error, next_run_at, shadow_started_at, gate_results, engine_version")
        .eq("hotel_id", hotelId)
        .maybeSingle();
      if (!cancelled) setRule((data as unknown as RuleRow) ?? null);
    };
    void load();
    const t = window.setInterval(() => void load(), 120_000);
    return () => { cancelled = true; window.clearInterval(t); };
  }, [hotelId]);

  if (!rule) return null;

  const live = rule.mode === "live" && rule.auto_publish === true;
  const disabled = rule.is_enabled === false;
  const gate = (rule.gate_results ?? {}) as Record<string, unknown>;
  const outstanding = Object.entries(gate)
    .filter(([k, v]) => v === false && CHECK_LABELS[k])
    .map(([k]) => CHECK_LABELS[k]);

  const shadowStart = rule.shadow_started_at ? new Date(rule.shadow_started_at) : null;
  const earliest = shadowStart ? new Date(shadowStart.getTime() + 24 * 3_600_000) : null;

  const Icon = disabled ? PauseCircle : live ? Zap : FlaskConical;
  const tone = disabled
    ? "text-muted-foreground"
    : live
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-amber-600 dark:text-amber-400";

  const headline = disabled
    ? "Automatic pricing is switched off for this property."
    : live
      ? "Automatic pricing is live — price changes are sent to Previo."
      : "Automatic pricing is in shadow test mode — prices are calculated but not sent to Previo.";

  const lastRun = when(rule.last_run_at ?? rule.last_evaluated_at);
  const nextRun = when(rule.next_run_at);

  return (
    <div className="flex flex-wrap items-start gap-2 rounded-md border bg-muted/30 px-2.5 py-2 text-xs">
      <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${tone}`} />
      <div className="min-w-0 space-y-0.5">
        <div className={`font-medium ${tone}`}>{headline}</div>
        <div className="text-muted-foreground">
          {lastRun ? `Last run ${lastRun}` : "No run recorded yet"}
          {nextRun ? ` · next run ${nextRun}` : ""}
          {rule.last_evaluation_status ? ` · ${rule.last_evaluation_status.replace(/_/g, " ")}` : ""}
        </div>
        {rule.last_evaluation_error && (
          <div className="text-destructive">Last run reported: {rule.last_evaluation_error}</div>
        )}
        {!live && !disabled && (
          <div className="text-muted-foreground">
            {earliest ? `Safety review can complete from ${earliest.toLocaleString()}. ` : ""}
            {outstanding.length > 0
              ? `Still outstanding: ${outstanding.join(", ")}.`
              : "All safety checks currently pass; live mode switches on automatically after the review window."}
          </div>
        )}
      </div>
    </div>
  );
}
