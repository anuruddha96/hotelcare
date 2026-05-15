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
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  ArrowLeft, ChevronLeft, ChevronRight, Upload, TrendingUp, TrendingDown,
  AlertTriangle, Loader2, Check, Edit3, X, Calendar as CalIcon, BarChart3,
  Settings2, Sparkles, Plus, RefreshCw, Bot,
} from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip as RTooltip, ResponsiveContainer, BarChart, Bar } from "recharts";
import { computeSuggestedRate, type PricingMultipliers, type EngineSettings, leadTimeBucket, DOW_NAMES, MONTH_NAMES, LEAD_LABELS } from "@/lib/revenuePricing";
import RoomsSetupTab from "@/components/revenue/settings/RoomsSetupTab";
import PercentAdjustmentTab from "@/components/revenue/settings/PercentAdjustmentTab";
import { CalendarYearView, CalendarQuarterView } from "@/components/revenue/CalendarYearView";
import PricingDriverChips from "@/components/revenue/PricingDriverChips";
import AnalystPanel from "@/components/revenue/AnalystPanel";
import StrategyCalendar from "@/components/revenue/StrategyCalendar";
import StrategyRecommendationsPanel from "@/components/revenue/StrategyRecommendationsPanel";

interface Snap { stay_date: string; bookings_current: number; bookings_last_year: number; delta: number; captured_at: string; }
interface Rec { id: string; stay_date: string; current_rate_eur: number | null; recommended_rate_eur: number; delta_eur: number; reason: string | null; status: string; }
interface DailyRate { stay_date: string; rate_eur: number; occupancy_pct: number | null; }
interface Event { id: string; event_date: string; end_date: string | null; title: string; category: string; impact: string; notes: string | null; }
interface MinStay { stay_date: string; min_nights: number; }
interface Settings {
  floor_price_eur: number; max_daily_change_eur: number; weekday_decrease_eur: number; weekend_decrease_eur: number;
  abnormal_pickup_threshold: number; pickup_increase_tiers: { min: number; max: number; increase: number }[];
}

interface Row {
  date: string; dayNum: number; dow: number; isWeekend: boolean; daysOut: number;
  rate: number | null; occupancy: number | null;
  pickupDelta: number; bookingsNow: number | null; bookingsLY: number | null;
  rec: Rec | null; suggestedRate: number | null; suggestedDelta: number | null;
  abnormal: boolean; minNights: number | null; events: Event[];
}

const ALLOWED = ["admin", "top_management"];
const DOW_LABELS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

function fmtMonth(d: Date) { return d.toLocaleString("en-US", { month: "long", year: "numeric" }); }
function startOfMonth(d: Date) { const x = new Date(d); x.setUTCDate(1); x.setUTCHours(0,0,0,0); return x; }
function addDays(d: Date, n: number) { const x = new Date(d); x.setUTCDate(x.getUTCDate()+n); return x; }
function iso(d: Date) { return d.toISOString().slice(0,10); }

export default function RevenueHotelDetail() {
  const { profile, loading } = useAuth();
  const { organizationSlug, hotelId } = useParams<{ organizationSlug: string; hotelId: string }>();
  const navigate = useNavigate();

  const [hotelName, setHotelName] = useState("");
  const [snapshots, setSnapshots] = useState<Snap[]>([]);
  const [recs, setRecs] = useState<Rec[]>([]);
  const [rates, setRates] = useState<Array<DailyRate & { source?: string }>>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [minStays, setMinStays] = useState<MinStay[]>([]);
  const [abnormalDates, setAbnormalDates] = useState<Set<string>>(new Set());
  const [settings, setSettings] = useState<Settings | null>(null);
  const [decisions, setDecisions] = useState<{ stay_date: string; decision_type: string; reason: string | null }[]>([]);
  const [autopilotBusy, setAutopilotBusy] = useState(false);
  const [lastPushAt, setLastPushAt] = useState<string | null>(null);
  const [occByDate, setOccByDate] = useState<Map<string, { occupancy_pct: number; rooms_sold: number }>>(new Map());
  const [refRoomInfo, setRefRoomInfo] = useState<{ name: string; base_price_eur: number; num_rooms: number } | null>(null);

  const [view, setView] = useState<"week"|"month"|"quarter"|"year">("month");
  const [tab, setTab] = useState("prices");
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [multipliers, setMultipliers] = useState<PricingMultipliers>({
    dowPercent: {}, monthlyPercent: {}, leadTimePercent: {},
  });

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
    const today = iso(new Date());
    const horizon = iso(addDays(new Date(), 365));
    const [{ data: h }, { data: s }, { data: r }, { data: dr }, { data: ev }, { data: ms }, { data: alerts }, { data: st }, { data: rooms }, { data: dow }, { data: mon }, { data: lead }, { data: occT }, { data: occS }, { data: occSnaps }] = await Promise.all([
      supabase.from("hotel_configurations").select("hotel_name").eq("hotel_id", hotelId).maybeSingle(),
      supabase.from("pickup_snapshots").select("stay_date,bookings_current,bookings_last_year,delta,captured_at")
        .eq("hotel_id", hotelId).gte("stay_date", today).lte("stay_date", horizon)
        .order("captured_at", { ascending: false }).limit(5000),
      supabase.from("rate_recommendations").select("*")
        .eq("hotel_id", hotelId).gte("stay_date", today).lte("stay_date", horizon).limit(1000),
      (supabase as any).from("daily_rates").select("stay_date,rate_eur,occupancy_pct,source")
        .eq("hotel_id", hotelId).gte("stay_date", today).lte("stay_date", horizon).limit(1000),
      (supabase as any).from("hotel_events").select("*").eq("hotel_id", hotelId)
        .gte("event_date", today).lte("event_date", horizon).limit(500),
      (supabase as any).from("min_stay_rules").select("stay_date,min_nights")
        .eq("hotel_id", hotelId).gte("stay_date", today).lte("stay_date", horizon).limit(1000),
      supabase.from("revenue_alerts").select("stay_date").eq("hotel_id", hotelId).is("acknowledged_at", null).eq("alert_type", "abnormal_pickup"),
      supabase.from("hotel_revenue_settings").select("*").eq("hotel_id", hotelId).maybeSingle(),
      (supabase as any).from("room_types").select("name,base_price_eur,min_price_eur,max_price_eur,is_reference,num_rooms").eq("hotel_id", hotelId),
      (supabase as any).from("dow_adjustments").select("dow,percent").eq("hotel_id", hotelId),
      (supabase as any).from("monthly_adjustments").select("month,percent").eq("hotel_id", hotelId),
      (supabase as any).from("lead_time_adjustments").select("bucket,percent").eq("hotel_id", hotelId),
      (supabase as any).from("occupancy_targets").select("month,target_pct").eq("hotel_id", hotelId),
      (supabase as any).from("occupancy_strategy").select("aggressiveness").eq("hotel_id", hotelId).maybeSingle(),
      (supabase as any).from("occupancy_snapshots")
        .select("stay_date,occupancy_pct,rooms_sold,captured_at")
        .eq("hotel_id", hotelId).gte("stay_date", today).lte("stay_date", horizon)
        .order("captured_at", { ascending: false }).limit(5000),
    ]);

    setHotelName(h?.hotel_name ?? hotelId);
    setSnapshots((s ?? []) as Snap[]);
    setRecs((r ?? []) as Rec[]);
    setRates((dr ?? []) as any);
    setEvents((ev ?? []) as Event[]);
    setMinStays((ms ?? []) as MinStay[]);
    setAbnormalDates(new Set((alerts ?? []).map((a: any) => a.stay_date)));
    setSettings(st as any);

    // Latest occupancy snapshot per date (occSnaps already ordered desc by captured_at).
    const occMap = new Map<string, { occupancy_pct: number; rooms_sold: number }>();
    for (const o of (occSnaps ?? []) as any[]) {
      if (!occMap.has(o.stay_date)) occMap.set(o.stay_date, { occupancy_pct: Number(o.occupancy_pct) || 0, rooms_sold: o.rooms_sold ?? 0 });
    }
    setOccByDate(occMap);

    // Autopilot decisions + last push timestamp (best-effort, errors ignored)
    const [{ data: dec }, { data: lp }] = await Promise.all([
      (supabase as any).from("autopilot_decisions").select("stay_date,decision_type,reason")
        .eq("hotel_id", hotelId).order("created_at", { ascending: false }).limit(500),
      (supabase as any).from("pms_sync_history").select("created_at,sync_status")
        .eq("hotel_id", hotelId).eq("sync_type", "rate_push").eq("sync_status", "success")
        .order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    setDecisions((dec ?? []) as any);
    setLastPushAt(lp?.created_at ?? null);

    const refRoom = (rooms ?? []).find((rt: any) => rt.is_reference) ?? (rooms ?? [])[0];
    if (refRoom) setRefRoomInfo({
      name: refRoom.name ?? "Reference room",
      base_price_eur: Number(refRoom.base_price_eur) || 0,
      num_rooms: refRoom.num_rooms ?? 0,
    });
    const dowMap: Record<number, number> = {};
    for (const d of dow ?? []) dowMap[d.dow] = Number(d.percent) || 0;
    const monMap: Record<number, number> = {};
    for (const m of mon ?? []) monMap[m.month] = Number(m.percent) || 0;
    const leadMap: Record<string, number> = {};
    for (const l of lead ?? []) leadMap[l.bucket] = Number(l.percent) || 0;
    const currentMonth = new Date().getMonth() + 1;
    const occT0 = (occT ?? []).find((x: any) => x.month === currentMonth);
    setMultipliers({
      basePriceEur: refRoom?.base_price_eur ? Number(refRoom.base_price_eur) : undefined,
      minPriceEur: refRoom?.min_price_eur ? Number(refRoom.min_price_eur) : undefined,
      maxPriceEur: refRoom?.max_price_eur ? Number(refRoom.max_price_eur) : undefined,
      dowPercent: dowMap, monthlyPercent: monMap, leadTimePercent: leadMap,
      occupancyTargetPct: occT0?.target_pct ?? undefined,
      occupancyAggressiveness: (occS as any)?.aggressiveness ?? "medium",
    });
  }

  // --- Build rows: for visible window (current month +/- buffer up to 365 days) ---
  const rowsByDate = useMemo(() => {
    const byDateSnaps = new Map<string, Snap[]>();
    for (const s of snapshots) { const a = byDateSnaps.get(s.stay_date) ?? []; a.push(s); byDateSnaps.set(s.stay_date, a); }
    const byDateRate = new Map(rates.map(r => [r.stay_date, r]));
    const recByDate = new Map<string, Rec>();
    for (const rec of recs) if (rec.status === "pending" && !recByDate.has(rec.stay_date)) recByDate.set(rec.stay_date, rec);
    const minByDate = new Map(minStays.map(m => [m.stay_date, m.min_nights]));
    const evByDate = new Map<string, Event[]>();
    for (const e of events) {
      const a = evByDate.get(e.event_date) ?? []; a.push(e); evByDate.set(e.event_date, a);
    }

    const today = new Date(); today.setUTCHours(0,0,0,0);
    const map = new Map<string, Row>();
    for (let i = 0; i < 365; i++) {
      const d = addDays(today, i);
      const date = iso(d);
      const dow = (d.getUTCDay() + 6) % 7; // mon=0
      const snaps = byDateSnaps.get(date) ?? [];
      const latest = snaps[0] ?? null;
      const prev = snaps[1] ?? null;
      const pickupDelta = latest && prev ? (latest.bookings_current - prev.bookings_current) : 0;
      const rate = byDateRate.get(date)?.rate_eur ?? null;
      const rateSource = (byDateRate.get(date) as any)?.source ?? null;
      const occSnap = occByDate.get(date);
      const occ = occSnap?.occupancy_pct ?? byDateRate.get(date)?.occupancy_pct ?? null;
      const roomsSold = occSnap?.rooms_sold ?? null;
      const rec = recByDate.get(date) ?? null;

      // Rule-engine suggestion (when no pending rec) using full RPG multiplier stack
      let suggestedRate: number | null = null;
      let suggestedDelta: number | null = null;
      let pricingResult: any = null;
      if (settings) {
        const engineSettings: EngineSettings = {
          floor_price_eur: settings.floor_price_eur,
          max_daily_change_eur: settings.max_daily_change_eur,
          weekday_decrease_eur: settings.weekday_decrease_eur,
          weekend_decrease_eur: settings.weekend_decrease_eur,
          pickup_increase_tiers: settings.pickup_increase_tiers,
        };
        pricingResult = computeSuggestedRate({
          date, daysOut: i, dow,
          isWeekend: dow === 5 || dow === 6,
          currentRate: rate, occupancyPct: occ,
          pickupDelta, bookingsNow: latest?.bookings_current ?? null,
        }, engineSettings, multipliers);
        if (pricingResult.finalRate && pricingResult.finalRate !== rate) {
          suggestedRate = pricingResult.finalRate;
          suggestedDelta = rate != null ? pricingResult.finalRate - rate : null;
        }
      }

      map.set(date, {
        date, dayNum: d.getUTCDate(), dow, isWeekend: dow === 5 || dow === 6, daysOut: i,
        rate, rateSource, occupancy: occ, roomsSold, pickupDelta,
        bookingsNow: latest?.bookings_current ?? null, bookingsLY: latest?.bookings_last_year ?? null,
        rec, suggestedRate, suggestedDelta,
        abnormal: abnormalDates.has(date),
        minNights: minByDate.get(date) ?? null,
        events: evByDate.get(date) ?? [],
        pricingResult,
        hasEvent: (evByDate.get(date) ?? []).length > 0,
      } as any);
    }
    return map;
  }, [snapshots, recs, rates, events, minStays, abnormalDates, settings, multipliers, occByDate]);

  // Calendar grid for month view
  const gridDays = useMemo(() => {
    if (view === "week") {
      const start = new Date(cursor);
      const dow = (start.getUTCDay() + 6) % 7;
      const monday = addDays(start, -dow);
      return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
    }
    const first = startOfMonth(cursor);
    const offset = (first.getUTCDay() + 6) % 7;
    const gridStart = addDays(first, -offset);
    return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  }, [cursor, view]);

  const inMonth = (d: Date) => d.getUTCMonth() === cursor.getUTCMonth() && d.getUTCFullYear() === cursor.getUTCFullYear();

  // Pickup tab data
  const pickupChartData = useMemo(() => {
    const out: { date: string; label: string; pickup: number; bookings: number; ly: number; ma7: number; abnormal: boolean; dow: string }[] = [];
    const series: number[] = [];
    for (let i = 0; i < 90; i++) {
      const d = addDays(new Date(), i);
      const dateIso = iso(d);
      const r = rowsByDate.get(dateIso);
      if (!r) continue;
      series.push(r.pickupDelta);
      const start = Math.max(0, series.length - 7);
      const window = series.slice(start);
      const ma7 = window.reduce((a, b) => a + b, 0) / window.length;
      out.push({
        date: dateIso,
        label: dateIso.slice(5),
        pickup: r.pickupDelta,
        bookings: r.bookingsNow ?? 0,
        ly: r.bookingsLY ?? 0,
        ma7: Math.round(ma7 * 10) / 10,
        abnormal: r.abnormal,
        dow: ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"][r.dow],
      });
    }
    return out;
  }, [rowsByDate]);

  // Top movers — biggest absolute pickup deltas in next 60 days
  const topPickupDates = useMemo(() => {
    return pickupChartData
      .slice(0, 60)
      .filter(d => d.pickup !== 0)
      .sort((a, b) => Math.abs(b.pickup) - Math.abs(a.pickup))
      .slice(0, 15);
  }, [pickupChartData]);

  // Day-detail snapshots history
  const dayHistory = useMemo(() => {
    if (!selectedDate) return [];
    return snapshots.filter(s => s.stay_date === selectedDate)
      .sort((a,b) => a.captured_at.localeCompare(b.captured_at))
      .map(s => ({ at: new Date(s.captured_at).toLocaleDateString(), bookings: s.bookings_current, ly: s.bookings_last_year }));
  }, [selectedDate, snapshots]);

  const selectedRow = selectedDate ? rowsByDate.get(selectedDate) : null;

  // --- Actions ---
  async function approve(rec: Rec) {
    const { error } = await supabase.from("rate_recommendations")
      .update({ status: "approved", reviewed_by: profile?.id, reviewed_at: new Date().toISOString() }).eq("id", rec.id);
    if (error) { toast.error(error.message); return; }
    await supabase.from("rate_history").insert({
      hotel_id: hotelId!, organization_slug: profile?.organization_slug ?? "rdhotels",
      stay_date: rec.stay_date, old_rate_eur: rec.current_rate_eur,
      new_rate_eur: rec.recommended_rate_eur, source: "engine", changed_by: profile?.id, notes: rec.reason ?? null,
    });
    toast.success("Approved");
    void load();
  }

  async function createRecFromSuggestion(row: Row) {
    if (row.suggestedRate == null || row.rate == null) return;
    const { error } = await supabase.from("rate_recommendations").insert({
      hotel_id: hotelId!, organization_slug: profile?.organization_slug ?? "rdhotels",
      stay_date: row.date, current_rate_eur: row.rate,
      recommended_rate_eur: row.suggestedRate, delta_eur: row.suggestedDelta!,
      reason: `Engine: pickup Δ ${row.pickupDelta}`, status: "pending",
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Recommendation created");
    void load();
  }

  async function pushApproved() {
    setPushBusy(true);
    const { data, error } = await supabase.functions.invoke("previo-push-rates", { body: { hotel_id: hotelId } });
    setPushBusy(false);
    if (data?.code === "no_mapping") {
      toast.error("No Previo rate-plan mapping. Configure it in Pricing Strategy → Rooms Setup.", { duration: 6000 });
      setTab("strategy");
      return;
    }
    if (error || data?.error) { toast.error(data?.error || error?.message || "Failed"); return; }
    toast.success(`Rates pushed · ${data?.pushed ?? 0} updated`);
    void load();
  }

  async function runAutopilot() {
    if (!hotelId) return;
    setAutopilotBusy(true);
    toast.info("Autopilot running…");
    const { data, error } = await supabase.functions.invoke("revenue-autopilot-tick", { body: { hotel_id: hotelId } });
    setAutopilotBusy(false);
    if (error) { toast.error(error.message); return; }
    const d = data as any;
    toast.success(`Autopilot · ${d?.decisions ?? 0} decisions · ${d?.surges ?? 0} surges · ${d?.recsCreated ?? 0} new recs`);
    void load();
  }

  async function pullFromPrevio() {
    if (!hotelId) return;
    const dateFrom = iso(new Date());
    const dateTo = iso(addDays(new Date(), 120));
    toast.info("Pulling rates from Previo…");
    const { data, error } = await supabase.functions.invoke("previo-pull-rates", {
      body: { hotelId, dateFrom, dateTo }
    });
    if (error || !data?.ok) {
      toast.error(data?.error || error?.message || "Pull failed");
      return;
    }
    toast.success(`Pulled ${data.upserted ?? 0} rate snapshots from Previo`);
    load();
  }

  return (
    <div className="container mx-auto p-4 space-y-3">
      {/* Header bar — RPG style */}
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="ghost" size="sm" onClick={() => navigate(`/${organizationSlug}/revenue`)}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <h1 className="text-xl font-semibold flex-1 min-w-0 truncate">{hotelName}</h1>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" onClick={() => setCursor(c => view === "week" ? addDays(c,-7) : addDays(startOfMonth(c),-1))}><ChevronLeft className="h-4 w-4" /></Button>
          <div className="px-3 font-medium min-w-[140px] text-center">{view === "week" ? `Week of ${iso(gridDays[0]).slice(5)}` : fmtMonth(cursor)}</div>
          <Button variant="outline" size="icon" onClick={() => setCursor(c => view === "week" ? addDays(c,7) : addDays(startOfMonth(c),35))}><ChevronRight className="h-4 w-4" /></Button>
          <Button variant="ghost" size="sm" onClick={() => setCursor(startOfMonth(new Date()))}>Today</Button>
        </div>
        <div className="flex border rounded-md overflow-hidden">
          {(["week","month","quarter","year"] as const).map(v => (
            <button key={v} className={`px-3 py-1 text-sm capitalize ${view===v?"bg-primary text-primary-foreground":""}`} onClick={() => setView(v)}>{v}</button>
          ))}
        </div>
        <Button variant="outline" size="sm" onClick={() => setBulkOpen(true)}><Edit3 className="h-4 w-4 mr-1" />Bulk Edit</Button>
        <Button variant="outline" size="sm" onClick={pullFromPrevio}>
          <RefreshCw className="h-4 w-4 mr-1" />Pull from Previo
        </Button>
        <Button variant="outline" size="sm" onClick={runAutopilot} disabled={autopilotBusy}>
          {autopilotBusy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Bot className="h-4 w-4 mr-1" />}Run Autopilot
        </Button>
        <div className="flex flex-col items-end">
          <Button size="sm" onClick={pushApproved} disabled={pushBusy}>
            {pushBusy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Upload className="h-4 w-4 mr-1" />}Push to Previo
          </Button>
          {lastPushAt && (
            <span className="text-[10px] text-muted-foreground mt-0.5">
              last: {new Date(lastPushAt).toLocaleString()}
            </span>
          )}
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="prices"><CalIcon className="h-4 w-4 mr-1" />Prices</TabsTrigger>
          <TabsTrigger value="calendar"><CalIcon className="h-4 w-4 mr-1" />Strategy Calendar</TabsTrigger>
          <TabsTrigger value="events">Events</TabsTrigger>
          <TabsTrigger value="occupancy">Occupancy</TabsTrigger>
          <TabsTrigger value="pickup"><BarChart3 className="h-4 w-4 mr-1" />Pickup</TabsTrigger>
          <TabsTrigger value="minstay">Min Stay</TabsTrigger>
          <TabsTrigger value="analyst"><Bot className="h-4 w-4 mr-1" />Analyst</TabsTrigger>
          <TabsTrigger value="strategy"><Settings2 className="h-4 w-4 mr-1" />Pricing Strategy</TabsTrigger>
        </TabsList>

        <TabsContent value="prices">
          {view === "year" ? (
            <CalendarYearView monthsAhead={12} startMonth={cursor} rowsByDate={rowsByDate} onSelect={setSelectedDate} />
          ) : view === "quarter" ? (
            <CalendarQuarterView startMonth={cursor} rowsByDate={rowsByDate} onSelect={setSelectedDate} />
          ) : (
            <CalendarGrid days={gridDays} rowsByDate={rowsByDate} inMonth={inMonth} variant="prices" onSelect={setSelectedDate} />
          )}
        </TabsContent>

        <TabsContent value="occupancy">
          <CalendarGrid days={gridDays} rowsByDate={rowsByDate} inMonth={inMonth} variant="occupancy" onSelect={setSelectedDate} />
        </TabsContent>

        <TabsContent value="events">
          <EventsTab hotelId={hotelId!} orgSlug={profile?.organization_slug ?? "rdhotels"} events={events} onChange={load} />
        </TabsContent>

        <TabsContent value="minstay">
          <CalendarGrid days={gridDays} rowsByDate={rowsByDate} inMonth={inMonth} variant="minstay" onSelect={setSelectedDate} />
        </TabsContent>

        <TabsContent value="pickup">
          <PickupTab data={pickupChartData} top={topPickupDates} onSelect={setSelectedDate} />
        </TabsContent>

        <TabsContent value="analyst">
          <AnalystPanel hotelId={hotelId!} onAfterRun={load} />
        </TabsContent>

        <TabsContent value="calendar" className="space-y-3">
          <StrategyRecommendationsPanel
            recs={recs}
            decisions={decisions}
            settings={settings as any}
            hotelId={hotelId!}
            orgSlug={profile?.organization_slug ?? "rdhotels"}
            profileId={profile?.id}
            onChange={load}
          />
          <StrategyCalendar
            rowsByDate={rowsByDate}
            onSelect={setSelectedDate}
            decisionsByDate={(() => {
              const m = new Map<string, any>();
              for (const d of decisions) if (!m.has(d.stay_date)) m.set(d.stay_date, d);
              return m;
            })()}
          />
        </TabsContent>

        <TabsContent value="strategy" className="space-y-3">
          <Tabs defaultValue="rooms">
            <TabsList>
              <TabsTrigger value="rooms">Rooms Setup</TabsTrigger>
              <TabsTrigger value="dow">Day of Week</TabsTrigger>
              <TabsTrigger value="month">Monthly</TabsTrigger>
              <TabsTrigger value="lead">Lead Time</TabsTrigger>
            </TabsList>
            <TabsContent value="rooms">
              <RoomsSetupTab hotelId={hotelId!} orgSlug={profile?.organization_slug ?? "rdhotels"} />
            </TabsContent>
            <TabsContent value="dow">
              <PercentAdjustmentTab hotelId={hotelId!} orgSlug={profile?.organization_slug ?? "rdhotels"}
                table="dow_adjustments" keyColumn="dow"
                slots={[{key:0,label:"Mon"},{key:1,label:"Tue"},{key:2,label:"Wed"},{key:3,label:"Thu"},{key:4,label:"Fri"},{key:5,label:"Sat"},{key:6,label:"Sun"}]}
                title="Day-of-Week Adjustments" description="Boost or discount specific weekdays. Applied as a multiplier on top of base price." />
            </TabsContent>
            <TabsContent value="month">
              <PercentAdjustmentTab hotelId={hotelId!} orgSlug={profile?.organization_slug ?? "rdhotels"}
                table="monthly_adjustments" keyColumn="month"
                slots={MONTH_NAMES.map((m, i) => ({ key: i + 1, label: m }))}
                title="Monthly Adjustments" description="Seasonal multipliers per calendar month." />
            </TabsContent>
            <TabsContent value="lead">
              <PercentAdjustmentTab hotelId={hotelId!} orgSlug={profile?.organization_slug ?? "rdhotels"}
                table="lead_time_adjustments" keyColumn="bucket"
                slots={Object.entries(LEAD_LABELS).map(([k, v]) => ({ key: k, label: v }))}
                title="Lead Time Adjustments" description="Modify price based on how far ahead the booking is made." />
            </TabsContent>
          </Tabs>
        </TabsContent>
      </Tabs>

      {/* Day detail side panel */}
      <Sheet open={!!selectedDate} onOpenChange={(o) => !o && setSelectedDate(null)}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader><SheetTitle>{selectedDate}</SheetTitle></SheetHeader>
          {selectedRow && (
            <div className="space-y-4 mt-4 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <Stat label="Current rate" value={selectedRow.rate != null ? `€${selectedRow.rate}` : "—"} />
                <Stat label="Occupancy" value={selectedRow.occupancy != null ? `${selectedRow.occupancy}%` : "—"} />
                <Stat label="Pickup Δ" value={`${selectedRow.pickupDelta>0?"+":""}${selectedRow.pickupDelta}`}
                  positive={selectedRow.pickupDelta>0} negative={selectedRow.pickupDelta<0} />
                <Stat label="vs Last Year" value={selectedRow.bookingsLY != null ? `${selectedRow.bookingsNow}/${selectedRow.bookingsLY}` : "—"} />
              </div>

              {selectedRow.abnormal && (
                <div className="rounded border border-red-300 bg-red-50 p-2 text-red-800 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" /> Abnormal pickup detected
                </div>
              )}

              {selectedRow.events.length > 0 && (
                <div className="rounded border p-2">
                  <div className="font-semibold mb-1">Events</div>
                  {selectedRow.events.map(e => (
                    <div key={e.id} className="flex justify-between"><span>{e.title}</span><Badge variant="outline">{e.impact}</Badge></div>
                  ))}
                </div>
              )}

              {selectedRow.rec && (
                <div className="rounded border-2 border-primary/40 p-3 space-y-2">
                  <div className="font-semibold flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-purple-600" />
                    Pending recommendation
                  </div>
                  <div className="text-2xl font-bold">
                    €{selectedRow.rec.recommended_rate_eur}
                    <span className={`text-sm ml-2 ${selectedRow.rec.delta_eur>=0?"text-green-600":"text-red-600"}`}>
                      ({selectedRow.rec.delta_eur>0?"+":""}{selectedRow.rec.delta_eur}€)
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">{selectedRow.rec.reason}</div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => approve(selectedRow.rec!)}><Check className="h-4 w-4 mr-1" />Approve</Button>
                    <Button size="sm" variant="outline" onClick={async () => {
                      const v = prompt("New rate €", String(selectedRow.rec!.recommended_rate_eur));
                      if (!v) return;
                      const newRate = parseFloat(v);
                      if (Number.isNaN(newRate)) return;
                      await supabase.from("rate_recommendations").update({
                        status: "overridden", recommended_rate_eur: newRate,
                        reviewed_by: profile?.id, reviewed_at: new Date().toISOString(),
                      }).eq("id", selectedRow.rec!.id);
                      await supabase.from("rate_history").insert({
                        hotel_id: hotelId!, organization_slug: profile?.organization_slug ?? "rdhotels",
                        stay_date: selectedRow.rec!.stay_date, old_rate_eur: selectedRow.rec!.current_rate_eur,
                        new_rate_eur: newRate, source: "manual", changed_by: profile?.id, notes: "manual override",
                      });
                      toast.success("Overridden"); void load();
                    }}><Edit3 className="h-4 w-4 mr-1" />Override</Button>
                    <Button size="sm" variant="ghost" onClick={async () => {
                      await supabase.from("rate_recommendations").update({ status: "expired" }).eq("id", selectedRow.rec!.id);
                      void load();
                    }}><X className="h-4 w-4" /></Button>
                  </div>
                </div>
              )}

              {!selectedRow.rec && selectedRow.suggestedRate != null && (
                <div className="rounded border p-3 space-y-2">
                  <div className="font-semibold">Engine suggests</div>
                  <div className="text-2xl font-bold">
                    €{selectedRow.suggestedRate}
                    <span className={`text-sm ml-2 ${selectedRow.suggestedDelta!>=0?"text-green-600":"text-red-600"}`}>
                      ({selectedRow.suggestedDelta!>0?"+":""}{selectedRow.suggestedDelta}€)
                    </span>
                  </div>
                  <Button size="sm" onClick={() => createRecFromSuggestion(selectedRow)}>
                    <Plus className="h-4 w-4 mr-1" />Create recommendation
                  </Button>
                </div>
              )}

              {(selectedRow as any).pricingResult && (
                <PricingDriverChips result={(selectedRow as any).pricingResult} />
              )}

              <div>
                <div className="font-semibold mb-2">Pickup history</div>
                <div className="h-40">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={dayHistory}>
                      <XAxis dataKey="at" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <RTooltip />
                      <Line type="monotone" dataKey="bookings" stroke="hsl(var(--primary))" strokeWidth={2} />
                      <Line type="monotone" dataKey="ly" stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <GuestsOnDate hotelId={hotelId!} date={selectedDate!} />

              <DayMinStayEditor hotelId={hotelId!} orgSlug={profile?.organization_slug ?? "rdhotels"}
                date={selectedDate!} value={selectedRow.minNights ?? 1} onSaved={load} />
            </div>
          )}
        </SheetContent>
      </Sheet>

      <BulkEditDialog open={bulkOpen} onClose={() => setBulkOpen(false)} hotelId={hotelId!}
        orgSlug={profile?.organization_slug ?? "rdhotels"} userId={profile?.id} rowsByDate={rowsByDate} onSaved={load} />
    </div>
  );
}

// --- Unified calendar grid: rate + occupancy + pickup + min stay + events ---
function CalendarGrid({ days, rowsByDate, inMonth, variant, onSelect }: {
  days: Date[]; rowsByDate: Map<string, any>; inMonth: (d: Date) => boolean;
  variant: "prices"|"occupancy"|"minstay"; onSelect: (d: string) => void;
}) {
  return (
    <Card>
      <CardContent className="p-2">
        <div className="grid grid-cols-7 gap-1 mb-1">
          {DOW_LABELS.map(d => <div key={d} className="text-center text-xs font-semibold text-muted-foreground py-1">{d}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {days.map(d => {
            const date = iso(d);
            const r = rowsByDate.get(date) as any;
            const muted = !inMonth(d);
            const occ = r?.occupancy as number | null;
            const occColor = occ == null ? "" : occ >= 85 ? "bg-red-500" : occ >= 60 ? "bg-amber-400" : "bg-emerald-500";
            const isRealRate = r?.rateSource === "previo_realized";
            return (
              <button key={date} onClick={() => onSelect(date)}
                className={`min-h-[112px] rounded-lg border text-left p-2 transition hover:border-primary
                  ${muted ? "opacity-40" : ""}
                  ${r?.abnormal ? "border-red-500 ring-1 ring-red-300" : ""}
                  ${r?.events?.length ? "bg-purple-50/40" : ""}`}>
                <div className="flex items-center justify-between text-xs">
                  <span className={`font-semibold ${r?.isWeekend ? "text-purple-700" : ""}`}>{d.getUTCDate()}</span>
                  <div className="flex items-center gap-1">
                    {r?.minNights && r.minNights > 1 && (
                      <span className="text-[10px] px-1 rounded bg-slate-100 text-slate-700" title={`Min ${r.minNights} nights`}>≥{r.minNights}n</span>
                    )}
                    {r?.events?.length > 0 && (
                      <span className="text-[10px] text-purple-700" title={r.events.map((e: any) => e.title).join(", ")}>★</span>
                    )}
                  </div>
                </div>

                {/* Rate row */}
                <div className="mt-1 flex items-baseline gap-1">
                  <div className="text-base font-bold leading-none">
                    {r?.rate != null ? `€${r.rate}` : <span className="text-muted-foreground text-sm font-normal">—</span>}
                  </div>
                  {r?.rate != null && (
                    <span className={`text-[9px] uppercase tracking-wide ${isRealRate ? "text-emerald-700" : "text-muted-foreground"}`}
                          title={isRealRate ? "From booked reservations (Previo)" : "Default / manual baseline"}>
                      {isRealRate ? "live" : "base"}
                    </span>
                  )}
                </div>
                {r?.rec && (
                  <div className={`mt-0.5 inline-flex items-center gap-1 text-[10px] px-1 py-0.5 rounded
                    ${r.rec.delta_eur>=0?"bg-green-100 text-green-800":"bg-red-100 text-red-700"}`}>
                    {r.rec.delta_eur>=0 ? <TrendingUp className="h-2.5 w-2.5"/> : <TrendingDown className="h-2.5 w-2.5"/>}
                    €{r.rec.recommended_rate_eur}
                  </div>
                )}
                {!r?.rec && r?.suggestedRate != null && (
                  <div className={`mt-0.5 inline-flex items-center gap-1 text-[10px] px-1 py-0.5 rounded border
                    ${r.suggestedDelta>=0?"text-green-700 border-green-300":"text-red-700 border-red-300"}`}>
                    {r.suggestedDelta>=0 ? <TrendingUp className="h-2.5 w-2.5"/> : <TrendingDown className="h-2.5 w-2.5"/>}
                    €{r.suggestedRate}
                  </div>
                )}

                {/* Occupancy bar */}
                <div className="mt-1.5">
                  {occ != null ? (
                    <>
                      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                        <span>Occ</span><span className="font-medium text-foreground">{Math.round(occ)}%</span>
                      </div>
                      <div className="h-1 rounded bg-muted overflow-hidden">
                        <div className={`h-full ${occColor}`} style={{ width: `${Math.min(100, occ)}%` }} />
                      </div>
                    </>
                  ) : (
                    <div className="text-[10px] text-muted-foreground">No occ data</div>
                  )}
                </div>

                {/* Pickup chip */}
                {r?.pickupDelta ? (
                  <div className={`mt-1 inline-flex items-center gap-0.5 text-[9px] font-medium px-1 rounded
                    ${r.pickupDelta > 0 ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
                    {r.pickupDelta > 0 ? <TrendingUp className="h-2.5 w-2.5"/> : <TrendingDown className="h-2.5 w-2.5"/>}
                    Pickup {r.pickupDelta > 0 ? "+" : ""}{r.pickupDelta}
                  </div>
                ) : null}
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, positive, negative }: { label: string; value: string; positive?: boolean; negative?: boolean }) {
  return (
    <div className="rounded border p-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold ${positive?"text-green-600":negative?"text-red-600":""}`}>{value}</div>
    </div>
  );
}

function PickupTab({ data, top, onSelect }: {
  data: { date: string; label: string; pickup: number; bookings: number; ly: number; ma7: number; abnormal: boolean; dow: string }[];
  top: { date: string; pickup: number; bookings: number; ly: number; dow: string; abnormal: boolean }[];
  onSelect: (date: string) => void;
}) {
  // 90-day heatmap (rows = weeks, cols = Mon-Sun)
  const heatmap = useMemo(() => {
    const cells: { date: string; pickup: number; abnormal: boolean }[] = data.map(d => ({ date: d.date, pickup: d.pickup, abnormal: d.abnormal }));
    return cells;
  }, [data]);
  const maxAbs = Math.max(1, ...heatmap.map(c => Math.abs(c.pickup)));

  function colorFor(p: number, abnormal: boolean): string {
    if (abnormal) return "bg-red-600/80 text-white";
    if (p === 0) return "bg-muted text-muted-foreground";
    const intensity = Math.min(1, Math.abs(p) / maxAbs);
    if (p > 0) {
      if (intensity > 0.66) return "bg-emerald-600 text-white";
      if (intensity > 0.33) return "bg-emerald-500/70";
      return "bg-emerald-500/30";
    }
    if (intensity > 0.66) return "bg-red-600 text-white";
    if (intensity > 0.33) return "bg-red-500/70";
    return "bg-red-500/30";
  }

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <BarChart3 className="h-4 w-4" /> Pickup heatmap (next 90 days)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground mb-2">
            <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-emerald-600" /> Strong increase</span>
            <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-emerald-500/30" /> Mild increase</span>
            <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-muted" /> No change</span>
            <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-500/30" /> Mild decrease</span>
            <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-600" /> Strong decrease</span>
            <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-600/80 ring-1 ring-red-900" /> Abnormal</span>
          </div>
          <div className="grid grid-cols-7 gap-1 text-[10px] text-center text-muted-foreground mb-1">
            {["Mo","Tu","We","Th","Fr","Sa","Su"].map(l => <div key={l}>{l}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {heatmap.map((c) => (
              <button
                key={c.date}
                type="button"
                onClick={() => onSelect(c.date)}
                title={`${c.date} · pickup ${c.pickup > 0 ? "+" : ""}${c.pickup}${c.abnormal ? " · ABNORMAL" : ""}`}
                className={`aspect-square rounded text-[10px] font-semibold flex flex-col items-center justify-center hover:ring-2 hover:ring-primary transition ${colorFor(c.pickup, c.abnormal)}`}
              >
                <span>{c.date.slice(8, 10)}</span>
                {c.pickup !== 0 && <span className="text-[9px] opacity-80">{c.pickup > 0 ? "+" : ""}{c.pickup}</span>}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Top pickup dates (next 60 days)</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {top.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">No pickup activity yet — upload a Previo report to populate this list.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr className="text-left">
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Day</th>
                    <th className="px-3 py-2 text-right">Bookings now</th>
                    <th className="px-3 py-2 text-right">Last year</th>
                    <th className="px-3 py-2 text-right">Δ</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {top.map(t => (
                    <tr key={t.date} className={`border-t hover:bg-muted/30 ${t.abnormal ? "bg-red-50" : ""}`}>
                      <td className="px-3 py-2 font-mono">{t.date}</td>
                      <td className="px-3 py-2">{t.dow}</td>
                      <td className="px-3 py-2 text-right">{t.bookings}</td>
                      <td className="px-3 py-2 text-right text-muted-foreground">{t.ly}</td>
                      <td className={`px-3 py-2 text-right font-semibold ${t.pickup > 0 ? "text-emerald-700" : "text-red-700"}`}>
                        {t.pickup > 0 ? "+" : ""}{t.pickup}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button size="sm" variant="ghost" onClick={() => onSelect(t.date)}>Open</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Daily pickup with 7-day moving average</CardTitle>
        </CardHeader>
        <CardContent className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data}>
              <XAxis dataKey="label" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <RTooltip />
              <Bar dataKey="pickup" fill="hsl(var(--primary))" />
              <Line type="monotone" dataKey="ma7" stroke="hsl(var(--destructive))" strokeWidth={2} dot={false} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Bookings on the books vs Last Year</CardTitle>
        </CardHeader>
        <CardContent className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <XAxis dataKey="label" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <RTooltip />
              <Line type="monotone" dataKey="bookings" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} name="This year" />
              <Line type="monotone" dataKey="ly" stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" dot={false} name="Last year" />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}

function EventsTab({ hotelId, orgSlug, events, onChange }: { hotelId: string; orgSlug: string; events: Event[]; onChange: () => void }) {
  const [form, setForm] = useState({ event_date: "", title: "", impact: "medium", notes: "" });
  async function add() {
    if (!form.event_date || !form.title) { toast.error("Date and title required"); return; }
    const { error } = await (supabase as any).from("hotel_events").insert({
      hotel_id: hotelId, organization_slug: orgSlug, ...form,
    });
    if (error) { toast.error(error.message); return; }
    setForm({ event_date: "", title: "", impact: "medium", notes: "" });
    onChange();
  }
  async function remove(id: string) {
    await (supabase as any).from("hotel_events").delete().eq("id", id);
    onChange();
  }
  return (
    <div className="space-y-4">
      <Card><CardContent className="p-4 space-y-3">
        <div className="text-sm font-semibold">Hotel-specific events</div>
        <div className="grid md:grid-cols-5 gap-2">
          <Input type="date" value={form.event_date} onChange={e => setForm({...form, event_date: e.target.value})} />
          <Input className="md:col-span-2" placeholder="Event title" value={form.title} onChange={e => setForm({...form, title: e.target.value})} />
          <Select value={form.impact} onValueChange={v => setForm({...form, impact: v})}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="low">Low impact</SelectItem>
              <SelectItem value="medium">Medium impact</SelectItem>
              <SelectItem value="high">High impact</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={add}><Plus className="h-4 w-4 mr-1" />Add</Button>
        </div>
        <div className="border rounded divide-y">
          {events.length === 0 && <div className="p-3 text-sm text-muted-foreground">No events yet.</div>}
          {events.map(e => (
            <div key={e.id} className="flex items-center justify-between p-2 text-sm">
              <div><span className="font-mono">{e.event_date}</span> · <b>{e.title}</b> <Badge variant="outline" className="ml-1">{e.impact}</Badge></div>
              <Button size="icon" variant="ghost" onClick={() => remove(e.id)}><X className="h-4 w-4" /></Button>
            </div>
          ))}
        </div>
      </CardContent></Card>
      <MarketEventsPanel hotelId={hotelId} orgSlug={orgSlug} onCopied={onChange} />
    </div>
  );
}

function MarketEventsPanel({ hotelId, orgSlug, onCopied }: { hotelId: string; orgSlug: string; onCopied: () => void }) {
  const [items, setItems] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<string>("all");
  async function load() {
    const today = new Date().toISOString().slice(0, 10);
    const { data } = await (supabase as any).from("market_events")
      .select("*").eq("city", "budapest").gte("event_date", today)
      .order("event_date", { ascending: true }).limit(200);
    setItems(data ?? []);
  }
  useEffect(() => { void load(); }, []);
  async function refreshAI() {
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("revenue-events-fetch", { body: {} });
    setBusy(false);
    if (error || (data && data.ok === false)) { toast.error(data?.error || error?.message || "Failed"); return; }
    toast.success(`Refreshed: ${data?.added ?? 0} events added`);
    void load();
  }
  async function copyToHotel(e: any) {
    const { error } = await (supabase as any).from("hotel_events").insert({
      hotel_id: hotelId, organization_slug: orgSlug,
      event_date: e.event_date, title: e.title, impact: e.expected_impact || "medium",
      notes: [e.venue, e.url].filter(Boolean).join(" · "),
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Added to hotel events"); onCopied();
  }
  const filtered = filter === "all" ? items : items.filter(i => i.expected_impact === filter);
  return (
    <Card><CardContent className="p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-sm font-semibold">Budapest market events (AI)</div>
        <div className="flex gap-2 items-center">
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All impact</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="low">Low</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={refreshAI} disabled={busy}>
            {busy ? "Loading…" : "Refresh from AI"}
          </Button>
        </div>
      </div>
      <div className="border rounded divide-y max-h-[420px] overflow-auto">
        {filtered.length === 0 && (
          <div className="p-3 text-sm text-muted-foreground">
            No events yet. Click "Refresh from AI" to fetch upcoming Budapest events.
          </div>
        )}
        {filtered.map(e => (
          <div key={e.id} className="flex items-center justify-between gap-2 p-2 text-sm">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-xs">{e.event_date}{e.end_date && e.end_date !== e.event_date ? `→${e.end_date}` : ""}</span>
                <b className="truncate">{e.title}</b>
                <Badge variant={e.expected_impact === "high" ? "destructive" : "outline"}>{e.expected_impact}</Badge>
                {e.category && <Badge variant="outline">{e.category}</Badge>}
              </div>
              {(e.venue || e.url) && (
                <div className="text-xs text-muted-foreground truncate">
                  {e.venue}{e.url && <> · <a href={e.url} target="_blank" rel="noreferrer" className="underline">link</a></>}
                </div>
              )}
            </div>
            <Button size="sm" variant="ghost" onClick={() => copyToHotel(e)}>Add to hotel</Button>
          </div>
        ))}
      </div>
    </CardContent></Card>
  );
}

function DayMinStayEditor({ hotelId, orgSlug, date, value, onSaved }: { hotelId: string; orgSlug: string; date: string; value: number; onSaved: () => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value, date]);
  async function save() {
    const { error } = await (supabase as any).from("min_stay_rules")
      .upsert({ hotel_id: hotelId, organization_slug: orgSlug, stay_date: date, min_nights: v }, { onConflict: "hotel_id,stay_date" });
    if (error) { toast.error(error.message); return; }
    toast.success("Min stay saved"); onSaved();
  }
  return (
    <div className="rounded border p-2">
      <div className="font-semibold mb-1">Min stay</div>
      <div className="flex gap-2 items-center">
        <Input type="number" min={1} value={v} onChange={e => setV(parseInt(e.target.value)||1)} className="w-24" />
        <span className="text-sm text-muted-foreground">nights</span>
        <Button size="sm" onClick={save}>Save</Button>
      </div>
    </div>
  );
}

function BulkEditDialog({ open, onClose, hotelId, orgSlug, userId, rowsByDate, onSaved }: {
  open: boolean; onClose: () => void; hotelId: string; orgSlug: string; userId?: string;
  rowsByDate: Map<string, Row>; onSaved: () => void;
}) {
  const [from, setFrom] = useState(iso(new Date()));
  const [to, setTo] = useState(iso(addDays(new Date(), 30)));
  const [mode, setMode] = useState<"percent"|"absolute">("percent");
  const [amount, setAmount] = useState(5);
  const [busy, setBusy] = useState(false);

  async function apply() {
    if (!from || !to) return;
    setBusy(true);
    const recs: any[] = [];
    const start = new Date(from); const end = new Date(to);
    for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
      const date = iso(d);
      const row = rowsByDate.get(date);
      if (!row?.rate) continue;
      const newRate = mode === "percent" ? Math.round(row.rate * (1 + amount/100)) : Math.round(row.rate + amount);
      const delta = newRate - row.rate;
      if (delta === 0) continue;
      recs.push({
        hotel_id: hotelId, organization_slug: orgSlug, stay_date: date,
        current_rate_eur: row.rate, recommended_rate_eur: newRate, delta_eur: delta,
        reason: `Bulk edit: ${mode==="percent"?`${amount>0?"+":""}${amount}%`:`${amount>0?"+":""}€${amount}`}`,
        status: "approved", reviewed_by: userId, reviewed_at: new Date().toISOString(),
      });
    }
    if (recs.length === 0) { setBusy(false); toast.error("No dates with prices in range"); return; }
    const { error } = await supabase.from("rate_recommendations").insert(recs);
    if (error) { setBusy(false); toast.error(error.message); return; }
    // log to history
    await supabase.from("rate_history").insert(recs.map(r => ({
      hotel_id: r.hotel_id, organization_slug: r.organization_slug, stay_date: r.stay_date,
      old_rate_eur: r.current_rate_eur, new_rate_eur: r.recommended_rate_eur, source: "bulk" as const,
      changed_by: userId, notes: r.reason,
    })));
    setBusy(false);
    toast.success(`Approved ${recs.length} dates`);
    onClose(); onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Bulk Edit Prices</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div><Label>From</Label><Input type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
            <div><Label>To</Label><Input type="date" value={to} onChange={e => setTo(e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Mode</Label>
              <Select value={mode} onValueChange={v => setMode(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="percent">Percent (%)</SelectItem>
                  <SelectItem value="absolute">Absolute (€)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Amount {mode === "percent" ? "(%)" : "(€)"}</Label>
              <Input type="number" value={amount} onChange={e => setAmount(parseFloat(e.target.value)||0)} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Creates approved recommendations and logs them to history. Click <b>Upload Prices</b> after to push to Previo.
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={apply} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Check className="h-4 w-4 mr-1" />}Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GuestsOnDate({ hotelId, date }: { hotelId: string; date: string }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("reservations")
        .select("id, status, check_in_date, check_out_date, adults, children, source, room_id, guest:guests(first_name, last_name), room:rooms(room_number)")
        .eq("hotel_id", hotelId)
        .lte("check_in_date", date)
        .gt("check_out_date", date)
        .in("status", ["confirmed", "checked_in"])
        .limit(200);
      if (!cancelled) { setRows(data ?? []); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [hotelId, date]);

  return (
    <div className="rounded border p-2">
      <div className="font-semibold mb-2">Guests staying on {date}</div>
      {loading ? (
        <div className="text-xs text-muted-foreground">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="text-xs text-muted-foreground">No reservations on the books for this date.</div>
      ) : (
        <div className="space-y-1 text-xs max-h-48 overflow-y-auto">
          <div className="text-muted-foreground">{rows.length} reservation{rows.length === 1 ? "" : "s"} · {rows.reduce((a, r) => a + (r.adults || 0) + (r.children || 0), 0)} pax</div>
          {rows.map((r) => (
            <div key={r.id} className="flex items-center justify-between border-t pt-1">
              <span className="truncate">
                {r.room?.room_number ? <b className="font-mono mr-1">{r.room.room_number}</b> : null}
                {r.guest ? `${r.guest.first_name} ${r.guest.last_name}` : "(no guest)"}
              </span>
              <span className="text-muted-foreground shrink-0 ml-2">
                {r.adults + (r.children || 0)}p · {r.source || "direct"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}