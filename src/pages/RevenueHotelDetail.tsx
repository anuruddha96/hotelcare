import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  ArrowLeft, Sparkles, TrendingUp, TrendingDown, AlertTriangle,
  Loader2, Check, Edit3, X, Wand2,
} from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip as RTooltip, ResponsiveContainer } from "recharts";

interface Snap {
  stay_date: string;
  bookings_current: number;
  bookings_last_year: number;
  delta: number;
  captured_at: string;
}
interface Rec {
  id: string;
  stay_date: string;
  current_rate_eur: number | null;
  recommended_rate_eur: number;
  delta_eur: number;
  reason: string | null;
  status: string;
}
interface Hist { stay_date: string; new_rate_eur: number; changed_at: string; }

interface Row {
  date: string;
  dow: string;
  daysOut: number;
  isWeekend: boolean;
  bookingsNow: number | null;
  bookingsPrev: number | null;
  pickupDelta: number;
  bookingsLY: number | null;
  vsLY: number | null;
  rate: number | null;
  rec: Rec | null;
  abnormal: boolean;
}

interface AIPayload {
  summary: string;
  top_increase_dates: { date: string; reason: string; suggested_delta_eur: number; confidence: string }[];
  top_decrease_dates: { date: string; reason: string; suggested_delta_eur: number; confidence: string }[];
  anomalies: { date: string; note: string }[];
  strategy_notes: string;
}

const ALLOWED = ["admin", "top_management"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function RevenueHotelDetail() {
  const { profile, loading } = useAuth();
  const { organizationSlug, hotelId } = useParams<{ organizationSlug: string; hotelId: string }>();
  const navigate = useNavigate();

  const [hotelName, setHotelName] = useState("");
  const [snapshots, setSnapshots] = useState<Snap[]>([]);
  const [recs, setRecs] = useState<Rec[]>([]);
  const [history, setHistory] = useState<Hist[]>([]);
  const [abnormalDates, setAbnormalDates] = useState<Set<string>>(new Set());

  const [aiBusy, setAiBusy] = useState(false);
  const [aiPayload, setAiPayload] = useState<AIPayload | null>(null);
  const [aiGeneratedAt, setAiGeneratedAt] = useState<string | null>(null);

  const [askDate, setAskDate] = useState<string | null>(null);
  const [askBusy, setAskBusy] = useState(false);
  const [askResult, setAskResult] = useState<AIPayload | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!profile || !ALLOWED.includes(profile.role)) {
      navigate(`/${organizationSlug || "rdhotels"}`);
      return;
    }
    void load();
  }, [loading, profile?.role, hotelId]);

  async function load() {
    if (!hotelId) return;
    const today = new Date().toISOString().slice(0, 10);
    const horizon = new Date();
    horizon.setUTCDate(horizon.getUTCDate() + 120);
    const horizonStr = horizon.toISOString().slice(0, 10);

    const [{ data: h }, { data: s }, { data: r }, { data: hi }, { data: alerts }, { data: lastInsight }] =
      await Promise.all([
        supabase.from("hotel_configurations").select("hotel_name").eq("hotel_id", hotelId).maybeSingle(),
        supabase.from("pickup_snapshots").select("stay_date,bookings_current,bookings_last_year,delta,captured_at")
          .eq("hotel_id", hotelId).gte("stay_date", today).lte("stay_date", horizonStr)
          .order("captured_at", { ascending: false }).limit(3000),
        supabase.from("rate_recommendations").select("*")
          .eq("hotel_id", hotelId).gte("stay_date", today).lte("stay_date", horizonStr)
          .order("stay_date", { ascending: true }).limit(500),
        supabase.from("rate_history").select("stay_date,new_rate_eur,changed_at")
          .eq("hotel_id", hotelId).gte("stay_date", today).lte("stay_date", horizonStr)
          .order("changed_at", { ascending: false }).limit(500),
        supabase.from("revenue_alerts").select("stay_date")
          .eq("hotel_id", hotelId).is("acknowledged_at", null).eq("alert_type", "abnormal_pickup"),
        supabase.from("revenue_ai_insights").select("payload,created_at")
          .eq("hotel_id", hotelId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      ]);

    setHotelName(h?.hotel_name ?? hotelId);
    setSnapshots((s ?? []) as Snap[]);
    setRecs((r ?? []) as Rec[]);
    setHistory((hi ?? []) as Hist[]);
    setAbnormalDates(new Set((alerts ?? []).map((a: any) => a.stay_date)));
    if (lastInsight) {
      setAiPayload(lastInsight.payload as AIPayload);
      setAiGeneratedAt(lastInsight.created_at);
    }
  }

  // Build per-date rows
  const rows: Row[] = useMemo(() => {
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    const byDate = new Map<string, Snap[]>();
    for (const s of snapshots) {
      const arr = byDate.get(s.stay_date) ?? [];
      arr.push(s);
      byDate.set(s.stay_date, arr);
    }
    const histByDate = new Map<string, number>();
    for (const h of history) if (!histByDate.has(h.stay_date)) histByDate.set(h.stay_date, h.new_rate_eur);
    const recByDate = new Map<string, Rec>();
    for (const rec of recs) if (rec.status === "pending" && !recByDate.has(rec.stay_date)) recByDate.set(rec.stay_date, rec);

    const out: Row[] = [];
    for (let i = 0; i < 120; i++) {
      const d = new Date(today); d.setUTCDate(today.getUTCDate() + i);
      const date = d.toISOString().slice(0, 10);
      const dow = d.getUTCDay();
      const snaps = byDate.get(date) ?? [];
      const latest = snaps[0] ?? null;
      const prev = snaps[1] ?? null;
      const pickupDelta = latest && prev ? (latest.bookings_current - prev.bookings_current) : 0;
      const ly = latest?.bookings_last_year ?? null;
      out.push({
        date, dow: DOW[dow], daysOut: i, isWeekend: dow === 5 || dow === 6,
        bookingsNow: latest?.bookings_current ?? null,
        bookingsPrev: prev?.bookings_current ?? null,
        pickupDelta,
        bookingsLY: ly,
        vsLY: latest && ly != null ? latest.bookings_current - ly : null,
        rate: histByDate.get(date) ?? null,
        rec: recByDate.get(date) ?? null,
        abnormal: abnormalDates.has(date),
      });
    }
    return out;
  }, [snapshots, recs, history, abnormalDates]);

  const kpis = useMemo(() => {
    const sum7 = rows.slice(0, 7).reduce((a, r) => a + r.pickupDelta, 0);
    const sum30 = rows.slice(0, 30).reduce((a, r) => a + r.pickupDelta, 0);
    return {
      pendingRecs: recs.filter(r => r.status === "pending").length,
      abnormal: abnormalDates.size,
      pickup7: sum7,
      pickup30: sum30,
    };
  }, [rows, recs, abnormalDates]);

  const trendData = useMemo(
    () => rows.map(r => ({ date: r.date.slice(5), bookings: r.bookingsNow ?? 0, ly: r.bookingsLY ?? 0 })),
    [rows]
  );

  async function approve(rec: Rec) {
    const { error } = await supabase.from("rate_recommendations")
      .update({ status: "approved", reviewed_by: profile?.id, reviewed_at: new Date().toISOString() })
      .eq("id", rec.id);
    if (error) { toast.error(error.message); return; }
    await supabase.from("rate_history").insert({
      hotel_id: hotelId!, organization_slug: profile?.organization_slug ?? "rdhotels",
      stay_date: rec.stay_date, old_rate_eur: rec.current_rate_eur,
      new_rate_eur: rec.recommended_rate_eur, source: "engine",
      changed_by: profile?.id, notes: rec.reason ?? null,
    });
    toast.success("Approved");
    void load();
  }

  async function override(rec: Rec) {
    const v = prompt("New rate €", String(rec.recommended_rate_eur));
    if (!v) return;
    const newRate = parseFloat(v);
    if (Number.isNaN(newRate)) return;
    await supabase.from("rate_recommendations")
      .update({ status: "overridden", recommended_rate_eur: newRate, reviewed_by: profile?.id, reviewed_at: new Date().toISOString() })
      .eq("id", rec.id);
    await supabase.from("rate_history").insert({
      hotel_id: hotelId!, organization_slug: profile?.organization_slug ?? "rdhotels",
      stay_date: rec.stay_date, old_rate_eur: rec.current_rate_eur,
      new_rate_eur: newRate, source: "manual", changed_by: profile?.id, notes: "manual override",
    });
    toast.success("Overridden");
    void load();
  }

  async function dismiss(rec: Rec) {
    await supabase.from("rate_recommendations").update({ status: "dismissed", reviewed_by: profile?.id, reviewed_at: new Date().toISOString() }).eq("id", rec.id);
    void load();
  }

  async function applyAISuggestion(item: { date: string; suggested_delta_eur: number; reason: string }) {
    const currentRate = history.find(h => h.stay_date === item.date)?.new_rate_eur ?? null;
    const newRate = (currentRate ?? 0) + item.suggested_delta_eur;
    const { error } = await supabase.from("rate_recommendations").insert({
      hotel_id: hotelId!,
      organization_slug: profile?.organization_slug ?? "rdhotels",
      stay_date: item.date,
      current_rate_eur: currentRate,
      recommended_rate_eur: Number(newRate.toFixed(2)),
      delta_eur: item.suggested_delta_eur,
      reason: `AI: ${item.reason}`,
      status: "pending",
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Recommendation created");
    void load();
  }

  async function runAI(focus_date?: string) {
    if (focus_date) { setAskBusy(true); setAskResult(null); } else { setAiBusy(true); }
    const { data, error } = await supabase.functions.invoke("revenue-ai-analyze", {
      body: { hotel_id: hotelId, focus_date },
    });
    if (focus_date) setAskBusy(false); else setAiBusy(false);
    if (error) { toast.error(error.message); return; }
    if (data?.error) { toast.error(data.error); return; }
    if (focus_date) setAskResult(data.payload);
    else { setAiPayload(data.payload); setAiGeneratedAt(new Date().toISOString()); toast.success("AI analysis updated"); }
  }

  return (
    <div className="container mx-auto p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate(`/${organizationSlug}/revenue`)}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <h1 className="text-2xl font-semibold">{hotelName}</h1>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Kpi label="Pickup 7d" value={kpis.pickup7} positive={kpis.pickup7 >= 0} />
        <Kpi label="Pickup 30d" value={kpis.pickup30} positive={kpis.pickup30 >= 0} />
        <Kpi label="Pending recs" value={kpis.pendingRecs} />
        <Kpi label="Abnormal alerts" value={kpis.abnormal} alert={kpis.abnormal > 0} />
      </div>

      {/* AI Analysis */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center justify-between gap-2 flex-wrap">
            <span className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-purple-600" /> AI Revenue Analyst</span>
            <div className="flex items-center gap-2">
              {aiGeneratedAt && <span className="text-xs text-muted-foreground">Last: {new Date(aiGeneratedAt).toLocaleString()}</span>}
              <Button size="sm" onClick={() => runAI()} disabled={aiBusy}>
                {aiBusy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Wand2 className="h-4 w-4 mr-1" />}
                {aiPayload ? "Re-analyze" : "Generate analysis"}
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!aiPayload && !aiBusy && (
            <p className="text-sm text-muted-foreground">
              Click <b>Generate analysis</b> to have AI review the latest pickup data and propose which dates to raise or lower prices.
            </p>
          )}
          {aiPayload && (
            <>
              <p className="text-sm">{aiPayload.summary}</p>
              <div className="grid md:grid-cols-2 gap-3">
                <SuggestionList
                  title="Increase candidates" icon={<TrendingUp className="h-4 w-4 text-green-600" />}
                  items={aiPayload.top_increase_dates} onApply={applyAISuggestion}
                />
                <SuggestionList
                  title="Decrease candidates" icon={<TrendingDown className="h-4 w-4 text-red-600" />}
                  items={aiPayload.top_decrease_dates} onApply={applyAISuggestion}
                />
              </div>
              {aiPayload.anomalies.length > 0 && (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-sm">
                  <div className="font-semibold flex items-center gap-1 mb-1"><AlertTriangle className="h-4 w-4" /> Anomalies</div>
                  <ul className="list-disc list-inside space-y-1">
                    {aiPayload.anomalies.map((a, i) => <li key={i}><b>{a.date}</b> — {a.note}</li>)}
                  </ul>
                </div>
              )}
              {aiPayload.strategy_notes && (
                <p className="text-xs text-muted-foreground italic">{aiPayload.strategy_notes}</p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="list">
        <TabsList>
          <TabsTrigger value="list">List</TabsTrigger>
          <TabsTrigger value="calendar">Calendar</TabsTrigger>
          <TabsTrigger value="trend">Trend</TabsTrigger>
        </TabsList>

        <TabsContent value="list">
          <Card>
            <CardContent className="p-0 overflow-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground bg-muted/50 sticky top-0">
                  <tr>
                    <th className="p-2">Date</th><th>DOW</th><th>+d</th>
                    <th>Bookings</th><th>Pickup Δ</th><th>vs LY</th>
                    <th>Rate (PMS)</th><th>Recommendation</th><th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.date} className={`border-t ${r.abnormal ? "bg-red-50" : r.pickupDelta >= 3 ? "bg-green-50/60" : r.bookingsNow === 0 && r.daysOut > 14 ? "bg-amber-50/40" : ""}`}>
                      <td className="p-2 font-mono">{r.date}</td>
                      <td>{r.dow}{r.isWeekend && <span className="text-purple-600 ml-1">★</span>}</td>
                      <td className="text-muted-foreground">{r.daysOut}</td>
                      <td>{r.bookingsNow ?? "—"}{r.bookingsPrev != null && <span className="text-xs text-muted-foreground"> / was {r.bookingsPrev}</span>}</td>
                      <td className={r.pickupDelta > 0 ? "text-green-700 font-semibold" : r.pickupDelta < 0 ? "text-red-700" : ""}>
                        {r.pickupDelta > 0 ? "+" : ""}{r.pickupDelta}
                        {r.abnormal && <Badge variant="destructive" className="ml-1 text-[10px]">!</Badge>}
                      </td>
                      <td className={r.vsLY != null && r.vsLY > 0 ? "text-green-700" : r.vsLY != null && r.vsLY < 0 ? "text-red-700" : ""}>
                        {r.vsLY != null ? (r.vsLY > 0 ? "+" : "") + r.vsLY : "—"}
                      </td>
                      <td>{r.rate != null ? `€${r.rate}` : "—"}</td>
                      <td className="text-xs">
                        {r.rec ? (
                          <span>
                            <b>€{r.rec.recommended_rate_eur}</b>{" "}
                            <span className={r.rec.delta_eur >= 0 ? "text-green-600" : "text-red-600"}>({r.rec.delta_eur > 0 ? "+" : ""}{r.rec.delta_eur}€)</span>
                            <div className="text-muted-foreground">{r.rec.reason}</div>
                          </span>
                        ) : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="space-x-1 whitespace-nowrap">
                        {r.rec && (
                          <>
                            <Button size="icon" variant="outline" className="h-7 w-7" title="Approve" onClick={() => approve(r.rec!)}><Check className="h-3 w-3" /></Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7" title="Override" onClick={() => override(r.rec!)}><Edit3 className="h-3 w-3" /></Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7" title="Dismiss" onClick={() => dismiss(r.rec!)}><X className="h-3 w-3" /></Button>
                          </>
                        )}
                        <Button size="icon" variant="ghost" className="h-7 w-7" title="Ask AI about this date" onClick={() => { setAskDate(r.date); setAskResult(null); void runAI(r.date); }}>
                          <Sparkles className="h-3 w-3 text-purple-600" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="calendar">
          <Card><CardContent className="p-3">
            <div className="grid grid-cols-7 gap-1 text-xs">
              {["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(d => <div key={d} className="text-center font-semibold text-muted-foreground">{d}</div>)}
              {(() => {
                if (rows.length === 0) return null;
                const first = new Date(rows[0].date);
                const offset = (first.getUTCDay() + 6) % 7; // monday start
                return Array.from({ length: offset }, (_, i) => <div key={"e"+i} />);
              })()}
              {rows.map(r => {
                const intensity =
                  r.pickupDelta >= 5 ? "bg-green-600 text-white" :
                  r.pickupDelta >= 3 ? "bg-green-400 text-white" :
                  r.pickupDelta >= 1 ? "bg-green-100" :
                  r.pickupDelta <= -3 ? "bg-red-300" :
                  r.pickupDelta < 0 ? "bg-red-100" :
                  r.bookingsNow === 0 && r.daysOut > 14 ? "bg-amber-100" : "bg-muted/30";
                return (
                  <div key={r.date} className={`rounded p-1 text-center ${intensity} ${r.abnormal ? "ring-2 ring-red-600" : ""}`} title={`${r.date}: pickup Δ ${r.pickupDelta}`}>
                    <div className="font-semibold">{r.date.slice(8)}</div>
                    <div className="text-[10px]">{r.pickupDelta > 0 ? "+" : ""}{r.pickupDelta}</div>
                  </div>
                );
              })}
            </div>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="trend">
          <Card><CardContent className="p-3 h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendData}>
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <RTooltip />
                <Line type="monotone" dataKey="bookings" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="ly" stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent></Card>
        </TabsContent>
      </Tabs>

      <Card>
        <CardHeader><CardTitle className="text-base">Push to Previo</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Disabled until Previo Rate API endpoint and rate-plan IDs are configured.
          <Button className="ml-2" disabled>Push approved rates</Button>
        </CardContent>
      </Card>

      <Dialog open={!!askDate} onOpenChange={(o) => { if (!o) { setAskDate(null); setAskResult(null); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-purple-600" /> AI insight for {askDate}</DialogTitle></DialogHeader>
          {askBusy && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Analyzing…</div>}
          {askResult && (
            <div className="space-y-2 text-sm">
              <p>{askResult.summary}</p>
              {askResult.strategy_notes && <p className="text-xs text-muted-foreground italic">{askResult.strategy_notes}</p>}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Kpi({ label, value, positive, alert }: { label: string; value: number; positive?: boolean; alert?: boolean }) {
  return (
    <Card className={alert ? "border-red-500" : ""}>
      <CardContent className="p-3">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`text-xl font-semibold ${positive === false ? "text-red-600" : positive === true ? "text-green-600" : ""}`}>
          {value > 0 && positive !== undefined ? "+" : ""}{value}
        </div>
      </CardContent>
    </Card>
  );
}

function SuggestionList({
  title, icon, items, onApply,
}: {
  title: string; icon: React.ReactNode;
  items: { date: string; reason: string; suggested_delta_eur: number; confidence: string }[];
  onApply: (it: any) => void;
}) {
  return (
    <div className="rounded-md border p-2">
      <div className="font-semibold text-sm flex items-center gap-1 mb-2">{icon} {title}</div>
      {items.length === 0 && <div className="text-xs text-muted-foreground">None.</div>}
      <ul className="space-y-1 text-sm">
        {items.map((it, i) => (
          <li key={i} className="flex items-center justify-between gap-2 border-t pt-1 first:border-t-0 first:pt-0">
            <div>
              <div><b className="font-mono">{it.date}</b> <Badge variant="outline" className="text-[10px]">{it.confidence}</Badge> <span className={it.suggested_delta_eur >= 0 ? "text-green-700" : "text-red-700"}>{it.suggested_delta_eur > 0 ? "+" : ""}{it.suggested_delta_eur}€</span></div>
              <div className="text-xs text-muted-foreground">{it.reason}</div>
            </div>
            <Button size="sm" variant="outline" onClick={() => onApply(it)}>Apply</Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
