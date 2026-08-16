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
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { errorMessage } from "@/lib/errorMessage";

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
  smart_pricing_enabled: boolean;
  near_term_days: number;
  low_occupancy_pct: number;
  long_lead_days: number;
  high_occupancy_pct: number;
  strong_demand_increase: number;
  ai_assist_enabled: boolean;
  short_window_guard_enabled: boolean;
  short_window_days: number;
  short_window_min_occupancy_pct: number;
  whole_number_prices: boolean;
  sold_out_guard_enabled: boolean;
  sold_out_occupancy_pct: number;
  cancellation_markdown_enabled: boolean;
  cancellation_wait_minutes: number;
  immediate_sell_mode_enabled: boolean;
  immediate_window_days: number;
  immediate_markdown_step: number;
  spike_detection_enabled: boolean;
  spike_threshold_pct: number;
  spike_lookback_days: number;
  event_surcharge_eur: number;
  event_surcharge_auto: boolean;
  last_run_at?: string | null;
  next_run_at?: string | null;
  last_evaluated_at?: string | null;
  last_evaluation_status?: string | null;
  last_evaluation_error?: string | null;
  version: number;
}


/** "in 47 minutes" / "due now" — the schedule in words, not a timestamp alone. */
function untilLabel(iso: string): string {
  const ms = Date.parse(iso) - Date.now();
  if (!Number.isFinite(ms)) return "";
  if (ms <= 0) return "Due now — it runs on the next cycle.";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `in about ${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `in about ${hours} hour${hours === 1 ? "" : "s"}${rest ? ` ${rest} min` : ""}`;
}

/** Money for plain-language copy: cents only when they matter. */
const money = (n: number) =>
  Number.isInteger(n) ? String(n) : n.toFixed(2);

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
  run_timezone: "Europe/Budapest", no_pickup_decrease: 0.5,
  max_daily_decrease_per_date: 10, no_pickup_scope: "all_room_types", currency: "EUR",

  evaluation_interval_minutes: 60, protect_high_occupancy: true,
  markdown_max_occupancy_pct: 88, manual_markdown_hold_hours: 6,
  smart_pricing_enabled: false, near_term_days: 30, low_occupancy_pct: 50,
  long_lead_days: 30, high_occupancy_pct: 85, strong_demand_increase: 0,
  ai_assist_enabled: false,
  short_window_guard_enabled: true, short_window_days: 7,
  short_window_min_occupancy_pct: 70, whole_number_prices: true,
  sold_out_guard_enabled: true, sold_out_occupancy_pct: 100,
  cancellation_markdown_enabled: true, cancellation_wait_minutes: 60,
  immediate_sell_mode_enabled: true, immediate_window_days: 14, immediate_markdown_step: 2,
  spike_detection_enabled: true, spike_threshold_pct: 5, spike_lookback_days: 7,
  event_surcharge_eur: 10, event_surcharge_auto: false,
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
  if (rule.no_pickup_enabled) {
    const step = rule.no_pickup_decrease ?? 0.5;
    const perDay = Math.max(1, Math.floor(1440 / Math.max(60, rule.evaluation_interval_minutes))) * step;
    lines.push(
      `Every ${rule.evaluation_interval_minutes} minutes, dates in the next ${rule.future_booking_window_days} days that picked up nothing since the previous check go down by ${rule.currency} ${money(step)}. A date moves one step per check no matter how many room types it has, so at most ${rule.currency} ${money(Math.min(perDay, rule.max_daily_decrease_per_date))} per date per day.`,
    );

    if (rule.smart_pricing_enabled) {
      lines.push(
        `Smart pricing: a date ${rule.near_term_days} days away or closer sitting under ${rule.low_occupancy_pct}% occupancy with no pickup can come down by ${rule.currency} ${money(step)}. A date that is already busier than that is left where it is.`,
      );
    }
    if (rule.protect_high_occupancy) lines.push(`Dates already at ${rule.markdown_max_occupancy_pct}% occupancy or higher are never marked down, and a sold-out date never moves.`);
    if (rule.manual_markdown_hold_hours > 0) lines.push(`After someone changes a price by hand, that date is left alone for ${rule.manual_markdown_hold_hours} hours.`);
  }
  if (rule.smart_pricing_enabled && Number(rule.strong_demand_increase) > 0) {
    lines.push(
      `Strong early demand: a date more than ${rule.long_lead_days} days away that is already above ${rule.high_occupancy_pct}% occupancy may rise by ${rule.currency} ${money(rule.strong_demand_increase)}, still inside the ${rule.currency} ${money(rule.max_daily_increase_per_date)} daily limit for that date.`,
    );
  }
  if (rule.smart_pricing_enabled && rule.ai_assist_enabled) {
    lines.push("AI assist reviews each check with your own OpenAI account and may soften or cancel a move. It can never make one bigger, and if it is unavailable the ordinary rules simply continue.");
  }

  if (rule.short_window_guard_enabled) {
    lines.push(
      `Short booking window: a stay date within ${rule.short_window_days} days is only allowed to rise if it is already above ${rule.short_window_min_occupancy_pct}% occupancy. A quiet last-minute date keeps its price (and can still come down) even when a booking arrives.`,
    );
  }
  if (rule.sold_out_guard_enabled) {
    lines.push(
      `Sold out: once a date reaches ${rule.sold_out_occupancy_pct}% occupancy (or has no rooms left) the price stops rising — there is nothing left to sell. A cancellation puts the date back in play on the next check.`,
    );
  }
  if (rule.no_pickup_enabled) {
    lines.push(
      rule.cancellation_markdown_enabled
        ? `Cancellations: a date that loses a booking is lowered like a quiet date, but only after a ${rule.cancellation_wait_minutes}-minute wait — the room often sells again first. The cell history says the price drop is waiting and when it can happen.`
        : "Cancellations: a lost booking does not itself trigger a price drop; the date is only marked down when the usual quiet-date rules apply.",
    );
  }
  if (rule.whole_number_prices) {
    lines.push(`Prices are always sent as whole ${rule.currency} — never with cents.`);
  }

  lines.push(
    rule.auto_publish
      ? "Matched changes enter the safe background queue and appear with an automation marker after Previo confirms them."
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
  queued: number; pushed: number; failed: number; autoPublish: boolean;
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
      no_pickup_decrease: source.rule.no_pickup_decrease ?? 0.5,
      max_daily_decrease_per_date: source.rule.max_daily_decrease_per_date ?? 10,
      no_pickup_scope: source.rule.no_pickup_scope ?? "all_room_types",
      evaluation_interval_minutes: source.rule.evaluation_interval_minutes ?? 60,
      protect_high_occupancy: source.rule.protect_high_occupancy ?? true,
      markdown_max_occupancy_pct: source.rule.markdown_max_occupancy_pct ?? 88,
      manual_markdown_hold_hours: source.rule.manual_markdown_hold_hours ?? 6,
      currency: source.rule.currency ?? "EUR",
      smart_pricing_enabled: source.rule.smart_pricing_enabled ?? false,
      near_term_days: source.rule.near_term_days ?? 30,
      low_occupancy_pct: source.rule.low_occupancy_pct ?? 50,
      long_lead_days: source.rule.long_lead_days ?? 30,
      high_occupancy_pct: source.rule.high_occupancy_pct ?? 85,
      strong_demand_increase: source.rule.strong_demand_increase ?? 0,
      ai_assist_enabled: source.rule.ai_assist_enabled ?? false,
      short_window_guard_enabled: source.rule.short_window_guard_enabled ?? true,
      short_window_days: source.rule.short_window_days ?? 7,
      short_window_min_occupancy_pct: source.rule.short_window_min_occupancy_pct ?? 70,
      whole_number_prices: source.rule.whole_number_prices ?? true,
      sold_out_guard_enabled: source.rule.sold_out_guard_enabled ?? true,
      sold_out_occupancy_pct: source.rule.sold_out_occupancy_pct ?? 100,
      cancellation_markdown_enabled: source.rule.cancellation_markdown_enabled ?? true,
      cancellation_wait_minutes: source.rule.cancellation_wait_minutes ?? 60,
      immediate_sell_mode_enabled: source.rule.immediate_sell_mode_enabled ?? true,
      immediate_window_days: source.rule.immediate_window_days ?? 14,
      immediate_markdown_step: source.rule.immediate_markdown_step ?? 2,
      spike_detection_enabled: source.rule.spike_detection_enabled ?? true,
      spike_threshold_pct: source.rule.spike_threshold_pct ?? 5,
      spike_lookback_days: source.rule.spike_lookback_days ?? 7,
      event_surcharge_eur: source.rule.event_surcharge_eur ?? 10,
      event_surcharge_auto: source.rule.event_surcharge_auto ?? false,
    }));

    toast.success(`Copied settings from ${source.label} — still off until you turn it on`);
  }

  function requestSave() {
    if (rule.is_enabled && !savedEnabled) { setConfirmOn(true); return; }
    void save();
  }

  async function save() {
    if (!hotelId || !organizationSlug) return;
    const wasEnabled = savedEnabled;
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
      evaluation_interval_minutes: rule.evaluation_interval_minutes,
      protect_high_occupancy: rule.protect_high_occupancy,
      markdown_max_occupancy_pct: rule.markdown_max_occupancy_pct,
      manual_markdown_hold_hours: rule.manual_markdown_hold_hours,
      smart_pricing_enabled: rule.smart_pricing_enabled,
      near_term_days: rule.near_term_days,
      low_occupancy_pct: rule.low_occupancy_pct,
      long_lead_days: rule.long_lead_days,
      high_occupancy_pct: rule.high_occupancy_pct,
      strong_demand_increase: rule.strong_demand_increase,
      ai_assist_enabled: rule.ai_assist_enabled,
      short_window_guard_enabled: rule.short_window_guard_enabled,
      short_window_days: rule.short_window_days,
      short_window_min_occupancy_pct: rule.short_window_min_occupancy_pct,
      whole_number_prices: rule.whole_number_prices,
      sold_out_guard_enabled: rule.sold_out_guard_enabled,
      sold_out_occupancy_pct: rule.sold_out_occupancy_pct,
      cancellation_markdown_enabled: rule.cancellation_markdown_enabled,
      cancellation_wait_minutes: rule.cancellation_wait_minutes,
      immediate_sell_mode_enabled: rule.immediate_sell_mode_enabled,
      immediate_window_days: rule.immediate_window_days,
      immediate_markdown_step: rule.immediate_markdown_step,
      spike_detection_enabled: rule.spike_detection_enabled,
      spike_threshold_pct: rule.spike_threshold_pct,
      spike_lookback_days: rule.spike_lookback_days,
      event_surcharge_eur: rule.event_surcharge_eur,
      event_surcharge_auto: rule.event_surcharge_auto,
      // Saving never triggers an immediate evaluation: an enabled rule is
      // simply scheduled one normal interval from now, so nobody gets a
      // surprise markdown for pressing Save. "Run now" stays the explicit
      // way to act immediately. A rule that is off is never made due.
      next_run_at: rule.is_enabled
        ? new Date(Date.now() + Math.max(10, rule.evaluation_interval_minutes) * 60_000).toISOString()
        : null,


      no_pickup_scope: rule.no_pickup_scope,
      currency: rule.currency,
      version: rule.version + (rule.id ? 1 : 0),
      created_by: auth.user?.id ?? null, updated_by: auth.user?.id ?? null,
    };
    const { data, error } = await supabase.from("revenue_pickup_automation_rules")
      .upsert(payload as any, { onConflict: "hotel_id,name" }).select("*").single();
    setSaving(false);
    if (error) { toast.error(errorMessage(error, "Could not save these settings")); return; }
    setRule(data as unknown as Rule);
    setHasSavedRule(true);
    setSavedEnabled(Boolean((data as any).is_enabled));

    // Switching the property OFF must actually stop it. Anything the engine
    // decided but has not delivered yet is cancelled (kept as history) so a
    // disabled property can never keep pushing prices minutes later.
    if (!rule.is_enabled && wasEnabled) {
      const { data: stop } = await supabase.functions.invoke("revenue-pickup-automation", {
        body: { hotelId, mode: "stop" },
      });
      const cancelled = Number((stop as any)?.cancelled ?? 0);
      toast.success(`Automation stopped for ${hotelName}`, {
        description: cancelled > 0
          ? `${cancelled} not-yet-sent automatic price${cancelled === 1 ? "" : "s"} cancelled.`
          : "No automatic prices were waiting to be sent.",
      });
      return;
    }
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
        if (parsed?.msg || parsed?.error) { toast.error(errorMessage(parsed)); return; }
        toast.error("The pricing service did not respond", { description: errorMessage(error) });
        return;
      }
      const code = payload.code as string | undefined;
      if (code && code !== "ran") {
        const message = errorMessage(payload, "The run could not start");
        if (code === "paused" || code === "busy") toast.warning(message);
        else toast.error(message);
        return;
      }
      const summary = payload.summary?.[0];
      if (!summary) { toast.success(`No qualifying pickup for ${hotelName} right now`); return; }
      if (summary.skipped) {
        toast.warning(
          summary.reason === "pms_unavailable"
            ? `Previo reservation refresh failed for ${hotelName} — no price was changed`
            : `Skipped ${hotelName}: ${errorMessage(summary.detail, "no reason given")}`,
        );
        return;
      }
      const pickups = Number(summary.pickups ?? 0);
      const actions = Number(summary.actions ?? 0) + Number(summary.markdowns ?? 0) + Number(summary.smart_strong ?? 0);
      const pushed = Number(summary.pushed ?? 0);
      const queued = Number(summary.queued ?? 0);
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
        pickups, actions, queued, pushed, failed,
        autoPublish: Boolean(summary.auto_publish),
        pushError: summary.push_error ?? null,
        changed: (summary.changed ?? []) as ChangedRow[],
      });
    } catch (e) {
      // Anything unexpected still reaches the user as a sentence, never as
      // "[object Object]".
      toast.error(errorMessage(e, "The pricing service could not be reached"));
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
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
        <SheetHeader className="border-b p-4">
          <SheetTitle>Pickup price automation</SheetTitle>
          <p className="text-sm text-muted-foreground">{hotelName} — settings apply to this hotel only.</p>
        </SheetHeader>
        {loading ? <div className="flex flex-1 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div> : (
          <div className="flex-1 min-h-0 space-y-4 overflow-y-auto p-4">
            {!hasSavedRule && (
              <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                Automation has never been set up for {hotelName}. It is <span className="font-semibold">off</span>. The numbers below are
                suggested starting values — nothing runs until you turn the switch on and save.
              </div>
            )}

            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="font-medium">Automation for {hotelName}</p>
                <p className="text-xs text-muted-foreground">
                  {rule.is_enabled ? "Checked automatically and allowed to change prices." : "Off — nothing changes automatically."}
                </p>
              </div>
              <Switch checked={rule.is_enabled} onCheckedChange={(is_enabled) => setRule({ ...rule, is_enabled })} />
            </div>

            <Accordion type="multiple" defaultValue={["schedule", "short"]} className="w-full">
              <AccordionItem value="schedule">
                <AccordionTrigger className="py-3 text-left">
                  <div>
                    <p className="text-sm font-medium">Schedule &amp; checks</p>
                    <p className="text-xs font-normal text-muted-foreground">
                      Every {rule.evaluation_interval_minutes} minutes
                      {savedEnabled && rule.next_run_at ? ` · next ${untilLabel(rule.next_run_at)}` : " · not scheduled"}
                    </p>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="space-y-3 pb-4">
                  <div>
                    <Label className="text-xs">How often this property is checked</Label>
                    <Select
                      value={String(rule.evaluation_interval_minutes)}
                      onValueChange={(value) => setRule({ ...rule, evaluation_interval_minutes: Number(value) })}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="60">Every hour</SelectItem>
                        <SelectItem value="120">Every 2 hours</SelectItem>
                        <SelectItem value="180">Every 3 hours</SelectItem>
                        <SelectItem value="360">Every 6 hours</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Each check refreshes bookings from the PMS first, then either raises dates that picked up or lowers dates that did not.
                    </p>
                  </div>
                  <div className="rounded-md border bg-muted/40 p-3">
                    <p className="text-xs font-medium">Next automatic check</p>
                    {savedEnabled && rule.next_run_at ? (
                      <>
                        <p className="text-sm font-semibold tabular-nums">
                          {new Date(rule.next_run_at).toLocaleString()}
                        </p>
                        <p className="text-[11px] text-muted-foreground">{untilLabel(rule.next_run_at)}</p>
                      </>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        {savedEnabled ? "Scheduling on the next cycle." : "Nothing is scheduled — automation is off."}
                      </p>
                    )}
                    {rule.last_run_at && (
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Last check {new Date(rule.last_run_at).toLocaleString()}.
                      </p>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <div><Label>Publish matched changes to Previo</Label><p className="text-xs text-muted-foreground">Off means changes are only suggested.</p></div>
                    <Switch checked={rule.auto_publish} onCheckedChange={(auto_publish) => setRule({ ...rule, auto_publish })} />
                  </div>
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
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="short">
                <AccordionTrigger className="py-3 text-left">
                  <div>
                    <p className="text-sm font-medium">Immediate booking window</p>
                    <p className="text-xs font-normal text-muted-foreground">
                      {rule.short_window_guard_enabled
                        ? `Next ${rule.short_window_days} days: only raise above ${rule.short_window_min_occupancy_pct}% full`
                        : "Last-minute guard off"}
                      {rule.sold_out_guard_enabled ? " · sold-out protected" : ""}
                      {rule.whole_number_prices ? " · whole prices" : ""}
                    </p>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="space-y-3 pb-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <Label>Short booking window guard</Label>
                      <p className="text-xs text-muted-foreground">
                        Close to arrival an empty date must not price itself out of the market just because one booking arrived.
                        Inside this window a rise needs the date to be selling well already.
                      </p>
                    </div>
                    <Switch
                      checked={rule.short_window_guard_enabled}
                      onCheckedChange={(short_window_guard_enabled) => setRule({ ...rule, short_window_guard_enabled })}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Protected window (days before arrival)</Label>
                      <Input type="number" min={0} max={90} disabled={!rule.short_window_guard_enabled}
                        value={rule.short_window_days}
                        onChange={(e) => setRule({ ...rule, short_window_days: Number(e.target.value) })} />
                      <p className="text-[11px] text-muted-foreground mt-1">Dates this close are treated as last-minute.</p>
                    </div>
                    <div>
                      <Label className="text-xs">Only raise above occupancy (%)</Label>
                      <Input type="number" min={0} max={100} disabled={!rule.short_window_guard_enabled}
                        value={rule.short_window_min_occupancy_pct}
                        onChange={(e) => setRule({ ...rule, short_window_min_occupancy_pct: Number(e.target.value) })} />
                      <p className="text-[11px] text-muted-foreground mt-1">Below this, the price is held — markdowns still work.</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <Label>Stop raising a sold-out date</Label>
                      <p className="text-xs text-muted-foreground">
                        Nothing left to sell means a higher price wins nothing. Markdowns are unaffected, and the date becomes
                        eligible again the moment occupancy drops.
                      </p>
                    </div>
                    <Switch
                      checked={rule.sold_out_guard_enabled}
                      onCheckedChange={(sold_out_guard_enabled) => setRule({ ...rule, sold_out_guard_enabled })}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Counts as sold out above (%)</Label>
                      <Input type="number" min={50} max={100} disabled={!rule.sold_out_guard_enabled}
                        value={rule.sold_out_occupancy_pct}
                        onChange={(e) => setRule({ ...rule, sold_out_occupancy_pct: Number(e.target.value) })} />
                      <p className="text-[11px] text-muted-foreground mt-1">100% means only a truly full date is protected.</p>
                    </div>
                    <div>
                      <Label className="text-xs">Wait before lowering (minutes)</Label>
                      <Input type="number" min={0} max={1440} step={15} disabled={!rule.cancellation_markdown_enabled}
                        value={rule.cancellation_wait_minutes}
                        onChange={(e) => setRule({ ...rule, cancellation_wait_minutes: Number(e.target.value) })} />
                      <p className="text-[11px] text-muted-foreground mt-1">0 lowers straight away on the next check.</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <Label>Wait after a cancellation</Label>
                      <p className="text-xs text-muted-foreground">
                        Give the room a chance to sell again before lowering the price — the cell history explains the wait and when it ends.
                      </p>
                    </div>
                    <Switch
                      checked={rule.cancellation_markdown_enabled}
                      onCheckedChange={(cancellation_markdown_enabled) => setRule({ ...rule, cancellation_markdown_enabled })}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <Label>Whole prices only</Label>
                      <p className="text-xs text-muted-foreground">Never send cents to Previo — markdowns round down, rises round up.</p>
                    </div>
                    <Switch
                      checked={rule.whole_number_prices}
                      onCheckedChange={(whole_number_prices) => setRule({ ...rule, whole_number_prices })}
                    />
                  </div>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="pickup">
                <AccordionTrigger className="py-3 text-left">
                  <div>
                    <p className="text-sm font-medium">When a booking arrives</p>
                    <p className="text-xs font-normal text-muted-foreground">
                      {rule.positive_pickup_enabled ? "Raises" : "Does not raise"} ·{" "}
                      {rule.application_scope === "all_room_types" ? "all room types" : "booked room type"} · max €{rule.max_daily_increase_per_date}/date/day
                    </p>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="space-y-3 pb-4">
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
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label className="text-xs">Same window (minutes)</Label><Input type="number" value={rule.same_hour_window_minutes} onChange={(e) => setRule({ ...rule, same_hour_window_minutes: Number(e.target.value) })} /></div>
                    <div><Label className="text-xs">Second pickup adds (€)</Label><Input type="number" value={rule.second_pickup_surcharge} onChange={(e) => setRule({ ...rule, second_pickup_surcharge: Number(e.target.value) })} /></div>
                  </div>
                  <div><Label className="text-xs">Maximum increase from one pickup (€)</Label><Input type="number" value={rule.maximum_increase ?? ""} onChange={(e) => setRule({ ...rule, maximum_increase: e.target.value ? Number(e.target.value) : null })} /></div>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="weak">
                <AccordionTrigger className="py-3 text-left">
                  <div>
                    <p className="text-sm font-medium">When demand is weak</p>
                    <p className="text-xs font-normal text-muted-foreground">
                      {rule.no_pickup_enabled
                        ? `−${rule.currency} ${money(rule.no_pickup_decrease)} per check · cap ${rule.currency} ${money(rule.max_daily_decrease_per_date)}/day`
                        : "Markdowns off"}
                    </p>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="space-y-3 pb-4">
                  <div className="flex items-center justify-between gap-3">
                    <div><p className="text-sm font-medium">Lower quiet dates</p><p className="text-xs text-muted-foreground">Dates that picked up nothing since the last check. Never a date that just picked up.</p></div>
                    <Switch checked={rule.no_pickup_enabled} onCheckedChange={(no_pickup_enabled) => setRule({ ...rule, no_pickup_enabled })} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label className="text-xs">Manage future dates (days)</Label><Input type="number" min={1} max={730} value={rule.future_booking_window_days} onChange={(e) => setRule({ ...rule, future_booking_window_days: Number(e.target.value) })} /><p className="text-[11px] text-muted-foreground mt-1">How far ahead automation is allowed to look.</p></div>
                    <div><Label className="text-xs">Decrease per check ({rule.currency})</Label><Input type="number" step={0.01} min={0.01} max={50} value={rule.no_pickup_decrease} onChange={(e) => setRule({ ...rule, no_pickup_decrease: Number(e.target.value) })} /><p className="text-[11px] text-muted-foreground mt-1">One step per date per check, however many room types it has.</p></div>
                    <div><Label className="text-xs">Daily decrease cap per date ({rule.currency})</Label><Input type="number" step={0.01} min={0.01} value={rule.max_daily_decrease_per_date} onChange={(e) => setRule({ ...rule, max_daily_decrease_per_date: Number(e.target.value) })} /><p className="text-[11px] text-muted-foreground mt-1">The most one date can fall in a single day.</p></div>
                    <div><Label className="text-xs">Leave manual changes alone (hours)</Label><Input type="number" min={0} max={72} value={rule.manual_markdown_hold_hours} onChange={(e) => setRule({ ...rule, manual_markdown_hold_hours: Number(e.target.value) })} /><p className="text-[11px] text-muted-foreground mt-1">After someone edits a price by hand, automation waits.</p></div>
                  </div>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="smart">
                <AccordionTrigger className="py-3 text-left">
                  <div>
                    <p className="text-sm font-medium">Smart pricing</p>
                    <p className="text-xs font-normal text-muted-foreground">
                      {rule.smart_pricing_enabled
                        ? `Near ${rule.near_term_days}d under ${rule.low_occupancy_pct}% · strong after ${rule.long_lead_days}d over ${rule.high_occupancy_pct}%${rule.ai_assist_enabled ? " · AI review on" : ""}`
                        : "Off"}
                    </p>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="space-y-3 pb-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <Label>Use occupancy and lead time</Label>
                      <p className="text-xs text-muted-foreground">Not only the last hour's bookings.</p>
                    </div>
                    <Switch checked={rule.smart_pricing_enabled} onCheckedChange={(smart_pricing_enabled) => setRule({ ...rule, smart_pricing_enabled })} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label className="text-xs">Near-term window (days)</Label><Input type="number" min={1} max={365} disabled={!rule.smart_pricing_enabled} value={rule.near_term_days} onChange={(e) => setRule({ ...rule, near_term_days: Number(e.target.value) })} /><p className="text-[11px] text-muted-foreground mt-1">Dates this close are the ones worth stimulating.</p></div>
                    <div><Label className="text-xs">Weak occupancy below (%)</Label><Input type="number" min={1} max={100} disabled={!rule.smart_pricing_enabled} value={rule.low_occupancy_pct} onChange={(e) => setRule({ ...rule, low_occupancy_pct: Number(e.target.value) })} /><p className="text-[11px] text-muted-foreground mt-1">Only dates below this are marked down.</p></div>
                    <div><Label className="text-xs">Strong demand starts after (days)</Label><Input type="number" min={1} max={365} disabled={!rule.smart_pricing_enabled} value={rule.long_lead_days} onChange={(e) => setRule({ ...rule, long_lead_days: Number(e.target.value) })} /><p className="text-[11px] text-muted-foreground mt-1">Early demand counts from this lead time onwards.</p></div>
                    <div><Label className="text-xs">Strong occupancy above (%)</Label><Input type="number" min={1} max={100} disabled={!rule.smart_pricing_enabled} value={rule.high_occupancy_pct} onChange={(e) => setRule({ ...rule, high_occupancy_pct: Number(e.target.value) })} /><p className="text-[11px] text-muted-foreground mt-1">A far date this full is treated as strong demand.</p></div>
                    <div><Label className="text-xs">Strong demand increase ({rule.currency})</Label><Input type="number" step={0.01} min={0} disabled={!rule.smart_pricing_enabled} value={rule.strong_demand_increase} onChange={(e) => setRule({ ...rule, strong_demand_increase: Number(e.target.value) })} /><p className="text-[11px] text-muted-foreground mt-1">0 means never raise on strength alone.</p></div>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <div><Label>AI-assisted pricing</Label><p className="text-xs text-muted-foreground">Asks your own OpenAI account to review each check. It can soften or cancel a move, never make one bigger.</p></div>
                    <Switch checked={rule.ai_assist_enabled} disabled={!rule.smart_pricing_enabled} onCheckedChange={(ai_assist_enabled) => setRule({ ...rule, ai_assist_enabled })} />
                  </div>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="safety">
                <AccordionTrigger className="py-3 text-left">
                  <div>
                    <p className="text-sm font-medium">Safety limits</p>
                    <p className="text-xs font-normal text-muted-foreground">
                      Min ADR {rule.minimum_adr ?? "—"} · protect above {rule.markdown_max_occupancy_pct}% · {rule.currency}
                    </p>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="space-y-3 pb-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label className="text-xs">Minimum ADR (€)</Label><Input type="number" value={rule.minimum_adr ?? ""} onChange={(e) => setRule({ ...rule, minimum_adr: e.target.value ? Number(e.target.value) : null })} /></div>
                    <div><Label className="text-xs">Max rise per date, per day (€)</Label><Input type="number" value={rule.max_daily_increase_per_date} onChange={(e) => setRule({ ...rule, max_daily_increase_per_date: Number(e.target.value) })} /></div>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <div><Label>Protect nearly full dates</Label><p className="text-xs text-muted-foreground">Never mark down a sold-out date or one above the occupancy below.</p></div>
                    <Switch checked={rule.protect_high_occupancy} onCheckedChange={(protect_high_occupancy) => setRule({ ...rule, protect_high_occupancy })} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label className="text-xs">Protect above occupancy (%)</Label><Input type="number" min={1} max={100} disabled={!rule.protect_high_occupancy} value={rule.markdown_max_occupancy_pct} onChange={(e) => setRule({ ...rule, markdown_max_occupancy_pct: Number(e.target.value) })} /></div>
                    <div><Label className="text-xs">Currency</Label><Input value={rule.currency} maxLength={3} onChange={(e) => setRule({ ...rule, currency: e.target.value.toUpperCase() })} /></div>
                  </div>
                  <div><Label className="text-xs">Property timezone</Label><Input value={rule.run_timezone} onChange={(e) => setRule({ ...rule, run_timezone: e.target.value })} /></div>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="plain">
                <AccordionTrigger className="py-3 text-left">
                  <div>
                    <p className="text-sm font-medium">What this rule does, in plain words</p>
                    <p className="text-xs font-normal text-muted-foreground">
                      Recent: {stats.pushed} pushed · {stats.failed} failed
                    </p>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pb-4">
                  <ul className="space-y-1.5 text-xs text-muted-foreground">
                    {explain(rule, hotelName).map((line, index) => (
                      <li key={index} className="flex gap-2"><span>•</span><span>{line}</span></li>
                    ))}
                  </ul>
                  {rule.last_run_at && (
                    <p className="pt-2 text-[11px] text-muted-foreground">
                      Last checked {new Date(rule.last_run_at).toLocaleString()}.
                    </p>
                  )}
                  <p className="text-[11px] text-muted-foreground">
                    Recent actions: {stats.pushed} pushed · {stats.failed} failed
                    {stats.lastActionAt ? ` · last change ${new Date(stats.lastActionAt).toLocaleString()}` : ""}
                  </p>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>
        )}
        <div className="flex flex-wrap gap-2 border-t bg-background p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
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
                    { label: runResult.autoPublish ? "Queued safely" : "Suggested", value: runResult.autoPublish ? runResult.queued : runResult.actions },
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
