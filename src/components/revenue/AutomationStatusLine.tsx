// Honest, always-visible status for automatic pricing.
//
// Shadow mode is a valid monitoring state and must not be presented as a
// production failure. Only an explicit evaluation error / failed status should
// trigger the red attention state. This is especially important when a newer
// revenue supervisor is publishing prices while this pickup rule remains in
// shadow mode.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Eye, Zap, PauseCircle, AlertTriangle } from "lucide-react";

interface RuleRow {
  is_enabled: boolean | null;
  mode: string | null;
  auto_publish: boolean | null;
  last_run_at: string | null;
  last_evaluated_at: string | null;
  last_evaluation_status: string | null;
  last_evaluation_error: string | null;
  next_run_at: string | null;
  engine_version: number | null;
}

function when(v: string | null | undefined) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString();
}

function whenTime(v: string | null | undefined) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function evaluationNeedsAttention(rule: RuleRow) {
  if (rule.last_evaluation_error?.trim()) return true;

  const status = (rule.last_evaluation_status ?? "").trim().toLowerCase();
  return status.includes("error") || status.includes("fail") || status.includes("blocked");
}

export function AutomationStatusLine({ hotelId }: { hotelId: string | null }) {
  const [rule, setRule] = useState<RuleRow | null>(null);

  useEffect(() => {
    if (!hotelId) { setRule(null); return; }
    let cancelled = false;
    const load = async () => {
      const { data } = await supabase
        .from("revenue_pickup_automation_rules")
        .select("is_enabled, mode, auto_publish, last_run_at, last_evaluated_at, last_evaluation_status, last_evaluation_error, next_run_at, engine_version")
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
  const needsAttention = !disabled && evaluationNeedsAttention(rule);
  const shadow = !disabled && !live && !needsAttention;
  const Icon = disabled ? PauseCircle : needsAttention ? AlertTriangle : live ? Zap : Eye;
  const tone = disabled
    ? "text-muted-foreground"
    : needsAttention
      ? "text-destructive"
      : live
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-muted-foreground";

  const headline = disabled
    ? "Pickup automation rule is switched off for this property."
    : needsAttention
      ? "Automatic pricing needs attention — open Pricing activity for details."
      : live
        ? "Automatic pricing is live — price changes are sent to Previo."
        : "Pickup automation is monitoring in shadow mode — no pricing error detected.";

  const mobileHeadline = disabled
    ? "Automatic pricing off"
    : needsAttention
      ? "Automatic pricing needs attention"
      : live
        ? "Automatic pricing live"
        : "Automation monitoring only";

  const lastRun = when(rule.last_run_at ?? rule.last_evaluated_at);
  const nextRun = when(rule.next_run_at);
  const lastRunTime = whenTime(rule.last_run_at ?? rule.last_evaluated_at);
  const nextRunTime = whenTime(rule.next_run_at);

  return (
    <div className="flex items-start gap-2 rounded-md border bg-muted/30 px-2.5 py-2 text-xs">
      <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${tone}`} />
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className={`font-medium ${tone}`}>
          <span className="sm:hidden">{mobileHeadline}</span>
          <span className="hidden sm:inline">{headline}</span>
        </div>
        <div className="text-muted-foreground sm:hidden">
          {lastRunTime ? `Last ${lastRunTime}` : "No run yet"}
          {nextRunTime ? ` · Next ${nextRunTime}` : ""}
        </div>
        <div className="hidden text-muted-foreground sm:block">
          {lastRun ? `Last run ${lastRun}` : "No run recorded yet"}
          {nextRun ? ` · next run ${nextRun}` : ""}
          {rule.last_evaluation_status ? ` · ${rule.last_evaluation_status.replace(/_/g, " ")}` : ""}
        </div>
        {needsAttention && rule.last_evaluation_error && (
          <div className="text-destructive">{rule.last_evaluation_error}</div>
        )}
        {shadow && (
          <div className="hidden text-muted-foreground sm:block">
            This pickup rule is observing only; it is not reporting a failure.
          </div>
        )}
      </div>
    </div>
  );
}
