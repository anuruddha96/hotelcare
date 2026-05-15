import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Check, Sparkles, TrendingDown, TrendingUp, X, Zap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Rec {
  id: string;
  stay_date: string;
  current_rate_eur: number | null;
  recommended_rate_eur: number;
  delta_eur: number;
  reason: string | null;
  status: string;
}

interface Decision {
  stay_date: string;
  decision_type: string;
  reason: string | null;
}

interface Settings {
  floor_price_eur: number;
  max_daily_change_eur: number;
  weekday_decrease_eur: number;
  weekend_decrease_eur: number;
  abnormal_pickup_threshold: number;
  autopilot_enabled?: boolean;
  surge_increase_eur?: number;
}

export default function StrategyRecommendationsPanel({
  recs, decisions, settings, hotelId, orgSlug, profileId, onChange,
}: {
  recs: Rec[];
  decisions: Decision[];
  settings: Settings | null;
  hotelId: string;
  orgSlug: string;
  profileId?: string;
  onChange: () => void;
}) {
  const decByDate = useMemo(() => {
    const m = new Map<string, Decision>();
    for (const d of decisions) if (!m.has(d.stay_date)) m.set(d.stay_date, d);
    return m;
  }, [decisions]);

  const today = new Date().toISOString().slice(0, 10);
  const horizon = (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() + 90); return d.toISOString().slice(0, 10); })();
  const filtered = useMemo(() => recs
    .filter(r => r.status === "pending" && r.stay_date >= today && r.stay_date <= horizon)
    .sort((a, b) => a.stay_date.localeCompare(b.stay_date)), [recs, today, horizon]);

  function driver(r: Rec): { label: string; tone: "decay" | "surge" | "manual" | "event" } {
    const d = decByDate.get(r.stay_date);
    const text = (d?.decision_type ?? r.reason ?? "").toLowerCase();
    if (text.includes("surge") || text.includes("velocity") || text.includes("pickup")) return { label: "Surge", tone: "surge" };
    if (text.includes("decay") || text.includes("decrease")) return { label: "Decay", tone: "decay" };
    if (text.includes("event")) return { label: "Event", tone: "event" };
    return { label: "Manual", tone: "manual" };
  }

  async function approve(r: Rec) {
    const { error } = await supabase.from("rate_recommendations")
      .update({ status: "approved", reviewed_by: profileId, reviewed_at: new Date().toISOString() })
      .eq("id", r.id);
    if (error) { toast.error(error.message); return; }
    await supabase.from("rate_history").insert({
      hotel_id: hotelId, organization_slug: orgSlug,
      stay_date: r.stay_date, old_rate_eur: r.current_rate_eur,
      new_rate_eur: r.recommended_rate_eur, source: "engine", changed_by: profileId, notes: r.reason ?? null,
    });
    toast.success(`Approved ${r.stay_date}`);
    onChange();
  }

  async function reject(r: Rec) {
    const { error } = await supabase.from("rate_recommendations").update({ status: "expired" }).eq("id", r.id);
    if (error) { toast.error(error.message); return; }
    onChange();
  }

  async function approveAllSurge() {
    const targets = filtered.filter(r => driver(r).tone === "surge");
    if (!targets.length) { toast.info("No surge recs"); return; }
    for (const r of targets) await approve(r);
  }
  async function approveAllDecay(maxAbs = 10) {
    const targets = filtered.filter(r => driver(r).tone === "decay" && Math.abs(r.delta_eur) <= maxAbs);
    if (!targets.length) { toast.info(`No decay recs ≤ €${maxAbs}`); return; }
    for (const r of targets) await approve(r);
  }

  return (
    <div className="space-y-3">
      {settings && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              Live engine rules
              <Badge variant={settings.autopilot_enabled ? "default" : "outline"}>
                {settings.autopilot_enabled ? "Autopilot ON" : "Autopilot OFF"}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-xs">
              <Stat label="Floor" value={`€${settings.floor_price_eur}`} />
              <Stat label="Max daily Δ" value={`€${settings.max_daily_change_eur}`} />
              <Stat label="Weekday decay" value={`-€${settings.weekday_decrease_eur}`} />
              <Stat label="Weekend decay" value={`-€${settings.weekend_decrease_eur}`} />
              <Stat label="Surge threshold" value={`${settings.abnormal_pickup_threshold} bookings/h`} />
              <Stat label="Surge bump" value={`+€${settings.surge_increase_eur ?? 25}`} />
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base flex items-center gap-2">
            <Zap className="h-4 w-4" /> Pending recommendations · next 90 days
            <Badge variant="outline">{filtered.length}</Badge>
          </CardTitle>
          <div className="flex gap-1">
            <Button size="sm" variant="outline" onClick={() => approveAllDecay(10)}>Approve decay ≤ €10</Button>
            <Button size="sm" variant="default" onClick={approveAllSurge}>Approve surges</Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">No pending recommendations. Run autopilot to compute new ones.</div>
          ) : (
            <div className="divide-y max-h-[520px] overflow-y-auto">
              {filtered.map(r => {
                const drv = driver(r);
                const dec = decByDate.get(r.stay_date);
                return (
                  <div key={r.id} className="px-3 py-2 flex items-center gap-2 text-sm">
                    <div className="w-20 shrink-0 font-mono text-xs">{r.stay_date}</div>
                    <Badge variant="outline" className={`text-[10px] ${drv.tone === "surge" ? "border-emerald-400 text-emerald-700" : drv.tone === "decay" ? "border-red-400 text-red-700" : drv.tone === "event" ? "border-purple-400 text-purple-700" : ""}`}>
                      {drv.label}
                    </Badge>
                    <div className="text-xs text-muted-foreground">€{r.current_rate_eur ?? "—"} →</div>
                    <div className="font-semibold">€{r.recommended_rate_eur}</div>
                    <div className={`inline-flex items-center text-xs font-medium ${r.delta_eur >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                      {r.delta_eur >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                      {r.delta_eur > 0 ? "+" : ""}{r.delta_eur}€
                    </div>
                    <div className="flex-1 truncate text-xs text-muted-foreground" title={dec?.reason ?? r.reason ?? ""}>
                      {dec?.reason ?? r.reason ?? ""}
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => approve(r)}><Check className="h-4 w-4 text-emerald-600" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => reject(r)}><X className="h-4 w-4 text-red-600" /></Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border p-2">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}
