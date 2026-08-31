import { useEffect, useState, type ReactNode } from "react";
import {
  Bot, Loader2, HelpCircle, Clock, TrendingUp, TrendingDown,
  ShieldCheck, CalendarRange, FileText, Users,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
import {
  DEFAULT_PICKUP_LADDER, bandLabel, normaliseLadder, type PickupLadderBand,
} from "@/lib/revenue/reasonSettings";

interface Props { hotelId: string | null; organizationSlug: string | null; }
interface Tier { max_days: number | null; increase: number; }
interface Rule {
  id?: string; name: string; is_enabled: boolean; auto_publish: boolean;
  booking_window_tiers: Tier[]; same_hour_window_minutes: number;
  second_pickup_surcharge: number; minimum_adr: number | null;
  maximum_increase: number | null; max_daily_increase_per_date: number;
  max_increase_pct: number; max_daily_increase_pct: number;
  event_uplift_once_per_day: boolean; market_ceiling_multiple: number;
  manual_override_ai_enabled: boolean; manual_override_review_hours: number;

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
  fill_mode_enabled: boolean;
  fill_window_days: number;
  fill_max_total_drop_pct: number;
  pickup_increase_ladder: PickupLadderBand[];
  raise_on_any_pickup: boolean;


  cancellation_markdown_enabled: boolean;
  cancellation_wait_minutes: number;
  immediate_sell_mode_enabled: boolean;
  immediate_window_days: number;
  immediate_markdown_step: number;
  final_window_enabled: boolean;
  final_window_days: number;
  final_window_allow_event_increase: boolean;
  final_window_abnormal_pickup_rooms: number;
  spike_detection_enabled: boolean;
  spike_threshold_pct: number;
  spike_lookback_days: number;
  event_surcharge_eur: number;
  event_surcharge_auto: boolean;
  lead_bands_enabled: boolean;
  far_out_days: number;
  far_out_enabled: boolean;
  far_out_surcharge: number;
  far_out_notify: boolean;
  far_out_floor_topup_enabled: boolean;
  far_out_floor_topup_days: number;
  far_out_floor_topup_threshold: number;
  far_out_floor_topup_amount: number;

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
  max_increase_pct: 5, max_daily_increase_pct: 6,
  event_uplift_once_per_day: true, market_ceiling_multiple: 1.4,
  manual_override_ai_enabled: true, manual_override_review_hours: 24,

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
  fill_mode_enabled: false, fill_window_days: 60, fill_max_total_drop_pct: 15,
  pickup_increase_ladder: DEFAULT_PICKUP_LADDER.map((b) => ({ ...b })), raise_on_any_pickup: true,

  cancellation_markdown_enabled: true, cancellation_wait_minutes: 60,
  immediate_sell_mode_enabled: true, immediate_window_days: 14, immediate_markdown_step: 2,
  final_window_enabled: true, final_window_days: 7, final_window_allow_event_increase: false,
  final_window_abnormal_pickup_rooms: 5,
  spike_detection_enabled: true, spike_threshold_pct: 5, spike_lookback_days: 7,
  event_surcharge_eur: 10, event_surcharge_auto: false,
  lead_bands_enabled: true, far_out_days: 90, far_out_enabled: true,
  far_out_surcharge: 35, far_out_notify: true,
  far_out_floor_topup_enabled: true, far_out_floor_topup_days: 90,
  far_out_floor_topup_threshold: 100, far_out_floor_topup_amount: 22,

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
  if (rule.max_daily_increase_pct > 0) {
    lines.push(`No price may finish a day more than ${rule.max_daily_increase_pct}% above where it started, and a single move is capped at ${rule.max_increase_pct}%.`);
  }
  if (rule.event_uplift_once_per_day) {
    lines.push(`An event lifts a date once per day; any further rise on that date needs a genuinely new booking.`);
  }

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
  engine?: string; mode?: string; runId?: string; datesEvaluated?: number;
  increases?: number; decreases?: number; held?: number; cellsSimulated?: number;
  timedOut?: boolean;
}

/** A tap-friendly "what does this mean?" hint — works on mobile, unlike hover tooltips. */
function Hint({ children }: { children: ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="What does this setting do?"
          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <HelpCircle className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-72 text-xs leading-relaxed">
        {children}
      </PopoverContent>
    </Popover>
  );
}

/** One collapsible group of settings, presented as a card with an icon and a live summary. */
function Section({
  value, icon: Icon, title, summary, children,
}: {
  value: string;
  icon: typeof Clock;
  title: string;
  summary: string;
  children: ReactNode;
}) {
  return (
    <AccordionItem value={value} className="rounded-xl border bg-card px-3 shadow-sm">
      <AccordionTrigger className="py-3 text-left hover:no-underline">
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium">{title}</p>
            <p className="truncate text-xs font-normal text-muted-foreground">{summary}</p>
          </div>
        </div>
      </AccordionTrigger>
      <AccordionContent className="space-y-3 pb-4">{children}</AccordionContent>
    </AccordionItem>
  );
}

function ToggleRow({
  title, hint, desc, checked, disabled, onChange,
}: {
  title: string;
  hint?: ReactNode;
  desc?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border bg-muted/30 p-3">
      <div className="min-w-0">
        <div className="flex items-center gap-1">
          <Label className="text-sm">{title}</Label>
          {hint && <Hint>{hint}</Hint>}
        </div>
        {desc && <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>}
      </div>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}

function NumField({
  label, hint, suffix, note, ...input
}: {
  label: string;
  hint?: ReactNode;
  suffix?: string;
  note?: string;
} & React.ComponentProps<typeof Input>) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1">
        <Label className="text-xs">{label}</Label>
        {hint && <Hint>{hint}</Hint>}
      </div>
      <div className="relative">
        <Input type="number" className={suffix ? "pr-12" : undefined} {...input} />
        {suffix && (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
            {suffix}
          </span>
        )}
      </div>
      {note && <p className="text-[11px] text-muted-foreground">{note}</p>}
    </div>
  );
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
  // Minimum price difference between one guest count and the next inside the
  // same room type. Stored per property, used by every publishing path.
  const [guestStep, setGuestStep] = useState<number>(10);

  useEffect(() => {
    if (!hotelId) return;
    setLoading(true);
    void (async () => {
      const [ruleRes, nameRes, othersRes, actionsRes, settingsRes] = await Promise.all([
        supabase.from("revenue_pickup_automation_rules").select("*").eq("hotel_id", hotelId).eq("name", "Pickup pricing").maybeSingle(),
        supabase.from("hotel_configurations").select("hotel_id, hotel_name"),
        supabase.from("revenue_pickup_automation_rules").select("*").neq("hotel_id", hotelId),
        supabase.from("revenue_pickup_automation_actions")
          .select("status, created_at").eq("hotel_id", hotelId)
          .order("created_at", { ascending: false }).limit(500),
        supabase.from("hotel_revenue_settings").select("extra_guest_supplement_eur").eq("hotel_id", hotelId).maybeSingle(),
      ]);

      const storedStep = Number((settingsRes.data as { extra_guest_supplement_eur?: number } | null)?.extra_guest_supplement_eur);
      setGuestStep(Number.isFinite(storedStep) && storedStep >= 0 ? Math.round(storedStep) : 10);

      const names = new Map<string, string>();
      for (const row of (nameRes.data ?? []) as any[]) names.set(row.hotel_id, row.hotel_name);
      setHotelName(names.get(hotelId) ?? hotelId);

      if (ruleRes.data) {
        {
          const loaded = ruleRes.data as unknown as Rule;
          setRule({
            ...loaded,
            pickup_increase_ladder: normaliseLadder((loaded as any).pickup_increase_ladder),
            raise_on_any_pickup: (loaded as any).raise_on_any_pickup !== false,
          });
        }
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
      max_increase_pct: source.rule.max_increase_pct ?? 5,
      max_daily_increase_pct: source.rule.max_daily_increase_pct ?? 6,
      event_uplift_once_per_day: source.rule.event_uplift_once_per_day ?? true,
      market_ceiling_multiple: source.rule.market_ceiling_multiple ?? 1.4,
      manual_override_ai_enabled: source.rule.manual_override_ai_enabled ?? true,
      manual_override_review_hours: source.rule.manual_override_review_hours ?? 24,

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
      fill_mode_enabled: source.rule.fill_mode_enabled ?? false,
      fill_window_days: source.rule.fill_window_days ?? 60,
      fill_max_total_drop_pct: source.rule.fill_max_total_drop_pct ?? 15,
      pickup_increase_ladder: normaliseLadder(source.rule.pickup_increase_ladder),
      raise_on_any_pickup: source.rule.raise_on_any_pickup !== false,

      cancellation_markdown_enabled: source.rule.cancellation_markdown_enabled ?? true,
      cancellation_wait_minutes: source.rule.cancellation_wait_minutes ?? 60,
      immediate_sell_mode_enabled: source.rule.immediate_sell_mode_enabled ?? true,
      immediate_window_days: source.rule.immediate_window_days ?? 14,
      immediate_markdown_step: source.rule.immediate_markdown_step ?? 2,
      final_window_enabled: source.rule.final_window_enabled ?? true,
      final_window_days: source.rule.final_window_days ?? 7,
      final_window_allow_event_increase: source.rule.final_window_allow_event_increase ?? false,
      final_window_abnormal_pickup_rooms: source.rule.final_window_abnormal_pickup_rooms ?? 5,
      spike_detection_enabled: source.rule.spike_detection_enabled ?? true,
      spike_threshold_pct: source.rule.spike_threshold_pct ?? 5,
      spike_lookback_days: source.rule.spike_lookback_days ?? 7,
      event_surcharge_eur: source.rule.event_surcharge_eur ?? 10,
      event_surcharge_auto: source.rule.event_surcharge_auto ?? false,
      lead_bands_enabled: source.rule.lead_bands_enabled ?? true,
      far_out_days: source.rule.far_out_days ?? 90,
      far_out_enabled: source.rule.far_out_enabled ?? true,
      far_out_surcharge: source.rule.far_out_surcharge ?? 35,
      far_out_notify: source.rule.far_out_notify ?? true,
      far_out_floor_topup_enabled: source.rule.far_out_floor_topup_enabled ?? true,
      far_out_floor_topup_days: source.rule.far_out_floor_topup_days ?? 90,
      far_out_floor_topup_threshold: source.rule.far_out_floor_topup_threshold ?? 100,
      far_out_floor_topup_amount: source.rule.far_out_floor_topup_amount ?? 22,

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
      max_increase_pct: rule.max_increase_pct,
      max_daily_increase_pct: rule.max_daily_increase_pct,
      event_uplift_once_per_day: rule.event_uplift_once_per_day,
      market_ceiling_multiple: rule.market_ceiling_multiple,
      manual_override_ai_enabled: rule.manual_override_ai_enabled,
      manual_override_review_hours: rule.manual_override_review_hours,

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
      fill_mode_enabled: rule.fill_mode_enabled,
      fill_window_days: rule.fill_window_days,
      fill_max_total_drop_pct: rule.fill_max_total_drop_pct,
      pickup_increase_ladder: rule.pickup_increase_ladder,
      raise_on_any_pickup: rule.raise_on_any_pickup,

      cancellation_markdown_enabled: rule.cancellation_markdown_enabled,
      cancellation_wait_minutes: rule.cancellation_wait_minutes,
      immediate_sell_mode_enabled: rule.immediate_sell_mode_enabled,
      immediate_window_days: rule.immediate_window_days,
      immediate_markdown_step: rule.immediate_markdown_step,
      final_window_enabled: rule.final_window_enabled,
      final_window_days: rule.final_window_days,
      final_window_allow_event_increase: rule.final_window_allow_event_increase,
      final_window_abnormal_pickup_rooms: rule.final_window_abnormal_pickup_rooms,
      spike_detection_enabled: rule.spike_detection_enabled,
      spike_threshold_pct: rule.spike_threshold_pct,
      spike_lookback_days: rule.spike_lookback_days,
      event_surcharge_eur: rule.event_surcharge_eur,
      event_surcharge_auto: rule.event_surcharge_auto,
      lead_bands_enabled: rule.lead_bands_enabled,
      far_out_days: rule.far_out_days,
      far_out_enabled: rule.far_out_enabled,
      far_out_surcharge: rule.far_out_surcharge,
      far_out_notify: rule.far_out_notify,
      far_out_floor_topup_enabled: rule.far_out_floor_topup_enabled,
      far_out_floor_topup_days: rule.far_out_floor_topup_days,
      far_out_floor_topup_threshold: rule.far_out_floor_topup_threshold,
      far_out_floor_topup_amount: rule.far_out_floor_topup_amount,

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
    // The occupancy step lives with the property, not with the rule version, so
    // every publishing path (manual, bulk, automation) reads the same number.
    const { error: stepError } = await supabase.from("hotel_revenue_settings")
      .upsert({ hotel_id: hotelId, extra_guest_supplement_eur: Math.max(0, Math.round(guestStep)) } as any, { onConflict: "hotel_id" });
    if (stepError) toast.error(errorMessage(stepError, "Could not save the occupancy price step"));
    setSaving(false);
    if (error) { toast.error(errorMessage(error, "Could not save these settings")); return; }
    {
      const saved = data as unknown as Rule;
      setRule({
        ...saved,
        pickup_increase_ladder: normaliseLadder((saved as any).pickup_increase_ladder),
        raise_on_any_pickup: (saved as any).raise_on_any_pickup !== false,
      });
    }
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
      if (summary.engine === "v2") {
        const actions = Number(summary.increases ?? 0) + Number(summary.decreases ?? 0);
        setRunResult({
          hotelName,
          actor: (auth.user?.user_metadata?.full_name as string) || payload.actor || auth.user?.email || "You",
          pickups: Number(summary.increases ?? 0),
          actions,
          queued: Number(summary.cells_queued ?? 0),
          pushed: 0,
          failed: summary.timed_out || summary.paused ? 1 : 0,
          autoPublish: summary.mode === "live",
          pushError: summary.paused ? "Unsafe simulated prices were blocked and automation returned to shadow mode." : null,
          changed: [],
          engine: "v2",
          mode: summary.mode,
          runId: summary.run_id,
          datesEvaluated: Number(summary.dates_evaluated ?? 0),
          increases: Number(summary.increases ?? 0),
          decreases: Number(summary.decreases ?? 0),
          held: Number(summary.held ?? 0),
          cellsSimulated: Number(summary.cells_simulated ?? 0),
          timedOut: Boolean(summary.timed_out),
        });
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

  const cur = rule.currency;

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
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="border-b p-4 text-left">
          <SheetTitle className="flex items-center gap-2 text-base">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Bot className="h-4 w-4" />
            </span>
            Price automation
          </SheetTitle>
          <p className="text-sm text-muted-foreground">
            {hotelName} — these settings apply to this property only.
          </p>
        </SheetHeader>

        {loading ? <div className="flex flex-1 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div> : (
          <div className="flex-1 min-h-0 overflow-y-auto">
            {/* Master switch and the three numbers that answer "is it working?" */}
            <div className="space-y-3 border-b bg-muted/30 p-4">
              <div className="flex items-start justify-between gap-3 rounded-xl border bg-card p-3 shadow-sm">
                <div className="min-w-0">
                  <p className="font-semibold">
                    {rule.is_enabled ? `Automation is on for ${hotelName}` : `Automation is off for ${hotelName}`}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {rule.is_enabled
                      ? "Prices are checked on a schedule and may change automatically."
                      : "Nothing changes automatically. Turn this on and save to start."}
                  </p>
                </div>
                <Switch checked={rule.is_enabled} onCheckedChange={(is_enabled) => setRule({ ...rule, is_enabled })} />
              </div>

              {!hasSavedRule && (
                <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                  Automation has never been set up here. The values below are safe starting suggestions — nothing runs
                  until you turn the switch on and save.
                </p>
              )}

              <div className="grid grid-cols-3 gap-2">
                {[
                  {
                    label: "Next check",
                    value: savedEnabled && rule.next_run_at
                      ? new Date(rule.next_run_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                      : "—",
                  },
                  { label: "Runs every", value: `${rule.evaluation_interval_minutes} min` },
                  { label: "Recent changes", value: `${stats.pushed} sent` },
                ].map((tile) => (
                  <div key={tile.label} className="rounded-lg border bg-card p-2 text-center">
                    <p className="text-sm font-semibold tabular-nums">{tile.value}</p>
                    <p className="text-[10px] leading-tight text-muted-foreground">{tile.label}</p>
                  </div>
                ))}
              </div>
            </div>

            <Accordion type="multiple" defaultValue={["schedule"]} className="w-full space-y-2 p-3">
              {/* 1 — Schedule & publishing */}
              <Section
                value="schedule"
                icon={Clock}
                title="Schedule & publishing"
                summary={`Every ${rule.evaluation_interval_minutes} min · ${rule.auto_publish ? "published to Previo" : "suggestions only"}`}
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-1">
                    <Label className="text-xs">How often this property is checked</Label>
                    <Hint>
                      Each check first refreshes bookings from Previo, then raises dates that picked up and lowers dates
                      that did not. <strong>Example:</strong> every hour means up to 24 small moves a day per date, always
                      inside your daily caps.
                    </Hint>
                  </div>
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
                </div>

                <div className="rounded-lg border bg-muted/40 p-3">
                  <p className="text-xs font-medium">Next automatic check</p>
                  {savedEnabled && rule.next_run_at ? (
                    <>
                      <p className="text-sm font-semibold tabular-nums">{new Date(rule.next_run_at).toLocaleString()}</p>
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

                <ToggleRow
                  title="Publish changes to Previo"
                  desc={rule.auto_publish ? "Matched changes go live automatically." : "Changes are only suggested — you publish them."}
                  hint={<>Off is the safe way to trial automation: you see every proposed price in the calendar and send it yourself.</>}
                  checked={rule.auto_publish}
                  onChange={(auto_publish) => setRule({ ...rule, auto_publish })}
                />

                {otherRules.length > 0 && (
                  <div className="space-y-1">
                    <div className="flex items-center gap-1">
                      <Label className="text-xs">Copy settings from another property</Label>
                      <Hint>Copies every number and guard, but never the on/off switch — turning a property on is always deliberate.</Hint>
                    </div>
                    <Select onValueChange={copyFrom}>
                      <SelectTrigger><SelectValue placeholder="Choose a property…" /></SelectTrigger>
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
              </Section>

              {/* 2 — Raising prices */}
              <Section
                value="raise"
                icon={TrendingUp}
                title="Raising prices"
                summary={
                  rule.positive_pickup_enabled
                    ? `+${cur} ${rule.booking_window_tiers[0]?.increase ?? 0}–${rule.booking_window_tiers[rule.booking_window_tiers.length - 1]?.increase ?? 0} per booking · max ${cur} ${rule.max_daily_increase_per_date}/date/day`
                    : "Off — bookings never raise a price"
                }
              >
                <ToggleRow
                  title="Raise a date when a booking arrives"
                  desc="The core pickup rule."
                  hint={<><strong>Example:</strong> a booking lands for 14 September, that date is 40 days out, so the 2–3 month step is added to 14 September only.</>}
                  checked={rule.positive_pickup_enabled}
                  onChange={(positive_pickup_enabled) => setRule({ ...rule, positive_pickup_enabled })}
                />

                <div className="grid grid-cols-2 gap-3">
                  <NumField
                    label="New-booking lookback"
                    suffix="h"
                    min={1} max={168}
                    hint={<>How far back each check looks for new bookings. 48 hours catches reservations that reached the PMS late. <strong>Example:</strong> a booking made yesterday evening still counts this morning.</>}
                    value={rule.pickup_lookback_hours}
                    onChange={(e) => setRule({ ...rule, pickup_lookback_hours: Number(e.target.value) })}
                  />
                  <div className="space-y-1">
                    <div className="flex items-center gap-1">
                      <Label className="text-xs">Apply the rise to</Label>
                      <Hint>“Only the booked room type” is the careful option. “All room types” moves the whole date up together.</Hint>
                    </div>
                    <Select
                      value={rule.application_scope}
                      onValueChange={(value: "booked_room_type" | "all_room_types") => setRule({ ...rule, application_scope: value })}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="booked_room_type">Only the booked room type</SelectItem>
                        <SelectItem value="all_room_types">All room types that date</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="rounded-lg border p-3">
                  <div className="mb-2 flex items-center gap-1">
                    <p className="text-sm font-medium">How much one booking adds</p>
                    <Hint>Bookings far in the future are worth more: the date still has months to sell, so it can carry a bigger step.</Hint>
                  </div>
                  <div className="space-y-2">
                    {rule.booking_window_tiers.map((tier, index) => (
                      <div key={index} className="grid grid-cols-[1fr_120px] items-center gap-3">
                        <Label className="text-xs">
                          {tier.max_days === null ? "More than 3 months away" : index === 0 ? "Within 1 month" : "2–3 months away"}
                        </Label>
                        <div className="relative">
                          <Input
                            type="number"
                            className="pr-12"
                            value={tier.increase}
                            onChange={(e) => updateTier(index, Number(e.target.value))}
                          />
                          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{cur}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <NumField
                    label="Burst window"
                    suffix="min"
                    hint={<>Two bookings for the same date inside this window means demand is spiking. <strong>Example:</strong> 60 minutes — two bookings for 3 May within the hour.</>}
                    value={rule.same_hour_window_minutes}
                    onChange={(e) => setRule({ ...rule, same_hour_window_minutes: Number(e.target.value) })}
                  />
                  <NumField
                    label="Second booking adds"
                    suffix={cur}
                    hint={<>The bigger step used instead of the normal one when a second booking lands inside the burst window.</>}
                    value={rule.second_pickup_surcharge}
                    onChange={(e) => setRule({ ...rule, second_pickup_surcharge: Number(e.target.value) })}
                  />
                </div>

                <NumField
                  label="Most one booking may add"
                  suffix={cur}
                  hint={<>A hard ceiling on a single move, whichever rule triggered it.</>}
                  value={rule.maximum_increase ?? ""}
                  onChange={(e) => setRule({ ...rule, maximum_increase: e.target.value ? Number(e.target.value) : null })}
                />

                <ToggleRow
                  title="Detect demand spikes"
                  desc="A far date filling faster than usual is raised before it sells out too cheaply."
                  hint={<><strong>Example:</strong> a date gains {rule.spike_threshold_pct}% occupancy compared with {rule.spike_lookback_days} days ago — that is treated as a spike.</>}
                  checked={rule.spike_detection_enabled}
                  onChange={(spike_detection_enabled) => setRule({ ...rule, spike_detection_enabled })}
                />
                <div className="grid grid-cols-2 gap-3">
                  <NumField
                    label="Spike threshold" suffix="%" min={1} max={50}
                    disabled={!rule.spike_detection_enabled}
                    value={rule.spike_threshold_pct}
                    onChange={(e) => setRule({ ...rule, spike_threshold_pct: Number(e.target.value) })}
                  />
                  <NumField
                    label="Compared with" suffix="days" min={1} max={30}
                    disabled={!rule.spike_detection_enabled}
                    value={rule.spike_lookback_days}
                    onChange={(e) => setRule({ ...rule, spike_lookback_days: Number(e.target.value) })}
                  />
                </div>

                <ToggleRow
                  title="Charge more on event dates"
                  desc="Uses the approved events calendar — high impact gets the full surcharge, medium half."
                  hint={<><strong>Example:</strong> a concert weekend marked high impact adds {cur} {rule.event_surcharge_eur} on top, still inside the daily rise limit.</>}
                  checked={rule.event_surcharge_auto}
                  onChange={(event_surcharge_auto) => setRule({ ...rule, event_surcharge_auto })}
                />
                <NumField
                  label="Event surcharge" suffix={cur} step={0.5} min={0}
                  disabled={!rule.event_surcharge_auto}
                  value={rule.event_surcharge_eur}
                  onChange={(e) => setRule({ ...rule, event_surcharge_eur: Number(e.target.value) })}
                />
                <ToggleRow
                  title="One event uplift per date per day"
                  desc="The same event may lift a date once a day; a further rise needs a new booking."
                  hint={<>Without this the same concert adds its surcharge on every hourly run, which is how a date can climb hundreds of {cur} in a day with no extra demand.</>}
                  checked={rule.event_uplift_once_per_day}
                  onChange={(event_uplift_once_per_day) => setRule({ ...rule, event_uplift_once_per_day })}
                />
                <ToggleRow
                  title="Ask AI before undoing a manual drop"
                  desc="After your hold expires, a price you lowered by hand is only raised again if the advisor agrees."
                  hint={<>Reviewed for {rule.manual_override_review_hours} hours after your edit. If the advisor is unavailable, your price stands.</>}
                  checked={rule.manual_override_ai_enabled}
                  onChange={(manual_override_ai_enabled) => setRule({ ...rule, manual_override_ai_enabled })}
                />
                <NumField
                  label="Review a manual drop for" suffix="h" min={0} max={168}
                  disabled={!rule.manual_override_ai_enabled}
                  value={rule.manual_override_review_hours}
                  onChange={(e) => setRule({ ...rule, manual_override_review_hours: Number(e.target.value) })}
                />

              </Section>

              {/* 3 — Lowering prices */}
              <Section
                value="lower"
                icon={TrendingDown}
                title="Lowering prices"
                summary={
                  rule.no_pickup_enabled
                    ? `−${cur} ${money(rule.no_pickup_decrease)} per quiet check · cap ${cur} ${money(rule.max_daily_decrease_per_date)}/day`
                    : "Off — prices never drop automatically"
                }
              >
                <ToggleRow
                  title="Lower dates that are not selling"
                  desc="Only dates that picked up nothing since the previous check."
                  hint={<><strong>Example:</strong> 12 October got no booking in the last hour, so it loses {cur} {money(rule.no_pickup_decrease)} — one step per date, however many room types it has.</>}
                  checked={rule.no_pickup_enabled}
                  onChange={(no_pickup_enabled) => setRule({ ...rule, no_pickup_enabled })}
                />
                <div className="grid grid-cols-2 gap-3">
                  <NumField
                    label="Drop per check" suffix={cur}
                    step={cur === "EUR" ? 0.01 : 1} min={0.01}
                    disabled={!rule.no_pickup_enabled}
                    hint={<>Keep it small — this can run many times a day.{cur !== "EUR" ? ` In ${cur} use realistic steps (1000–3000), not 1–3.` : ""}</>}
                    value={rule.no_pickup_decrease}
                    onChange={(e) => setRule({ ...rule, no_pickup_decrease: Number(e.target.value) })}
                  />
                  <NumField
                    label="Most a date may fall in a day" suffix={cur}
                    step={0.01} min={0.01}
                    disabled={!rule.no_pickup_enabled}
                    hint={<>The safety brake on markdowns: no date can lose more than this in 24 hours.</>}
                    value={rule.max_daily_decrease_per_date}
                    onChange={(e) => setRule({ ...rule, max_daily_decrease_per_date: Number(e.target.value) })}
                  />
                  <NumField
                    label="Manage dates up to" suffix="days"
                    min={1} max={730}
                    hint={<>How far ahead automation is allowed to look. 365 covers a full year of the calendar.</>}
                    value={rule.future_booking_window_days}
                    onChange={(e) => setRule({ ...rule, future_booking_window_days: Number(e.target.value) })}
                  />
                  <NumField
                    label="Leave manual edits alone" suffix="h"
                    min={0} max={72}
                    hint={<>After someone types a price by hand, automation stays off that date for this long.</>}
                    value={rule.manual_markdown_hold_hours}
                    onChange={(e) => setRule({ ...rule, manual_markdown_hold_hours: Number(e.target.value) })}
                  />
                </div>

                <ToggleRow
                  title="Sell the next days fast"
                  desc="Very close to arrival, a quiet date is lowered even if occupancy still looks acceptable."
                  hint={<><strong>Example:</strong> inside {rule.immediate_window_days} days an empty room tonight earns nothing, so the price steps down by {cur} {rule.immediate_markdown_step}.</>}
                  checked={rule.immediate_sell_mode_enabled}
                  onChange={(immediate_sell_mode_enabled) => setRule({ ...rule, immediate_sell_mode_enabled })}
                />
                <div className="grid grid-cols-2 gap-3">
                  <NumField
                    label="Sell-now window" suffix="days" min={1} max={60}
                    disabled={!rule.immediate_sell_mode_enabled}
                    value={rule.immediate_window_days}
                    onChange={(e) => setRule({ ...rule, immediate_window_days: Number(e.target.value) })}
                  />
                  <NumField
                    label="Step inside the window" suffix={cur} step={0.5} min={0}
                    disabled={!rule.immediate_sell_mode_enabled}
                    value={rule.immediate_markdown_step}
                    onChange={(e) => setRule({ ...rule, immediate_markdown_step: Number(e.target.value) })}
                  />
                </div>

                <ToggleRow
                  title="Final selling window"
                  desc="Inside the cancellation window the price only ever goes down until the last rooms are sold."
                  hint={<><strong>Example:</strong> with a {rule.final_window_days}-day cancellation policy, dates inside {rule.final_window_days} days never rise — even on an event date — unless at least {rule.final_window_abnormal_pickup_rooms} rooms sold in the window.</>}
                  checked={rule.final_window_enabled}
                  onChange={(final_window_enabled) => setRule({ ...rule, final_window_enabled })}
                />
                <div className="grid grid-cols-2 gap-3">
                  <NumField
                    label="Final window" suffix="days" min={1} max={30}
                    disabled={!rule.final_window_enabled}
                    value={rule.final_window_days}
                    onChange={(e) => setRule({ ...rule, final_window_days: Number(e.target.value) })}
                  />
                  <NumField
                    label="Abnormal pickup allows a rise" suffix="rooms" min={0} max={50}
                    disabled={!rule.final_window_enabled}
                    value={rule.final_window_abnormal_pickup_rooms}
                    onChange={(e) => setRule({ ...rule, final_window_abnormal_pickup_rooms: Number(e.target.value) })}
                  />
                </div>
                <ToggleRow
                  title="Let a big event lift the last days"
                  desc="Off by default: even a high-impact event keeps selling down inside the final window."
                  hint={<>Turn this on only when your event dates reliably sell out at the last minute.</>}
                  checked={rule.final_window_allow_event_increase}
                  onChange={(final_window_allow_event_increase) => setRule({ ...rule, final_window_allow_event_increase })}
                />



                <ToggleRow
                  title="Wait after a cancellation"
                  desc="Give the room a chance to sell again before lowering the price."
                  hint={<>The cell history explains the wait and when it ends. 0 minutes lowers on the very next check.</>}
                  checked={rule.cancellation_markdown_enabled}
                  onChange={(cancellation_markdown_enabled) => setRule({ ...rule, cancellation_markdown_enabled })}
                />
                <NumField
                  label="Wait before lowering" suffix="min" min={0} max={1440} step={15}
                  disabled={!rule.cancellation_markdown_enabled}
                  value={rule.cancellation_wait_minutes}
                  onChange={(e) => setRule({ ...rule, cancellation_wait_minutes: Number(e.target.value) })}
                />
              </Section>

              {/* 4 — Guardrails */}
              <Section
                value="guards"
                icon={ShieldCheck}
                title="Guardrails & limits"
                summary={`Never below ${cur} ${rule.minimum_adr ?? "—"} · max +${cur} ${rule.max_daily_increase_per_date}/date/day${rule.whole_number_prices ? " · whole prices" : ""}`}
              >
                <div className="grid grid-cols-2 gap-3">
                  <NumField
                    label="Never price below" suffix={cur}
                    hint={<>Your floor. No automatic move may publish a price under this, whatever the demand.</>}
                    value={rule.minimum_adr ?? ""}
                    onChange={(e) => setRule({ ...rule, minimum_adr: e.target.value ? Number(e.target.value) : null })}
                  />
                  <NumField
                    label="Most a date may rise in a day" suffix={cur}
                    hint={<><strong>Example:</strong> five bookings arrive for one date — the date still rises by at most this much that day.</>}
                    value={rule.max_daily_increase_per_date}
                    onChange={(e) => setRule({ ...rule, max_daily_increase_per_date: Number(e.target.value) })}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <NumField
                    label="Most one move may add" suffix="%" min={0} max={50} step={0.5}
                    hint={<>A share of the price being changed. The tighter of this and the {cur} ceiling wins, so expensive rooms cannot jump.</>}
                    value={rule.max_increase_pct}
                    onChange={(e) => setRule({ ...rule, max_increase_pct: Number(e.target.value) })}
                  />
                  <NumField
                    label="Most a price may rise in a day" suffix="%" min={0} max={100} step={0.5}
                    hint={<><strong>Example:</strong> at 6% a {cur} 500 room can never finish the day above {cur} 530, however many signals fire.</>}
                    value={rule.max_daily_increase_pct}
                    onChange={(e) => setRule({ ...rule, max_daily_increase_pct: Number(e.target.value) })}
                  />
                </div>

                <NumField
                  label="Warn when above market by" suffix="×" min={1} max={4} step={0.05}
                  hint={<>Compared with the median of your watched competitors for that night. Above this the price history is flagged — the move is still made.</>}
                  value={rule.market_ceiling_multiple}
                  onChange={(e) => setRule({ ...rule, market_ceiling_multiple: Number(e.target.value) })}
                />



                <ToggleRow
                  title="Last-minute guard"
                  desc={`Inside ${rule.short_window_days} days a rise needs the date to be selling well already.`}
                  hint={<>Close to arrival an empty date must not price itself out of the market just because one booking arrived. Markdowns still work.</>}
                  checked={rule.short_window_guard_enabled}
                  onChange={(short_window_guard_enabled) => setRule({ ...rule, short_window_guard_enabled })}
                />
                <div className="grid grid-cols-2 gap-3">
                  <NumField
                    label="Protected window" suffix="days" min={0} max={90}
                    disabled={!rule.short_window_guard_enabled}
                    value={rule.short_window_days}
                    onChange={(e) => setRule({ ...rule, short_window_days: Number(e.target.value) })}
                  />
                  <NumField
                    label="Only raise above" suffix="%" min={0} max={100}
                    disabled={!rule.short_window_guard_enabled}
                    value={rule.short_window_min_occupancy_pct}
                    onChange={(e) => setRule({ ...rule, short_window_min_occupancy_pct: Number(e.target.value) })}
                  />
                </div>

                <ToggleRow
                  title="Stop raising a sold-out date"
                  desc="Nothing left to sell means a higher price wins nothing."
                  hint={<>The date becomes eligible again the moment occupancy drops after a cancellation.</>}
                  checked={rule.sold_out_guard_enabled}
                  onChange={(sold_out_guard_enabled) => setRule({ ...rule, sold_out_guard_enabled })}
                />
                <ToggleRow
                  title="Protect nearly full dates"
                  desc="Never mark down a date above the occupancy below."
                  hint={<><strong>Example:</strong> a date at {rule.markdown_max_occupancy_pct}% is close to selling out — dropping its price gives money away.</>}
                  checked={rule.protect_high_occupancy}
                  onChange={(protect_high_occupancy) => setRule({ ...rule, protect_high_occupancy })}
                />
                <div className="grid grid-cols-2 gap-3">
                  <NumField
                    label="Counts as sold out above" suffix="%" min={50} max={100}
                    disabled={!rule.sold_out_guard_enabled}
                    value={rule.sold_out_occupancy_pct}
                    onChange={(e) => setRule({ ...rule, sold_out_occupancy_pct: Number(e.target.value) })}
                  />
                  <NumField
                    label="Protect above occupancy" suffix="%" min={1} max={100}
                    disabled={!rule.protect_high_occupancy}
                    value={rule.markdown_max_occupancy_pct}
                    onChange={(e) => setRule({ ...rule, markdown_max_occupancy_pct: Number(e.target.value) })}
                  />
                </div>

                <ToggleRow
                  title="Fill mode (push occupancy near arrival)"
                  desc="Inside the window below, act sooner on a shortfall to sell the last rooms."
                  hint={<>New bookings still lift the price straight away. A date can never fall further than the total drop limit below the price it started this campaign at, so the average rate is protected.</>}
                  checked={rule.fill_mode_enabled}
                  onChange={(fill_mode_enabled) => setRule({ ...rule, fill_mode_enabled })}
                />
                <div className="grid grid-cols-2 gap-3">
                  <NumField
                    label="Fill window" suffix="days" min={0} max={365}
                    disabled={!rule.fill_mode_enabled}
                    value={rule.fill_window_days}
                    onChange={(e) => setRule({ ...rule, fill_window_days: Number(e.target.value) })}
                  />
                  <NumField
                    label="Most a price may drop in total" suffix="%" min={0} max={50}
                    disabled={!rule.fill_mode_enabled}
                    value={rule.fill_max_total_drop_pct}
                    onChange={(e) => setRule({ ...rule, fill_max_total_drop_pct: Number(e.target.value) })}
                  />
                </div>




                <div className="space-y-2 rounded-lg border p-3">
                  <div className="flex items-center gap-1">
                    <Label className="text-xs font-semibold">Pickup surcharge ladder</Label>
                    <Hint>How much a genuine new booking lifts a date. The further out the stay date, the bigger the lift — there is more time left to sell the rest of the rooms higher.</Hint>
                  </div>
                  <div className="space-y-2">
                    {rule.pickup_increase_ladder.map((band, index) => (
                      <div key={`${band.min_days_out}-${index}`} className="grid grid-cols-5 items-end gap-2">
                        <div className="text-[11px] text-muted-foreground pb-2">{bandLabel(band)}</div>
                        {(["one", "two", "three_plus", "max_per_day"] as const).map((key) => (
                          <NumField
                            key={key}
                            label={key === "one" ? "1 booking" : key === "two" ? "2 bookings" : key === "three_plus" ? "3+" : "Max/day"}
                            suffix={rule.currency}
                            min={0}
                            max={500}
                            value={band[key]}
                            onChange={(e) => setRule({
                              ...rule,
                              pickup_increase_ladder: rule.pickup_increase_ladder.map((row, i) =>
                                i === index ? { ...row, [key]: Math.max(0, Number(e.target.value) || 0) } : row),
                            })}
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                </div>

                <ToggleRow
                  title="Any new booking raises the price"
                  desc="A single genuine reservation always lifts the date — occupancy only decides how much."
                  checked={rule.raise_on_any_pickup}
                  onChange={(raise_on_any_pickup) => setRule({ ...rule, raise_on_any_pickup })}
                />

                <ToggleRow
                  title="Whole prices only"
                  desc="Never send cents to Previo — rises round up, markdowns round down."
                  checked={rule.whole_number_prices}
                  onChange={(whole_number_prices) => setRule({ ...rule, whole_number_prices })}
                />

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-1">
                      <Label className="text-xs">Currency</Label>
                      <Hint>The currency this property publishes in — three letters, e.g. EUR or HUF.</Hint>
                    </div>
                    <Input value={rule.currency} maxLength={3} onChange={(e) => setRule({ ...rule, currency: e.target.value.toUpperCase() })} />
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-1">
                      <Label className="text-xs">Property timezone</Label>
                      <Hint>Used for daily caps and run times, e.g. Europe/Budapest.</Hint>
                    </div>
                    <Input value={rule.run_timezone} onChange={(e) => setRule({ ...rule, run_timezone: e.target.value })} />
                  </div>
                </div>
              </Section>

              {/* 5 — Lead time */}
              <Section
                value="leadbands"
                icon={CalendarRange}
                title="Lead time & far-out dates"
                summary={
                  rule.lead_bands_enabled
                    ? `Sell 0–${rule.immediate_window_days}d · react to ${rule.near_term_days}d · protect to ${rule.far_out_days}d · lift beyond`
                    : "One flat rule across the whole calendar"
                }
              >
                <ToggleRow
                  title="Price by how far away the stay date is"
                  desc="Close to arrival the price is a selling tool; further out it is protected."
                  hint={<>Without this, one flat rule walks distant dates down hour after hour even though they have months left to sell.</>}
                  checked={rule.lead_bands_enabled}
                  onChange={(lead_bands_enabled) => setRule({ ...rule, lead_bands_enabled })}
                />

                <div className="space-y-1.5 rounded-lg border bg-muted/40 p-3 text-xs">
                  <p><span className="font-medium">0–{rule.immediate_window_days} days</span> — sell: quiet dates take the full sell-now step down.</p>
                  <p><span className="font-medium">{rule.immediate_window_days + 1}–{rule.near_term_days} days</span> — react: bookings raise the price, a quiet check takes off {cur} {money(rule.no_pickup_decrease)}.</p>
                  <p><span className="font-medium">{rule.near_term_days + 1}–{rule.far_out_days} days</span> — protect: rises on pickup, only a small step down when demand is clearly weak.</p>
                  <p><span className="font-medium">Beyond {rule.far_out_days} days</span> — lift: any booking earns the far-out surcharge, markdowns stay token-sized.</p>
                </div>

                <ToggleRow
                  title="Lift the price on far-out bookings"
                  desc="Someone booking months ahead is planning, not bargain hunting."
                  hint={<><strong>Example:</strong> a booking {rule.far_out_days + 30} days out adds {cur} {rule.far_out_surcharge} to that date.</>}
                  checked={rule.far_out_enabled}
                  onChange={(far_out_enabled) => setRule({ ...rule, far_out_enabled })}
                />
                <div className="grid grid-cols-2 gap-3">
                  <NumField
                    label="Far-out starts at" suffix="days" min={30} max={365}
                    disabled={!rule.far_out_enabled}
                    value={rule.far_out_days}
                    onChange={(e) => setRule({ ...rule, far_out_days: Number(e.target.value) })}
                  />
                  <NumField
                    label="Surcharge per booking" suffix={cur} min={0} max={cur === "EUR" ? 200 : 200000}
                    disabled={!rule.far_out_enabled}
                    value={rule.far_out_surcharge}
                    onChange={(e) => setRule({ ...rule, far_out_surcharge: Number(e.target.value) })}
                  />
                </div>
                <ToggleRow
                  title="Notify the team about far-out bookings"
                  desc="A notification names the date, how far out it is and how much the price was lifted."
                  checked={rule.far_out_notify}
                  disabled={!rule.far_out_enabled}
                  onChange={(far_out_notify) => setRule({ ...rule, far_out_notify })}
                />

                <ToggleRow
                  title="Top up cheap far-out prices"
                  desc="A distant date still sitting at a low price is lifted on every check."
                  hint={<><strong>Example:</strong> {rule.far_out_floor_topup_days} days out and still at or below {cur} {rule.far_out_floor_topup_threshold} — add {cur} {rule.far_out_floor_topup_amount}.</>}
                  checked={rule.far_out_floor_topup_enabled}
                  onChange={(far_out_floor_topup_enabled) => setRule({ ...rule, far_out_floor_topup_enabled })}
                />
                <div className="grid grid-cols-3 gap-2">
                  <NumField
                    label="From" suffix="d" min={0} max={400}
                    disabled={!rule.far_out_floor_topup_enabled}
                    value={rule.far_out_floor_topup_days}
                    onChange={(e) => setRule({ ...rule, far_out_floor_topup_days: Number(e.target.value) })}
                  />
                  <NumField
                    label="At or below" suffix={cur} min={0}
                    disabled={!rule.far_out_floor_topup_enabled}
                    value={rule.far_out_floor_topup_threshold}
                    onChange={(e) => setRule({ ...rule, far_out_floor_topup_threshold: Number(e.target.value) })}
                  />
                  <NumField
                    label="Top up by" suffix={cur} min={0}
                    disabled={!rule.far_out_floor_topup_enabled}
                    value={rule.far_out_floor_topup_amount}
                    onChange={(e) => setRule({ ...rule, far_out_floor_topup_amount: Number(e.target.value) })}
                  />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Every lift still respects the daily rise limit, the maximum single change and the sold-out guard.
                </p>
              </Section>

              {/* Occupancy spacing */}
              <Section
                value="occupancy"
                icon={Users}
                title="Price per extra guest"
                summary={guestStep > 0
                  ? `Each extra guest costs at least ${cur} ${guestStep} more`
                  : "No minimum difference between guest counts"}
              >
                <p className="text-xs text-muted-foreground">
                  Inside one room type, two guests must never pay the same as three. Every price
                  we publish — manual, bulk or automatic — is spaced by at least this amount, and a
                  daily sweep lifts any level that came back flat from the PMS.
                </p>
                <NumField
                  label="Minimum difference per extra guest"
                  suffix={cur}
                  min={0}
                  max={cur === "EUR" ? 100 : 100000}
                  value={guestStep}
                  onChange={(e) => setGuestStep(Number(e.target.value))}
                  hint={<><strong>Example:</strong> with {cur} {guestStep || 10}, a {cur} 240 two-guest price makes three guests {cur} {240 + (guestStep || 10)} and four guests {cur} {240 + 2 * (guestStep || 10)}.</>}
                  note="Typical is 10–20. Repairs only ever move a price up, never down."
                />
              </Section>

              {/* 6 — Smart pricing */}
              <Section
                value="smart"
                icon={Bot}
                title="Smart pricing (advanced)"
                summary={
                  rule.smart_pricing_enabled
                    ? `Near ${rule.near_term_days}d under ${rule.low_occupancy_pct}% · strong after ${rule.long_lead_days}d over ${rule.high_occupancy_pct}%${rule.ai_assist_enabled ? " · AI review on" : ""}`
                    : "Off — only the rules above apply"
                }
              >
                <ToggleRow
                  title="Use occupancy and lead time, not only bookings"
                  desc="Adds a view of how full a date already is."
                  hint={<><strong>Example:</strong> a date 20 days out at 35% occupancy is stimulated, while the same date at 80% is left alone.</>}
                  checked={rule.smart_pricing_enabled}
                  onChange={(smart_pricing_enabled) => setRule({ ...rule, smart_pricing_enabled })}
                />
                <div className="grid grid-cols-2 gap-3">
                  <NumField
                    label="Near-term window" suffix="days" min={1} max={365}
                    disabled={!rule.smart_pricing_enabled}
                    hint={<>Dates this close are the ones worth stimulating.</>}
                    value={rule.near_term_days}
                    onChange={(e) => setRule({ ...rule, near_term_days: Number(e.target.value) })}
                  />
                  <NumField
                    label="Weak occupancy below" suffix="%" min={1} max={100}
                    disabled={!rule.smart_pricing_enabled}
                    hint={<>Only dates below this are marked down.</>}
                    value={rule.low_occupancy_pct}
                    onChange={(e) => setRule({ ...rule, low_occupancy_pct: Number(e.target.value) })}
                  />
                  <NumField
                    label="Strong demand starts after" suffix="days" min={1} max={365}
                    disabled={!rule.smart_pricing_enabled}
                    value={rule.long_lead_days}
                    onChange={(e) => setRule({ ...rule, long_lead_days: Number(e.target.value) })}
                  />
                  <NumField
                    label="Strong occupancy above" suffix="%" min={1} max={100}
                    disabled={!rule.smart_pricing_enabled}
                    value={rule.high_occupancy_pct}
                    onChange={(e) => setRule({ ...rule, high_occupancy_pct: Number(e.target.value) })}
                  />
                  <NumField
                    label="Strong demand increase" suffix={cur} step={0.01} min={0}
                    disabled={!rule.smart_pricing_enabled}
                    hint={<>0 means never raise on strength alone.</>}
                    value={rule.strong_demand_increase}
                    onChange={(e) => setRule({ ...rule, strong_demand_increase: Number(e.target.value) })}
                  />
                </div>
                <ToggleRow
                  title="AI-assisted review"
                  desc="Reviews each check and may soften or cancel a move — never make one bigger."
                  hint={<>Uses your own OpenAI account. If it is unavailable, the ordinary rules simply continue.</>}
                  checked={rule.ai_assist_enabled}
                  disabled={!rule.smart_pricing_enabled}
                  onChange={(ai_assist_enabled) => setRule({ ...rule, ai_assist_enabled })}
                />
              </Section>

              {/* 7 — Plain words */}
              <Section
                value="plain"
                icon={FileText}
                title="What this rule does, in plain words"
                summary={`${stats.pushed} sent · ${stats.failed} failed recently`}
              >
                <ul className="space-y-1.5 text-xs text-muted-foreground">
                  {explain(rule, hotelName).map((line, index) => (
                    <li key={index} className="flex gap-2"><span>•</span><span>{line}</span></li>
                  ))}
                </ul>
                {rule.last_run_at && (
                  <p className="text-[11px] text-muted-foreground">
                    Last checked {new Date(rule.last_run_at).toLocaleString()}.
                  </p>
                )}
                <p className="text-[11px] text-muted-foreground">
                  Recent actions: {stats.pushed} pushed · {stats.failed} failed
                  {stats.lastActionAt ? ` · last change ${new Date(stats.lastActionAt).toLocaleString()}` : ""}
                </p>
              </Section>
            </Accordion>
          </div>
        )}

        <div className="flex flex-wrap gap-2 border-t bg-background p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <Button className="flex-1" onClick={requestSave} disabled={saving || loading}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save settings
          </Button>
          <Button variant="outline" disabled={running || loading} onClick={() => void runNow()}>
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
                {runResult.engine === "v2" && (
                  <div className="rounded-md border bg-muted/40 p-3 text-sm">
                    <p className="font-medium">
                      {runResult.mode === "shadow"
                        ? "Shadow test only — no prices were sent to Previo."
                        : runResult.timedOut
                          ? "The run reached its time limit; completed decisions remain recorded."
                          : "Live automation run completed."}
                    </p>
                    {runResult.runId && <p className="mt-1 text-[11px] text-muted-foreground">Run {runResult.runId}</p>}
                  </div>
                )}
                <div className="grid grid-cols-4 gap-2 text-center">
                  {(runResult.engine === "v2" ? [
                    { label: "Dates checked", value: runResult.datesEvaluated ?? 0 },
                    { label: "Increased", value: runResult.increases ?? 0 },
                    { label: "Decreased", value: runResult.decreases ?? 0 },
                    { label: runResult.mode === "shadow" ? "Cells simulated" : "Cells queued", value: runResult.mode === "shadow" ? runResult.cellsSimulated ?? 0 : runResult.queued },
                  ] : [
                    { label: "Pickups checked", value: runResult.pickups },
                    { label: "Cells matched", value: runResult.actions },
                    { label: runResult.autoPublish ? "Queued safely" : "Suggested", value: runResult.autoPublish ? runResult.queued : runResult.actions },
                    { label: "Failed", value: runResult.failed },
                  ]).map((item) => (
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
