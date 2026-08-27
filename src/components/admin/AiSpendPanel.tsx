import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Gauge } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface Settings {
  organization_slug: string;
  daily_budget_usd: number;
  monthly_budget_usd: number;
  competitor_scan_enabled: boolean;
  event_sweep_enabled: boolean;
}

interface Usage {
  function_name: string;
  estimated_cost_usd: number;
  created_at: string;
}

/** Shows what the app spends on AI and lets an admin cap it. */
export default function AiSpendPanel() {
  const [org, setOrg] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [usage, setUsage] = useState<Usage[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) { setLoading(false); return; }
      const { data: profile } = await supabase
        .from("profiles").select("organization_slug").eq("id", auth.user.id).maybeSingle();
      const slug = (profile?.organization_slug as string | null) ?? null;
      setOrg(slug);

      const monthStart = new Date();
      monthStart.setUTCDate(1);
      monthStart.setUTCHours(0, 0, 0, 0);

      const [{ data: s }, { data: u }] = await Promise.all([
        slug
          ? supabase.from("ai_budget_settings").select("*").eq("organization_slug", slug).maybeSingle()
          : Promise.resolve({ data: null }),
        supabase.from("ai_usage_log")
          .select("function_name, estimated_cost_usd, created_at")
          .gte("created_at", monthStart.toISOString())
          .order("created_at", { ascending: false })
          .limit(2000),
      ]);

      setSettings(
        (s as Settings | null) ?? {
          organization_slug: slug ?? "",
          daily_budget_usd: 5,
          monthly_budget_usd: 100,
          competitor_scan_enabled: true,
          event_sweep_enabled: true,
        },
      );
      setUsage((u ?? []) as Usage[]);
      setLoading(false);
    })();
  }, []);

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const spendToday = usage
    .filter((r) => new Date(r.created_at) >= todayStart)
    .reduce((s, r) => s + Number(r.estimated_cost_usd || 0), 0);
  const spendMonth = usage.reduce((s, r) => s + Number(r.estimated_cost_usd || 0), 0);

  const byFeature = Object.entries(
    usage.reduce<Record<string, number>>((acc, r) => {
      acc[r.function_name] = (acc[r.function_name] ?? 0) + Number(r.estimated_cost_usd || 0);
      return acc;
    }, {}),
  ).sort((a, b) => b[1] - a[1]);

  const save = async () => {
    if (!settings || !org) return;
    setSaving(true);
    const { error } = await supabase.from("ai_budget_settings").upsert({
      organization_slug: org,
      daily_budget_usd: settings.daily_budget_usd,
      monthly_budget_usd: settings.monthly_budget_usd,
      competitor_scan_enabled: settings.competitor_scan_enabled,
      event_sweep_enabled: settings.event_sweep_enabled,
      updated_at: new Date().toISOString(),
    });
    setSaving(false);
    if (error) toast.error(error.message);
    else toast.success("AI budget saved");
  };

  const overDaily = settings ? spendToday >= Number(settings.daily_budget_usd) : false;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Gauge className="h-4 w-4 text-primary" /> AI spend &amp; budget
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {loading || !settings ? (
          <p className="text-muted-foreground">Loading AI spend…</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Spent today" value={`$${spendToday.toFixed(2)}`} warn={overDaily} />
              <Stat label="Spent this month" value={`$${spendMonth.toFixed(2)}`} />
            </div>

            {overDaily && (
              <Badge variant="destructive" className="font-normal">
                Daily cap reached — scheduled AI work is paused until tomorrow
              </Badge>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="daily">Daily cap (USD)</Label>
                <Input
                  id="daily" type="number" min={0} step="0.5"
                  value={settings.daily_budget_usd}
                  onChange={(e) => setSettings({ ...settings, daily_budget_usd: Number(e.target.value) })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="monthly">Monthly cap (USD)</Label>
                <Input
                  id="monthly" type="number" min={0} step="5"
                  value={settings.monthly_budget_usd}
                  onChange={(e) => setSettings({ ...settings, monthly_budget_usd: Number(e.target.value) })}
                />
              </div>
            </div>

            <ToggleRow
              label="Weekly competitor price scan"
              hint="Reads competitor prices with web search. The biggest single cost."
              checked={settings.competitor_scan_enabled}
              onChange={(v) => setSettings({ ...settings, competitor_scan_enabled: v })}
            />
            <ToggleRow
              label="Weekly event sweep"
              hint="Looks for demand-driving events, three months per run."
              checked={settings.event_sweep_enabled}
              onChange={(v) => setSettings({ ...settings, event_sweep_enabled: v })}
            />

            {byFeature.length > 0 && (
              <div className="space-y-1 pt-1">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">This month by feature</p>
                {byFeature.map(([name, cost]) => (
                  <div key={name} className="flex items-center justify-between border-b py-1 last:border-b-0">
                    <span>{name}</span>
                    <span className="font-medium">${cost.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            )}

            <Button onClick={save} disabled={saving || !org} size="sm">
              {saving ? "Saving…" : "Save budget"}
            </Button>
            <p className="text-[11px] text-muted-foreground">
              Costs are estimates from token and web-search prices, not an invoice. Scheduled AI work stops
              once a cap is reached; on-demand buttons still work until the cap is hit.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`text-lg font-semibold ${warn ? "text-destructive" : ""}`}>{value}</p>
    </div>
  );
}

function ToggleRow({
  label, hint, checked, onChange,
}: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border p-3">
      <div>
        <p className="font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
