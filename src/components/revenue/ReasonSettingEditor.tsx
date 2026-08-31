import { useCallback, useEffect, useState } from "react";
import { Loader2, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { errorMessage } from "@/lib/errorMessage";
import {
  bandFor,
  bandLabel,
  daysOutFrom,
  normaliseLadder,
  reasonInfo,
  type PickupLadderBand,
} from "@/lib/revenue/reasonSettings";

interface Props {
  hotelId: string;
  hotelName: string;
  /** Machine reason recorded by the engine for this stay date. */
  reason: string | null | undefined;
  /** The stay date the manager is looking at — picks the pickup ladder band. */
  stayDate?: string | null;
  currency?: string | null;
  /** Compact trigger for use inside a dense table row. */
  compact?: boolean;
  onSaved?: () => void;
}

type RuleRow = Record<string, any>;

const unitSuffix: Record<string, string> = {
  hours: "hours",
  minutes: "minutes",
  percent: "%",
  days: "days",
};

/**
 * "Why did this happen, and change it" — the manager reads the reason behind a
 * price decision and edits exactly the automation settings that produced it,
 * without hunting through the full rules screen.
 */
export function ReasonSettingEditor({ hotelId, hotelName, reason, stayDate, currency, compact, onSaved }: Props) {
  const info = reasonInfo(reason);
  const [open, setOpen] = useState(false);
  const [rule, setRule] = useState<RuleRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Record<string, any>>({});
  const [band, setBand] = useState<PickupLadderBand | null>(null);

  const daysOut = stayDate ? daysOutFrom(stayDate) : 0;

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("revenue_pickup_automation_rules")
      .select("*")
      .eq("hotel_id", hotelId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setLoading(false);
    if (error) { toast.error(errorMessage(error, "Could not load the automation settings")); return; }
    if (!data) { toast.error(`No automation rule is saved for ${hotelName} yet`); return; }
    const row = data as RuleRow;
    setRule(row);
    const next: Record<string, any> = {};
    for (const setting of info.settings) {
      if (setting.kind === "ladder") {
        const ladder = normaliseLadder(row.pickup_increase_ladder);
        setBand({ ...bandFor(daysOut, ladder) });
      } else {
        next[setting.field] = row[setting.field];
      }
    }
    setDraft(next);
  }, [hotelId, hotelName, info.settings, daysOut]);

  useEffect(() => { if (open && !rule) void load(); }, [open, rule, load]);

  if (info.settings.length === 0) return null;

  async function save(runAfter: boolean) {
    if (!rule) return;
    setSaving(true);
    const { data: auth } = await supabase.auth.getUser();
    const patch: Record<string, any> = {
      ...draft,
      version: Number(rule.version ?? 1) + 1,
      updated_by: auth.user?.id ?? null,
      updated_at: new Date().toISOString(),
    };
    if (band) {
      const ladder = normaliseLadder(rule.pickup_increase_ladder).map((row) =>
        row.min_days_out === band.min_days_out ? { ...row, ...band } : row,
      );
      patch.pickup_increase_ladder = ladder;
    }
    const { error } = await supabase
      .from("revenue_pickup_automation_rules")
      .update(patch as any)
      .eq("id", rule.id);
    if (error) { setSaving(false); toast.error(errorMessage(error, "Could not save this change")); return; }

    if (runAfter) {
      const { error: runError } = await supabase.functions.invoke("revenue-pickup-automation", { body: { hotelId } });
      if (runError) toast.error("Saved, but the run could not be started right now");
      else toast.success(`Saved — a new pricing run started for ${hotelName}`);
    } else {
      toast.success(`Saved for ${hotelName} — it applies from the next run`);
    }
    setSaving(false);
    setRule({ ...rule, ...patch });
    setOpen(false);
    onSaved?.();
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant={compact ? "ghost" : "secondary"}
          size="sm"
          className={compact ? "h-6 gap-1 px-1.5 text-[11px]" : "gap-1.5"}
        >
          <SlidersHorizontal className="h-3 w-3" />
          Adjust this rule
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[320px] space-y-3">
        <div>
          <p className="text-sm font-semibold">{info.title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{info.explain}</p>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading settings…
          </div>
        ) : !rule ? (
          <p className="text-xs text-muted-foreground">No automation rule to edit.</p>
        ) : (
          <div className="space-y-3">
            {info.settings.map((setting) => {
              if (setting.kind === "ladder") {
                if (!band) return null;
                return (
                  <div key={setting.field} className="space-y-2 rounded-md border p-2">
                    <div>
                      <p className="text-xs font-medium">{setting.label}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {stayDate ? `${stayDate} is ${daysOut} days out — ${bandLabel(band)}.` : bandLabel(band)}
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {([
                        ["one", "1 booking"],
                        ["two", "2 bookings"],
                        ["three_plus", "3+ bookings"],
                        ["max_per_day", "Max per day"],
                      ] as const).map(([key, label]) => (
                        <div key={key} className="space-y-1">
                          <Label className="text-[11px]">{label}</Label>
                          <div className="flex items-center gap-1">
                            <Input
                              type="number"
                              className="h-8"
                              value={String(band[key] ?? 0)}
                              onChange={(e) => setBand({ ...band, [key]: Math.max(0, Number(e.target.value) || 0) })}
                            />
                            <span className="text-[11px] text-muted-foreground">{currency ?? "EUR"}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              }
              if (setting.kind === "boolean") {
                return (
                  <div key={setting.field} className="flex items-start justify-between gap-3 rounded-md border p-2">
                    <div>
                      <p className="text-xs font-medium">{setting.label}</p>
                      <p className="text-[11px] text-muted-foreground">{setting.help}</p>
                    </div>
                    <Switch
                      checked={Boolean(draft[setting.field])}
                      onCheckedChange={(v) => setDraft((d) => ({ ...d, [setting.field]: v }))}
                    />
                  </div>
                );
              }
              return (
                <div key={setting.field} className="space-y-1 rounded-md border p-2">
                  <Label className="text-xs font-medium">{setting.label}</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      className="h-8"
                      value={String(draft[setting.field] ?? "")}
                      onChange={(e) => setDraft((d) => ({
                        ...d,
                        [setting.field]: Math.min(setting.max, Math.max(setting.min, Number(e.target.value) || 0)),
                      }))}
                    />
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {setting.unit === "money" ? (currency ?? "EUR") : unitSuffix[setting.unit ?? ""] ?? ""}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">{setting.help}</p>
                </div>
              );
            })}

            {info.note && <p className="text-[11px] text-muted-foreground">{info.note}</p>}

            <div className="flex items-center justify-end gap-2 pt-1">
              <Button size="sm" variant="ghost" disabled={saving} onClick={() => setOpen(false)}>Cancel</Button>
              <Button size="sm" variant="secondary" disabled={saving} onClick={() => void save(false)}>Save</Button>
              <Button size="sm" disabled={saving} onClick={() => void save(true)}>
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save & run"}
              </Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
