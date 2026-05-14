import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Activity, Bot, Loader2, RefreshCw, Sparkles, TrendingDown, TrendingUp, Zap } from "lucide-react";
import { toast } from "sonner";

interface Decision {
  id: string;
  stay_date: string;
  decision_type: string;
  before_rate_eur: number | null;
  after_rate_eur: number | null;
  delta_eur: number | null;
  reason: string | null;
  created_at: string;
}

interface VelocityEvent {
  id: string;
  stay_date: string;
  detected_at: string;
  arrivals_in_window: number;
  window_minutes: number;
  recommended_increase_eur: number;
  acted: boolean;
}

export default function AnalystPanel({ hotelId }: { hotelId: string }) {
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [events, setEvents] = useState<VelocityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  async function load() {
    setLoading(true);
    const [{ data: d }, { data: v }] = await Promise.all([
      (supabase as any).from("autopilot_decisions").select("*")
        .eq("hotel_id", hotelId).order("created_at", { ascending: false }).limit(100),
      (supabase as any).from("booking_velocity_events").select("*")
        .eq("hotel_id", hotelId).order("detected_at", { ascending: false }).limit(50),
    ]);
    setDecisions((d ?? []) as Decision[]);
    setEvents((v ?? []) as VelocityEvent[]);
    setLoading(false);
  }

  useEffect(() => { void load(); }, [hotelId]);

  async function runTick() {
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("revenue-autopilot-tick", {
        body: { hotel_id: hotelId },
      });
      if (error) throw error;
      toast.success(`Autopilot ran · ${(data as any)?.decisions ?? 0} decisions, ${(data as any)?.surges ?? 0} surges`);
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "Autopilot failed");
    } finally {
      setRunning(false);
    }
  }

  function iconFor(type: string) {
    if (type.includes("surge") || type.includes("increase")) return <TrendingUp className="h-4 w-4 text-emerald-600" />;
    if (type.includes("decay") || type.includes("decrease")) return <TrendingDown className="h-4 w-4 text-red-600" />;
    return <Sparkles className="h-4 w-4 text-purple-600" />;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bot className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Autopilot Analyst</h2>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />Refresh
          </Button>
          <Button size="sm" onClick={runTick} disabled={running}>
            {running ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Zap className="h-4 w-4 mr-1" />}
            Run autopilot now
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4" /> Booking velocity events
            <Badge variant="outline">{events.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <div className="text-sm text-muted-foreground">No surge events detected yet. Autopilot watches for ≥2 bookings per stay-date inside the surge window.</div>
          ) : (
            <div className="divide-y">
              {events.map((e) => (
                <div key={e.id} className="py-2 flex items-center gap-3 text-sm">
                  <Zap className="h-4 w-4 text-amber-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium">
                      {e.stay_date} · {e.arrivals_in_window} bookings in {e.window_minutes}min
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(e.detected_at).toLocaleString()}
                    </div>
                  </div>
                  <Badge variant={e.acted ? "default" : "secondary"}>
                    {e.acted ? `+€${e.recommended_increase_eur}` : "queued"}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="h-4 w-4" /> Decision log
            <Badge variant="outline">{decisions.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {decisions.length === 0 ? (
            <div className="text-sm text-muted-foreground">No autopilot decisions logged yet.</div>
          ) : (
            <div className="divide-y max-h-[480px] overflow-y-auto">
              {decisions.map((d) => (
                <div key={d.id} className="py-2 flex items-start gap-3 text-sm">
                  <div className="mt-0.5">{iconFor(d.decision_type)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{d.stay_date}</span>
                      <Badge variant="outline" className="text-[10px]">{d.decision_type}</Badge>
                      {d.delta_eur != null && (
                        <span className={`text-xs font-semibold ${Number(d.delta_eur) >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                          {Number(d.delta_eur) > 0 ? "+" : ""}{d.delta_eur}€
                        </span>
                      )}
                      {d.before_rate_eur != null && d.after_rate_eur != null && (
                        <span className="text-xs text-muted-foreground">€{d.before_rate_eur} → €{d.after_rate_eur}</span>
                      )}
                    </div>
                    {d.reason && <div className="text-xs text-muted-foreground mt-0.5">{d.reason}</div>}
                    <div className="text-[10px] text-muted-foreground">{new Date(d.created_at).toLocaleString()}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
