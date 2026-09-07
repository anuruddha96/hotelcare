// Honest, always-visible status and editable Engine V2 controls for automatic pricing.
//
// This component deliberately reads and writes the SAME revenue_pickup_automation_rules
// row consumed by Engine V2. There is no second client-side preset: owners can see the
// active cadence, safety controls and booking-window movement rules that the engine uses.
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Zap, PauseCircle, AlertTriangle, ChevronDown, ChevronUp, Save, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";

interface WindowRule {
  id: string;
  min_days_out: number;
  max_days_out: number | null;
  no_pickup_wait_hours: number | null;
  min_hours_between_decreases: number;
  max_daily_decrease: number;
  max_daily_increase: number;
  require_above_anchor: boolean;
}

interface RuleRow {
  id: string;
  is_enabled: boolean | null;
  mode: string | null;
  auto_publish: boolean | null;
  last_run_at: string | null;
  last_evaluated_at: string | null;
  last_evaluation_status: string | null;
  last_evaluation_error: string | null;
  next_run_at: string | null;
  engine_version: number | null;
  evaluation_interval_minutes: number | null;
  min_movement_eur: number | null;
  direction_change_hours: number | null;
  manual_hold_hours: number | null;
  adr_guard_enabled: boolean | null;
  adr_target_eur: number | null;
  adr_window_days: number | null;
  max_markdowns_per_day: number | null;
  window_rules: WindowRule[] | null;
  updated_at: string | null;
}

function when(v: string | null | undefined) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString();
}

const n = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

function normaliseWindows(value: unknown): WindowRule[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((raw: any, index) => ({
      id: String(raw?.id || `window_${index + 1}`),
      min_days_out: Math.max(0, Math.round(n(raw?.min_days_out, 0))),
      max_days_out: raw?.max_days_out == null ? null : Math.max(0, Math.round(n(raw.max_days_out, 0))),
      no_pickup_wait_hours: raw?.no_pickup_wait_hours == null ? null : Math.max(0, n(raw.no_pickup_wait_hours, 0)),
      min_hours_between_decreases: Math.max(0, n(raw?.min_hours_between_decreases, 0)),
      max_daily_decrease: Math.max(0, n(raw?.max_daily_decrease, 0)),
      max_daily_increase: Math.max(0, n(raw?.max_daily_increase, 0)),
      require_above_anchor: raw?.require_above_anchor === true,
    }))
    .sort((a, b) => a.min_days_out - b.min_days_out);
}

function windowLabel(w: WindowRule) {
  return w.max_days_out == null ? `${w.min_days_out}+ days` : `${w.min_days_out}–${w.max_days_out} days`;
}

function NumberField({
  label, value, onChange, min = 0, step = 1, suffix,
}: {
  label: string;
  value: number | null | undefined;
  onChange: (value: number) => void;
  min?: number;
  step?: number;
  suffix?: string;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      <div className="relative">
        <Input
          type="number"
          min={min}
          step={step}
          value={value ?? 0}
          className={suffix ? "h-8 pr-10 text-xs" : "h-8 text-xs"}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        {suffix && <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">{suffix}</span>}
      </div>
    </div>
  );
}

export function AutomationStatusLine({ hotelId }: { hotelId: string | null }) {
  const [rule, setRule] = useState<RuleRow | null>(null);
  const [draft, setDraft] = useState<RuleRow | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!hotelId) { setRule(null); setDraft(null); return; }
    const { data, error } = await supabase
      .from("revenue_pickup_automation_rules")
      .select("id,is_enabled,mode,auto_publish,last_run_at,last_evaluated_at,last_evaluation_status,last_evaluation_error,next_run_at,engine_version,evaluation_interval_minutes,min_movement_eur,direction_change_hours,manual_hold_hours,adr_guard_enabled,adr_target_eur,adr_window_days,max_markdowns_per_day,window_rules,updated_at")
      .eq("hotel_id", hotelId)
      .maybeSingle();
    if (error) return;
    const next = data ? ({ ...(data as any), window_rules: normaliseWindows((data as any).window_rules) } as RuleRow) : null;
    setRule(next);
    setDraft(next ? { ...next, window_rules: next.window_rules?.map((w) => ({ ...w })) ?? [] } : null);
  };

  useEffect(() => {
    if (!hotelId) { setRule(null); setDraft(null); return; }
    let cancelled = false;
    const refresh = async () => {
      const { data } = await supabase
        .from("revenue_pickup_automation_rules")
        .select("id,is_enabled,mode,auto_publish,last_run_at,last_evaluated_at,last_evaluation_status,last_evaluation_error,next_run_at,engine_version,evaluation_interval_minutes,min_movement_eur,direction_change_hours,manual_hold_hours,adr_guard_enabled,adr_target_eur,adr_window_days,max_markdowns_per_day,window_rules,updated_at")
        .eq("hotel_id", hotelId)
        .maybeSingle();
      if (cancelled || !data) return;
      const next = { ...(data as any), window_rules: normaliseWindows((data as any).window_rules) } as RuleRow;
      setRule(next);
      if (!expanded) setDraft({ ...next, window_rules: next.window_rules?.map((w) => ({ ...w })) ?? [] });
    };
    void refresh();
    const t = window.setInterval(() => void refresh(), 120_000);
    return () => { cancelled = true; window.clearInterval(t); };
  }, [hotelId, expanded]);

  const dirty = useMemo(() => {
    if (!rule || !draft) return false;
    const pick = (r: RuleRow) => ({
      evaluation_interval_minutes: r.evaluation_interval_minutes,
      min_movement_eur: r.min_movement_eur,
      direction_change_hours: r.direction_change_hours,
      manual_hold_hours: r.manual_hold_hours,
      adr_guard_enabled: r.adr_guard_enabled,
      adr_target_eur: r.adr_target_eur,
      adr_window_days: r.adr_window_days,
      max_markdowns_per_day: r.max_markdowns_per_day,
      window_rules: r.window_rules,
    });
    return JSON.stringify(pick(rule)) !== JSON.stringify(pick(draft));
  }, [rule, draft]);

  if (!rule) return null;

  const live = rule.mode === "live" && rule.auto_publish === true;
  const disabled = rule.is_enabled === false;
  const needsAttention = !disabled && !live;
  const Icon = disabled ? PauseCircle : live ? Zap : AlertTriangle;
  const tone = disabled
    ? "text-muted-foreground"
    : live
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-destructive";

  const headline = disabled
    ? "Automatic pricing is switched off for this property."
    : live
      ? "Automatic pricing is live — price changes are sent to Previo."
      : "Automatic pricing needs attention — open Pricing activity for details.";

  const lastRun = when(rule.last_run_at ?? rule.last_evaluated_at);
  const nextRun = when(rule.next_run_at);
  const isV2 = Number(rule.engine_version ?? 1) >= 2;

  const setField = <K extends keyof RuleRow>(key: K, value: RuleRow[K]) => {
    setDraft((current) => current ? { ...current, [key]: value } : current);
  };

  const setWindow = (index: number, patch: Partial<WindowRule>) => {
    setDraft((current) => {
      if (!current) return current;
      const rows = (current.window_rules ?? []).map((row, i) => i === index ? { ...row, ...patch } : row);
      return { ...current, window_rules: rows };
    });
  };

  async function saveV2() {
    if (!draft || !hotelId || !isV2) return;
    const windows = normaliseWindows(draft.window_rules);
    if (windows.length === 0) {
      toast.error("Booking-window rules cannot be empty", { description: "Engine V2 must have explicit visible rules; it will not rely on a hidden hotel preset." });
      return;
    }
    for (let i = 0; i < windows.length; i++) {
      const w = windows[i];
      if (w.max_days_out != null && w.max_days_out < w.min_days_out) {
        toast.error(`Check ${windowLabel(w)}`, { description: "The end of a booking window cannot be before its start." });
        return;
      }
      if (i > 0) {
        const prev = windows[i - 1];
        if (prev.max_days_out == null || w.min_days_out !== prev.max_days_out + 1) {
          toast.error("Booking windows must be continuous", { description: "There cannot be a hidden or uncovered lead-time gap between two rows." });
          return;
        }
      }
    }
    setSaving(true);
    const interval = Math.max(10, Math.round(n(draft.evaluation_interval_minutes, 60)));
    const patch = {
      evaluation_interval_minutes: interval,
      min_movement_eur: Math.max(1, Math.round(n(draft.min_movement_eur, 3))),
      direction_change_hours: Math.max(0, n(draft.direction_change_hours, 2)),
      manual_hold_hours: Math.max(0, n(draft.manual_hold_hours, 1)),
      adr_guard_enabled: draft.adr_guard_enabled === true,
      adr_target_eur: Math.max(0, n(draft.adr_target_eur, 130)),
      adr_window_days: Math.max(1, Math.round(n(draft.adr_window_days, 7))),
      max_markdowns_per_day: Math.max(0, Math.round(n(draft.max_markdowns_per_day, 3))),
      window_rules: windows,
      next_run_at: draft.is_enabled
        ? new Date(Date.now() + interval * 60_000).toISOString()
        : null,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase
      .from("revenue_pickup_automation_rules")
      .update(patch as any)
      .eq("id", draft.id)
      .eq("hotel_id", hotelId);
    setSaving(false);
    if (error) {
      toast.error("Could not save automation rules", { description: error.message });
      return;
    }
    toast.success("Active automation rules saved", { description: "Engine V2 will use these visible values on its next scheduled check." });
    await load();
  }

  return (
    <div className="rounded-md border bg-muted/30 text-xs">
      <div className="flex flex-wrap items-start gap-2 px-2.5 py-2">
        <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${tone}`} />
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className={`font-medium ${tone}`}>{headline}</div>
          <div className="text-muted-foreground">
            {lastRun ? `Last run ${lastRun}` : "No run recorded yet"}
            {nextRun ? ` · next run ${nextRun}` : ""}
            {rule.last_evaluation_status ? ` · ${rule.last_evaluation_status.replace(/_/g, " ")}` : ""}
          </div>
          {live && rule.last_evaluation_error && <div className="text-destructive">Last run reported: {rule.last_evaluation_error}</div>}
          {needsAttention && rule.last_evaluation_error && <div className="text-destructive">{rule.last_evaluation_error}</div>}
        </div>
        {isV2 && (
          <Button type="button" size="sm" variant="ghost" className="h-7 gap-1 px-2 text-[11px]" onClick={() => setExpanded((v) => !v)}>
            Active rules {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </Button>
        )}
      </div>

      {isV2 && expanded && draft && (
        <div className="space-y-4 border-t bg-background/80 p-3">
          <div>
            <p className="font-semibold">Engine V2 · active automation rules</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              These are the persisted property settings read by the pricing engine. Saving here changes this hotel only; there is no separate UI-only preset.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <NumberField label="Check every" value={draft.evaluation_interval_minutes} min={10} suffix="min" onChange={(v) => setField("evaluation_interval_minutes", v)} />
            <NumberField label="Minimum move" value={draft.min_movement_eur} min={1} suffix="EUR" onChange={(v) => setField("min_movement_eur", v)} />
            <NumberField label="Direction cooldown" value={draft.direction_change_hours} min={0} step={0.5} suffix="h" onChange={(v) => setField("direction_change_hours", v)} />
            <NumberField label="Manual price hold" value={draft.manual_hold_hours} min={0} step={0.5} suffix="h" onChange={(v) => setField("manual_hold_hours", v)} />
            <NumberField label="Markdowns / date / day" value={draft.max_markdowns_per_day} min={0} suffix="×" onChange={(v) => setField("max_markdowns_per_day", v)} />
            <NumberField label="ADR target" value={draft.adr_target_eur} min={0} suffix="EUR" onChange={(v) => setField("adr_target_eur", v)} />
            <NumberField label="ADR guard window" value={draft.adr_window_days} min={1} suffix="days" onChange={(v) => setField("adr_window_days", v)} />
            <div className="flex items-end pb-1">
              <div className="flex w-full items-center justify-between rounded-md border px-2 py-1.5">
                <div>
                  <p className="text-[11px] font-medium">ADR guard</p>
                  <p className="text-[10px] text-muted-foreground">Protect blended target</p>
                </div>
                <Switch checked={draft.adr_guard_enabled === true} onCheckedChange={(v) => setField("adr_guard_enabled", v)} />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <div>
              <p className="font-semibold">Booking-window movement rules</p>
              <p className="text-[11px] text-muted-foreground">
                Each row controls how quickly a quiet date may move and its daily up/down budget. Zero decrease means the window will not automatically markdown.
              </p>
            </div>
            <div className="space-y-2">
              {(draft.window_rules ?? []).map((w, index) => (
                <div key={`${w.id}-${index}`} className="rounded-md border p-2">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="font-medium">{windowLabel(w)}</span>
                    <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <Switch checked={w.require_above_anchor} onCheckedChange={(value) => setWindow(index, { require_above_anchor: value })} />
                      Only above anchor
                    </label>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <NumberField label="No-pickup wait" value={w.no_pickup_wait_hours ?? 0} min={0} step={0.5} suffix="h" onChange={(v) => setWindow(index, { no_pickup_wait_hours: v })} />
                    <NumberField label="Between markdowns" value={w.min_hours_between_decreases} min={0} step={0.5} suffix="h" onChange={(v) => setWindow(index, { min_hours_between_decreases: v })} />
                    <NumberField label="Max decrease / day" value={w.max_daily_decrease} min={0} suffix="EUR" onChange={(v) => setWindow(index, { max_daily_decrease: v })} />
                    <NumberField label="Max increase / day" value={w.max_daily_increase} min={0} suffix="EUR" onChange={(v) => setWindow(index, { max_daily_increase: v })} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/30 p-2">
            <div className="text-[10px] text-muted-foreground">
              {dirty ? "Unsaved changes — the engine is still using the previously saved values." : `Saved settings are active${rule.updated_at ? ` · updated ${when(rule.updated_at)}` : ""}.`}
            </div>
            <div className="flex gap-2">
              {dirty && (
                <Button type="button" size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setDraft({ ...rule, window_rules: rule.window_rules?.map((w) => ({ ...w })) ?? [] })}>
                  Reset
                </Button>
              )}
              <Button type="button" size="sm" className="h-8 gap-1.5 text-xs" disabled={!dirty || saving} onClick={() => void saveV2()}>
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                Save active rules
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
