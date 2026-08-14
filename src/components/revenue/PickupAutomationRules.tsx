import { useEffect, useState } from "react";
import { Bot, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface Props { hotelId: string | null; organizationSlug: string | null; }
interface Tier { max_days: number | null; increase: number; }
interface Rule {
  id?: string; name: string; is_enabled: boolean; auto_publish: boolean;
  booking_window_tiers: Tier[]; same_hour_window_minutes: number;
  second_pickup_surcharge: number; minimum_adr: number | null;
  maximum_increase: number | null; max_daily_increase_per_date: number;
  application_scope: "booked_room_type" | "all_room_types";
  positive_pickup_enabled: boolean; pickup_lookback_hours: number;
  no_pickup_enabled: boolean; no_pickup_lookback_hours: number;
  future_booking_window_days: number; no_pickup_run_times: string[];
  run_timezone: string; no_pickup_decrease: number;
  max_daily_decrease_per_date: number;
  no_pickup_scope: "booked_room_type" | "all_room_types";
  evaluation_interval_minutes: number;
  protect_high_occupancy: boolean;
  markdown_max_occupancy_pct: number;
  manual_markdown_hold_hours: number;
  currency: string;
  last_run_at?: string | null;
  next_run_at?: string | null;
  last_evaluated_at?: string | null;
  last_evaluation_status?: string | null;
  last_evaluation_error?: string | null;
  version: number;
}


/** Starting suggestions only — a hotel is never automated until it is saved with the switch on. */
const DEFAULT_RULE: Rule = {
  name: "Pickup pricing", is_enabled: false, auto_publish: true,
  booking_window_tiers: [{ max_days: 31, increase: 8 }, { max_days: 93, increase: 18 }, { max_days: null, increase: 22 }],
  same_hour_window_minutes: 60, second_pickup_surcharge: 25, minimum_adr: 120,
  maximum_increase: 25, max_daily_increase_per_date: 40,
  application_scope: "booked_room_type", version: 1,
  positive_pickup_enabled: true, pickup_lookback_hours: 48,
  no_pickup_enabled: false, no_pickup_lookback_hours: 8,
  future_booking_window_days: 183, no_pickup_run_times: ["08:00", "14:00", "20:00"],
  run_timezone: "Europe/Budapest", no_pickup_decrease: 2,
  max_daily_decrease_per_date: 10, no_pickup_scope: "all_room_types", currency: "EUR",
};

/** Turns the saved numbers into sentences a non-technical owner can check. */
function explain(rule: Rule, hotelName: string): string[] {
  if (!rule.is_enabled) {
    return [`Automation is off for ${hotelName}. Nothing will change automatically here — the numbers below are only a starting point until you turn it on and save.`];
  }
  const tiers = rule.booking_window_tiers ?? [];
  const lines: string[] = [];
  lines.push(
    rule.application_scope === "all_room_types"
      ? `When a new booking arrives at ${hotelName}, every room type on that stay date goes up. No other date or hotel is touched.`
      : `When a new booking arrives at ${hotelName}, only the booked room type on that stay date goes up. No other room type, date or hotel is touched.`,
  );
  tiers.forEach((tier, index) => {
    const window = tier.max_days === null
      ? "more than 3 months away"
      : index === 0
        ? "within the next month"
        : `${tiers[index - 1]?.max_days ?? 0}–${tier.max_days} days away`;
    lines.push(`If the stay date is ${window}: add €${tier.increase} to that date.`);
  });
  lines.push(
    `If a second booking lands for the same date inside ${rule.same_hour_window_minutes} minutes, the matched room type gets €${rule.second_pickup_surcharge} instead — demand is spiking.`,
  );
  if (rule.minimum_adr) lines.push(`Prices are never published below €${rule.minimum_adr}.`);
  if (rule.maximum_increase) lines.push(`One pickup can add at most €${rule.maximum_increase}.`);
  lines.push(`A single date can rise at most €${rule.max_daily_increase_per_date} in one day, no matter how many bookings arrive.`);
  if (rule.no_pickup_enabled) lines.push(
    `At ${rule.no_pickup_run_times.join(", ")} ${rule.run_timezone}, dates in the next ${rule.future_booking_window_days} days with no new booking for ${rule.no_pickup_lookback_hours} hours decrease by ${rule.currency} ${rule.no_pickup_decrease}. A date never decreases by more than ${rule.currency} ${rule.max_daily_decrease_per_date} per day.`,
  );
  lines.push(
    rule.auto_publish
      ? "Matched changes are sent to Previo automatically and appear in the calendar with an automation marker."
      : "Matched changes are only suggested — you publish them yourself from the calendar.",
  );
  return lines;
}

interface ChangedRow {
  stay_date: string; room_type_name: string | null; occupancy: number;
  old_price: number; new_price: number; currency?: string | null; status: string;
}
interface RunResult {
  hotelName: string; actor: string; pickups: number; actions: number;
  pushed: number; failed: number; autoPublish: boolean;
  pushError?: string | null; changed: ChangedRow[];
}

export default function PickupAutomationRules({ hotelId, organizationSlug }: Props) {
  const [rule, setRule] = useState<Rule>(DEFAULT_RULE);
  const [hasSavedRule, setHasSavedRule] = useState(false);
  const [savedEnabled, setSavedEnabled] = useState(false);
  const [hotelName, setHotelName] = useState<string>(hotelId ?? "this hotel");
  const [otherRules, setOtherRules] = useState<Array<{ hotel_id: string; label: string; rule: Rule }>>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmOn, setConfirmOn] = useState(false);
  const [running, setRunning] = useState(false);
  const [stats, setStats] = useState({ pushed: 0, failed: 0, lastActionAt: null as string | null });
  const [runResult, setRunResult] = useState<RunResult | null>(null);

  useEffect(() => {
    if (!hotelId) return;
    setLoading(true);
    void (async () => {
      const [ruleRes, nameRes, othersRes, actionsRes] = await Promise.all([
        supabase.from("revenue_pickup_automation_rules").select("*").eq("hotel_id", hotelId).eq("name", "Pickup pricing").maybeSingle(),
        supabase.from("hotel_configurations").select("hotel_id, hotel_name"),
        supabase.from("revenue_pickup_automation_rules").select("*").neq("hotel_id", hotelId),
        supabase.from("revenue_pickup_automation_actions")
          .select("status, created_at").eq("hotel_id", hotelId)
          .order("created_at", { ascending: false }).limit(500),
      ]);

      const names = new Map<string, string>();
      for (const row of (nameRes.data ?? []) as any[]) names.set(row.hotel_id, row.hotel_name);
      setHotelName(names.get(hotelId) ?? hotelId);

      if (ruleRes.data) {
        setRule(ruleRes.data as unknown as Rule);
        setHasSavedRule(true);
        setSavedEnabled(Boolean((ruleRes.data as any).is_enabled));
      } else {
        setRule(DEFAULT_RULE);
        setHasSavedRule(false);
        setSavedEnabled(false);
      }

      setOtherRules(((othersRes.data ?? []) as any[]).map((r) => ({
        hotel_id: r.hotel_id,
        label: names.get(r.hotel_id) ?? r.hotel_id,
        rule: r as unknown as Rule,
      })));
      const actions = (actionsRes.data ?? []) as Array<{ status: string; created_at: string }>;
      setStats({
        pushed: actions.filter((a) => a.status === "pushed").length,
        failed: actions.filter((a) => a.status === "failed").length,
        lastActionAt: actions[0]?.created_at ?? null,
      });
      setLoading(false);
    })();
  }, [hotelId]);

  const updateTier = (index: number, increase: number) => setRule((current) => ({
    ...current, booking_window_tiers: current.booking_window_tiers.map((tier, i) => i === index ? { ...tier, increase } : tier),
  }));

  function copyFrom(sourceHotelId: string) {
    const source = otherRules.find((o) => o.hotel_id === sourceHotelId);
    if (!source) return;
    // Settings copy across, but the switch stays where it is — turning a hotel
    // on is always a deliberate action.
    setRule((current) => ({
      ...current,
      booking_window_tiers: source.rule.booking_window_tiers,
      same_hour_window_minutes: source.rule.same_hour_window_minutes,
      second_pickup_surcharge: source.rule.second_pickup_surcharge,
      minimum_adr: source.rule.minimum_adr,
      maximum_increase: source.rule.maximum_increase,
      max_daily_increase_per_date: source.rule.max_daily_increase_per_date,
      application_scope: source.rule.application_scope ?? "booked_room_type",
      auto_publish: source.rule.auto_publish,
      positive_pickup_enabled: source.rule.positive_pickup_enabled ?? true,
      pickup_lookback_hours: source.rule.pickup_lookback_hours ?? 48,
      no_pickup_enabled: source.rule.no_pickup_enabled ?? false,
      no_pickup_lookback_hours: source.rule.no_pickup_lookback_hours ?? 8,
      future_booking_window_days: source.rule.future_booking_window_days ?? 183,
      no_pickup_run_times: source.rule.no_pickup_run_times ?? ["08:00", "14:00", "20:00"],
      run_timezone: source.rule.run_timezone ?? "Europe/Budapest",
      no_pickup_decrease: source.rule.no_pickup_decrease ?? 2,
      max_daily_decrease_per_date: source.rule.max_daily_decrease_per_date ?? 10,
      no_pickup_scope: source.rule.no_pickup_scope ?? "all_room_types",
      currency: source.rule.currency ?? "EUR",
    }));
    toast.success(`Copied settings from ${source.label} — still off until you turn it on`);
  }

  function requestSave() {
    if (rule.is_enabled && !savedEnabled) { setConfirmOn(true); return; }
    void save();
  }

  async function save() {
    if (!hotelId || !organizationSlug) return;
    setSaving(true);
    const { data: auth } = await supabase.auth.getUser();
    const payload = {
      hotel_id: hotelId, organization_slug: organizationSlug, name: rule.name,
      is_enabled: rule.is_enabled, auto_publish: rule.auto_publish,
      booking_window_tiers: rule.booking_window_tiers,
      same_hour_window_minutes: rule.same_hour_window_minutes,
      second_pickup_surcharge: rule.second_pickup_surcharge,
      minimum_adr: rule.minimum_adr,
      maximum_increase: rule.maximum_increase,
      max_daily_increase_per_date: rule.max_daily_increase_per_date,
      application_scope: rule.application_scope,
      positive_pickup_enabled: rule.positive_pickup_enabled,
      pickup_lookback_hours: rule.pickup_lookback_hours,
      no_pickup_enabled: rule.no_pickup_enabled,
      no_pickup_lookback_hours: rule.no_pickup_lookback_hours,
      future_booking_window_days: rule.future_booking_window_days,
      no_pickup_run_times: rule.no_pickup_run_times,
      run_timezone: rule.run_timezone,
      no_pickup_decrease: rule.no_pickup_decrease,
      max_daily_decrease_per_date: rule.max_daily_decrease_per_date,
      no_pickup_scope: rule.no_pickup_scope,
      currency: rule.currency,
      version: rule.version + (rule.id ? 1 : 0),
      created_by: auth.user?.id ?? null, updated_by: auth.user?.id ?? null,
    };
    const { data, error } = await supabase.from("revenue_pickup_automation_rules")
      .upsert(payload as any, { onConflict: "hotel_id,name" }).select("*").single();
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    setRule(data as unknown as Rule);
    setHasSavedRule(true);
    setSavedEnabled(Boolean((data as any).is_enabled));
    toast.success(rule.is_enabled ? `Pickup automation is now ON for ${hotelName}` : `Saved — automation stays OFF for ${hotelName}`);
  }

  /** Manual run. Every outcome gets its own sentence — never a generic error. */
  async function runNow() {
    if (!hotelId) { toast.error("Choose a property first"); return; }
    if (!hasSavedRule) { toast.error(`No automation rule is saved for ${hotelName} yet`, { description: "Set the values below and save first." }); return; }
    if (!savedEnabled) { toast.error(`Automation is switched off for ${hotelName}`, { description: "Turn the switch on and save to allow runs." }); return; }
    setRunning(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const { data, error } = await supabase.functions.invoke("revenue-pickup-automation", { body: { hotelId } });
      const payload = (data ?? {}) as any;
      if (error && !payload?.code) {
        // The function returns its reason in the body; only a transport-level
        // failure reaches here without one.
        const detail = await (error as any)?.context?.text?.().catch(() => "");
        let parsed: any = {};
        try { parsed = detail ? JSON.parse(detail) : {}; } catch { /* not JSON */ }
        if (parsed?.msg || parsed?.error) { toast.error(parsed.msg ?? parsed.error); return; }
        toast.error("The pricing service did not respond", { description: error.message });
        return;
      }
      const code = payload.code as string | undefined;
      if (code && code !== "ran") {
        const message = payload.msg ?? payload.error ?? "The run could not start";
        if (code === "paused" || code === "busy") toast.warning(message);
        else toast.error(message);
        return;
      }
      const summary = payload.summary?.[0];
      if (!summary) { toast.success(`No qualifying pickup for ${hotelName} right now`); return; }
      const pickups = Number(summary.pickups ?? 0);
      const actions = Number(summary.actions ?? 0);
      const pushed = Number(summary.pushed ?? 0);
      const failed = Number(summary.failed ?? 0);
      if (actions === 0) {
        toast.success(
          pickups === 0
            ? `No new bookings for ${hotelName} in the lookback window — nothing to price`
            : `Checked ${pickups} pickups at ${hotelName} — none qualified for a price change`,
        );
        return;
      }
      setRunResult({
        hotelName,
        actor: (auth.user?.user_metadata?.full_name as string) || payload.actor || auth.user?.email || "You",
        pickups, actions, pushed, failed,
        autoPublish: Boolean(summary.auto_publish),
        pushError: summary.push_error ?? null,
        changed: (summary.changed ?? []) as ChangedRow[],
      });
    } finally {
      setRunning(false);
    }
  }

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs">
          <Bot className="h-3.5 w-3.5" />
          Automation
          <span
            className={`ml-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
              savedEnabled
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                : "bg-muted text-muted-foreground"
            }`}
          >
            {savedEnabled ? "On" : "Off"}
          </span>
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Pickup price automation</SheetTitle>
          <p className="text-sm text-muted-foreground">{hotelName} — settings apply to this hotel only.</p>
        </SheetHeader>
        {loading ? <div className="flex flex-1 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div> : (
          <div className="flex-1 min-h-0 space-y-5 overflow-y-auto py-4">
            {!hasSavedRule && (
              <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                Automation has never been set up for {hotelName}. It is <span className="font-semibold">off</span>. The numbers below are
                suggested starting values — nothing runs until you turn the switch on and save.
              </div>
            )}

            {otherRules.length > 0 && (
              <div className="space-y-1.5">
                <Label className="text-xs">Copy settings from another hotel</Label>
                <Select onValueChange={copyFrom}>
                  <SelectTrigger><SelectValue placeholder="Choose a hotel…" /></SelectTrigger>
                  <SelectContent>
                    {otherRules.map((o) => (
                      <SelectItem key={o.hotel_id} value={o.hotel_id}>
                        {o.label}{o.rule.is_enabled ? " (on)" : " (off)"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="flex items-center justify-between border-b pb-4">
              <div>
                <p className="font-medium">Raise prices on new pickup</p>
                <p className="text-xs text-muted-foreground">Only pickup dates at {hotelName} are changed.</p>
              </div>
              <Switch checked={rule.is_enabled} onCheckedChange={(is_enabled) => setRule({ ...rule, is_enabled })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">New-booking lookback (hours)</Label><Input type="number" min={1} max={168} value={rule.pickup_lookback_hours} onChange={(e) => setRule({ ...rule, pickup_lookback_hours: Number(e.target.value) })} /></div>
              <div className="flex items-end justify-between rounded-md border px-3 py-2"><Label>Positive pickup</Label><Switch checked={rule.positive_pickup_enabled} onCheckedChange={(positive_pickup_enabled) => setRule({ ...rule, positive_pickup_enabled })} /></div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">When a booking arrives, change</Label>
              <Select
                value={rule.application_scope}
                onValueChange={(value: "booked_room_type" | "all_room_types") => setRule({ ...rule, application_scope: value })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="booked_room_type">Only the booked room type</SelectItem>
                  <SelectItem value="all_room_types">All room types on that stay date</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-3">
              <p className="text-sm font-medium">First pickup increase</p>
              {rule.booking_window_tiers.map((tier, index) => (
                <div key={index} className="grid grid-cols-[1fr_110px] items-center gap-3">
                  <Label className="text-xs">{tier.max_days === null ? "More than 3 months" : index === 0 ? "Within 1 month" : "2–3 months"}</Label>
                  <div className="flex items-center gap-1"><span className="text-sm">+€</span><Input type="number" value={tier.increase} onChange={(e) => updateTier(index, Number(e.target.value))} /></div>
                </div>
              ))}
            </div>
            <div className="space-y-3 border-t pt-4">
              <p className="text-sm font-medium">Repeat pickup</p>
              <div className="grid grid-cols-2 gap-3">
                <div><Label className="text-xs">Same window (minutes)</Label><Input type="number" value={rule.same_hour_window_minutes} onChange={(e) => setRule({ ...rule, same_hour_window_minutes: Number(e.target.value) })} /></div>
                <div><Label className="text-xs">Second pickup adds (€)</Label><Input type="number" value={rule.second_pickup_surcharge} onChange={(e) => setRule({ ...rule, second_pickup_surcharge: Number(e.target.value) })} /></div>
              </div>
            </div>
            <div className="space-y-3 border-t pt-4">
              <div className="grid grid-cols-2 gap-3">
                <div><Label className="text-xs">Minimum ADR (€)</Label><Input type="number" value={rule.minimum_adr ?? ""} onChange={(e) => setRule({ ...rule, minimum_adr: e.target.value ? Number(e.target.value) : null })} /></div>
                <div><Label className="text-xs">Max rise per date, per day (€)</Label><Input type="number" value={rule.max_daily_increase_per_date} onChange={(e) => setRule({ ...rule, max_daily_increase_per_date: Number(e.target.value) })} /></div>
              </div>
              <div><Label className="text-xs">Maximum increase from one pickup (€)</Label><Input type="number" value={rule.maximum_increase ?? ""} onChange={(e) => setRule({ ...rule, maximum_increase: e.target.value ? Number(e.target.value) : null })} /></div>
              <div className="flex items-center justify-between"><Label>Publish matched changes to Previo</Label><Switch checked={rule.auto_publish} onCheckedChange={(auto_publish) => setRule({ ...rule, auto_publish })} /></div>
            </div>

            <div className="space-y-3 border-t pt-4">
              <div className="flex items-center justify-between">
                <div><p className="text-sm font-medium">Reduce prices when there is no pickup</p><p className="text-xs text-muted-foreground">Runs only at the property-local times below.</p></div>
                <Switch checked={rule.no_pickup_enabled} onCheckedChange={(no_pickup_enabled) => setRule({ ...rule, no_pickup_enabled })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label className="text-xs">No-booking lookback (hours)</Label><Input type="number" min={1} max={168} value={rule.no_pickup_lookback_hours} onChange={(e) => setRule({ ...rule, no_pickup_lookback_hours: Number(e.target.value) })} /></div>
                <div><Label className="text-xs">Future booking window (days)</Label><Input type="number" min={1} max={730} value={rule.future_booking_window_days} onChange={(e) => setRule({ ...rule, future_booking_window_days: Number(e.target.value) })} /></div>
                <div><Label className="text-xs">Decrease per run ({rule.currency})</Label><Input type="number" min={1} max={3} value={rule.no_pickup_decrease} onChange={(e) => setRule({ ...rule, no_pickup_decrease: Number(e.target.value) })} /></div>
                <div><Label className="text-xs">Daily decrease cap ({rule.currency})</Label><Input type="number" min={1} value={rule.max_daily_decrease_per_date} onChange={(e) => setRule({ ...rule, max_daily_decrease_per_date: Number(e.target.value) })} /></div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {rule.no_pickup_run_times.map((time, index) => (
                  <div key={index}><Label className="text-xs">{["Morning", "Afternoon", "Evening"][index] ?? `Run ${index + 1}`}</Label><Input type="time" value={time} onChange={(e) => setRule({ ...rule, no_pickup_run_times: rule.no_pickup_run_times.map((v, i) => i === index ? e.target.value : v) })} /></div>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label className="text-xs">Property timezone</Label><Input value={rule.run_timezone} onChange={(e) => setRule({ ...rule, run_timezone: e.target.value })} /></div>
                <div><Label className="text-xs">Currency</Label><Input value={rule.currency} maxLength={3} onChange={(e) => setRule({ ...rule, currency: e.target.value.toUpperCase() })} /></div>
              </div>
            </div>

            <div className="space-y-2 rounded-lg border bg-muted/40 p-3">
              <p className="text-sm font-medium">What this rule does, in plain words</p>
              <ul className="space-y-1.5 text-xs text-muted-foreground">
                {explain(rule, hotelName).map((line, index) => (
                  <li key={index} className="flex gap-2"><span>•</span><span>{line}</span></li>
                ))}
              </ul>
              {rule.last_run_at && (
                <p className="pt-1 text-[11px] text-muted-foreground">
                  Last checked {new Date(rule.last_run_at).toLocaleString()}.
                </p>
              )}
              <p className="text-[11px] text-muted-foreground">
                Recent actions: {stats.pushed} pushed · {stats.failed} failed
                {stats.lastActionAt ? ` · last change ${new Date(stats.lastActionAt).toLocaleString()}` : ""}
              </p>
            </div>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button onClick={requestSave} disabled={saving || loading}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save automation rule</Button>
          <Button
            variant="outline"
            disabled={running || loading}
            onClick={() => void runNow()}
          >
            {running && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Run now
          </Button>
        </div>

        <Dialog open={!!runResult} onOpenChange={(open) => !open && setRunResult(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Automation run finished</DialogTitle>
              <DialogDescription>
                {runResult?.hotelName} · started by {runResult?.actor}
              </DialogDescription>
            </DialogHeader>
            {runResult && (
              <div className="space-y-3">
                <div className="grid grid-cols-4 gap-2 text-center">
                  {[
                    { label: "Pickups checked", value: runResult.pickups },
                    { label: "Cells matched", value: runResult.actions },
                    { label: runResult.autoPublish ? "Sent to Previo" : "Suggested", value: runResult.autoPublish ? runResult.pushed : runResult.actions },
                    { label: "Failed", value: runResult.failed },
                  ].map((item) => (
                    <div key={item.label} className="rounded-md border p-2">
                      <p className="text-lg font-semibold tabular-nums">{item.value}</p>
                      <p className="text-[10px] leading-tight text-muted-foreground">{item.label}</p>
                    </div>
                  ))}
                </div>
                {runResult.pushError && (
                  <p className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
                    {runResult.pushError}
                  </p>
                )}
                <div className="max-h-64 overflow-y-auto rounded-md border">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-muted/60 text-left">
                      <tr>
                        <th className="p-2 font-medium">Date</th>
                        <th className="p-2 font-medium">Room type</th>
                        <th className="p-2 font-medium">Guests</th>
                        <th className="p-2 font-medium">Price</th>
                        <th className="p-2 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {runResult.changed.length === 0 && (
                        <tr><td colSpan={5} className="p-3 text-center text-muted-foreground">No individual rows returned.</td></tr>
                      )}
                      {runResult.changed.map((row, index) => (
                        <tr key={index} className="border-t">
                          <td className="p-2 whitespace-nowrap">{row.stay_date}</td>
                          <td className="p-2">{row.room_type_name ?? "—"}</td>
                          <td className="p-2 tabular-nums">{row.occupancy}</td>
                          <td className="p-2 tabular-nums whitespace-nowrap">
                            {row.old_price} → <span className="font-semibold">{row.new_price}</span> {row.currency ?? ""}
                          </td>
                          <td className="p-2 capitalize">{row.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        <AlertDialog open={confirmOn} onOpenChange={setConfirmOn}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Turn automation on for {hotelName}?</AlertDialogTitle>
              <AlertDialogDescription>
                {rule.auto_publish
                  ? `New bookings at ${hotelName} will raise that stay date's prices and the changes will be published to Previo automatically, without review.`
                  : `New bookings at ${hotelName} will create suggested price changes for you to publish yourself.`}
                {" "}No other hotel is affected.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => { setConfirmOn(false); void save(); }}>Turn on</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  );
}
