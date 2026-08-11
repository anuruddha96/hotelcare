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

interface Props { hotelId: string | null; organizationSlug: string | null; }
interface Tier { max_days: number | null; increase: number; }
interface Rule {
  id?: string; name: string; is_enabled: boolean; auto_publish: boolean;
  booking_window_tiers: Tier[]; same_hour_window_minutes: number;
  second_pickup_surcharge: number; minimum_adr: number | null;
  max_daily_increase_per_date: number; last_run_at?: string | null; version: number;
}

/** Starting suggestions only — a hotel is never automated until it is saved with the switch on. */
const DEFAULT_RULE: Rule = {
  name: "Pickup pricing", is_enabled: false, auto_publish: true,
  booking_window_tiers: [{ max_days: 31, increase: 8 }, { max_days: 93, increase: 18 }, { max_days: null, increase: 22 }],
  same_hour_window_minutes: 60, second_pickup_surcharge: 25, minimum_adr: 120,
  max_daily_increase_per_date: 40, version: 1,
};

/** Turns the saved numbers into sentences a non-technical owner can check. */
function explain(rule: Rule, hotelName: string): string[] {
  if (!rule.is_enabled) {
    return [`Automation is off for ${hotelName}. Nothing will change automatically here — the numbers below are only a starting point until you turn it on and save.`];
  }
  const tiers = rule.booking_window_tiers ?? [];
  const lines: string[] = [];
  lines.push(
    `When a new booking arrives for a stay date at ${hotelName}, every room type and guest count on that one date goes up. No other dates and no other hotels are touched.`,
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
    `If a third booking lands for the same date inside ${rule.same_hour_window_minutes} minutes, that date gets €${rule.second_pickup_surcharge} instead — demand is spiking.`,
  );
  if (rule.minimum_adr) lines.push(`Prices are never published below €${rule.minimum_adr}.`);
  lines.push(`A single date can rise at most €${rule.max_daily_increase_per_date} in one day, no matter how many bookings arrive.`);
  lines.push(
    rule.auto_publish
      ? "Matched changes are sent to Previo automatically and appear in the calendar with an automation marker."
      : "Matched changes are only suggested — you publish them yourself from the calendar.",
  );
  return lines;
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

  useEffect(() => {
    if (!hotelId) return;
    setLoading(true);
    void (async () => {
      const [ruleRes, nameRes, othersRes] = await Promise.all([
        supabase.from("revenue_pickup_automation_rules").select("*").eq("hotel_id", hotelId).eq("name", "Pickup pricing").maybeSingle(),
        supabase.from("hotel_configurations").select("hotel_id, hotel_name"),
        supabase.from("revenue_pickup_automation_rules").select("*").neq("hotel_id", hotelId),
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
      max_daily_increase_per_date: source.rule.max_daily_increase_per_date,
      auto_publish: source.rule.auto_publish,
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
      max_daily_increase_per_date: rule.max_daily_increase_per_date,
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
                <p className="font-medium">Run on new pickups</p>
                <p className="text-xs text-muted-foreground">Only pickup dates at {hotelName} are changed.</p>
              </div>
              <Switch checked={rule.is_enabled} onCheckedChange={(is_enabled) => setRule({ ...rule, is_enabled })} />
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
              <div className="flex items-center justify-between"><Label>Publish matched changes to Previo</Label><Switch checked={rule.auto_publish} onCheckedChange={(auto_publish) => setRule({ ...rule, auto_publish })} /></div>
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
                  Last checked {new Date(rule.last_run_at).toLocaleString()} · runs every 15 minutes.
                </p>
              )}
            </div>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button onClick={requestSave} disabled={saving || loading}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save automation rule</Button>
          <Button
            variant="outline"
            disabled={running || !savedEnabled}
            onClick={async () => {
              setRunning(true);
              const { data, error } = await supabase.functions.invoke("revenue-pickup-automation", { body: { hotelId } });
              setRunning(false);
              if (error) { toast.error("Could not run the automation now"); return; }
              const summary = (data as any)?.summary?.[0];
              toast.success(
                summary
                  ? `Checked ${summary.pickups ?? 0} new booking night(s) · ${summary.actions ?? 0} price change(s)`
                  : "Automation ran — no new bookings to price",
              );
            }}
          >
            {running && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Run now
          </Button>
        </div>

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
