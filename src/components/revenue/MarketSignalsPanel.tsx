import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { CalendarDays, ChevronDown, Gauge, Loader2, Plus, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  BAND_CLASS, BAND_LABEL, buildDemandBoard, type DemandDay, type DemandEvent,
} from "@/lib/demandScore";

interface HotelEvent {
  id: string;
  title: string;
  category: string | null;
  impact: string | null;
  event_date: string;
  end_date: string | null;
}

const CATEGORIES = ["conference", "concert", "sports", "festival", "holiday", "fair", "closure", "other"];
const IMPACTS = [
  { value: "very_high", label: "Very high demand" },
  { value: "high", label: "High demand" },
  { value: "medium", label: "Medium demand" },
  { value: "low", label: "Low demand" },
  { value: "negative", label: "Demand negative" },
];
const BOARD_DAYS = 60;

function fmt(d: string) {
  return new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, {
    timeZone: "UTC", weekday: "short", day: "numeric", month: "short",
  });
}
const todayIso = () => new Date().toISOString().slice(0, 10);

/**
 * Demand board — a manual, old-school demand grade per arrival date, blended with a
 * transparent index computed from our own booking data (pace, pickup, supply pressure,
 * lead time) plus manager-recorded events. No external market feeds.
 */
export default function MarketSignalsPanel({ hotelId }: { hotelId: string | null }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [board, setBoard] = useState<DemandDay[]>([]);
  const [events, setEvents] = useState<HotelEvent[]>([]);
  const [orgSlug, setOrgSlug] = useState<string | null>(null);
  const [openDate, setOpenDate] = useState<string | null>(null);
  const [gradeValue, setGradeValue] = useState(60);
  const [gradeNote, setGradeNote] = useState("");

  // event form
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("conference");
  const [impact, setImpact] = useState("high");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const today = useMemo(todayIso, []);
  const horizon = useMemo(
    () => new Date(Date.parse(`${today}T00:00:00Z`) + BOARD_DAYS * 86400000).toISOString().slice(0, 10),
    [today],
  );

  const load = useCallback(async () => {
    if (!hotelId) { setLoading(false); return; }
    setLoading(true);

    const { data: session } = await supabase.auth.getUser();
    const { data: profile } = await supabase.from("profiles")
      .select("organization_slug").eq("id", session.user?.id ?? "").maybeSingle();
    setOrgSlug(profile?.organization_slug ?? null);

    const [{ data: nights }, { data: he }, { data: me }, { data: ov }, { data: settings }, { data: types }] =
      await Promise.all([
        supabase.from("revenue_booking_nights")
          .select("stay_date, created_at_pms")
          .eq("hotel_id", hotelId).gte("stay_date", today).lte("stay_date", horizon)
          .limit(20000),
        supabase.from("hotel_events")
          .select("id,title,category,impact,event_date,end_date")
          .eq("hotel_id", hotelId).gte("event_date", today).order("event_date").limit(100),
        supabase.from("market_events")
          .select("title,expected_impact,event_date,end_date")
          .gte("event_date", today).order("event_date").limit(100),
        supabase.from("demand_overrides")
          .select("stay_date, score, note")
          .eq("hotel_id", hotelId).gte("stay_date", today).lte("stay_date", horizon),
        supabase.from("hotel_revenue_settings").select("sellable_rooms").eq("hotel_id", hotelId).maybeSingle(),
        supabase.from("room_types")
          .select("num_rooms, is_sellable, counts_toward_inventory").eq("hotel_id", hotelId),
      ]);

    const inventory = (types ?? [])
      .filter((r) => r.is_sellable !== false && r.counts_toward_inventory !== false)
      .reduce((s, r) => s + (r.num_rooms || 0), 0);
    const roomsAvailable = Number(settings?.sellable_rooms ?? 0) || inventory || 0;

    const eventsByDate = new Map<string, DemandEvent[]>();
    const spread = (from: string, to: string | null, e: DemandEvent) => {
      const end = to || from;
      for (let d = from; d <= end;) {
        const list = eventsByDate.get(d) ?? [];
        list.push(e);
        eventsByDate.set(d, list);
        d = new Date(Date.parse(`${d}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
      }
    };
    for (const e of he ?? []) {
      spread(e.event_date, e.end_date, { title: e.title, impact: e.impact, source: "hotel" });
    }
    for (const e of me ?? []) {
      spread(e.event_date, e.end_date, { title: e.title, impact: e.expected_impact, source: "market" });
    }

    const overridesByDate = new Map<string, { score: number; note: string | null }>();
    for (const o of ov ?? []) overridesByDate.set(o.stay_date, { score: Number(o.score), note: o.note });

    setEvents((he ?? []) as HotelEvent[]);
    setBoard(buildDemandBoard({
      nights: (nights ?? []) as { stay_date: string; created_at_pms: string | null }[],
      today, days: BOARD_DAYS, roomsAvailable, eventsByDate, overridesByDate,
    }));
    setLoading(false);
  }, [hotelId, today, horizon]);

  useEffect(() => { void load(); }, [load]);

  const openGrade = (day: DemandDay) => {
    if (openDate === day.date) { setOpenDate(null); return; }
    setOpenDate(day.date);
    setGradeValue(day.score);
    setGradeNote(day.note ?? "");
  };

  const saveGrade = async (date: string) => {
    if (!hotelId) return;
    setSaving(true);
    try {
      const { data: session } = await supabase.auth.getUser();
      const { error } = await supabase.from("demand_overrides").upsert({
        hotel_id: hotelId,
        organization_slug: orgSlug,
        stay_date: date,
        score: gradeValue,
        note: gradeNote.trim() || null,
        created_by: session.user?.id ?? null,
      }, { onConflict: "hotel_id,stay_date" });
      if (error) throw error;
      toast.success(`Demand for ${fmt(date)} graded ${gradeValue}/100`);
      setOpenDate(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the grade");
    } finally {
      setSaving(false);
    }
  };

  const clearGrade = async (date: string) => {
    if (!hotelId) return;
    const { error } = await supabase.from("demand_overrides")
      .delete().eq("hotel_id", hotelId).eq("stay_date", date);
    if (error) { toast.error("Could not reset the grade"); return; }
    setOpenDate(null);
    await load();
  };

  const addEvent = async () => {
    if (!hotelId || !title.trim() || !startDate) { toast.error("Add a title and a start date"); return; }
    setSaving(true);
    try {
      const { data: session } = await supabase.auth.getUser();
      const { error } = await supabase.from("hotel_events").insert({
        hotel_id: hotelId,
        organization_slug: orgSlug,
        title: title.trim(), category, impact,
        event_date: startDate, end_date: endDate || startDate,
        created_by: session.user?.id ?? null,
      });
      if (error) throw error;
      setTitle(""); setStartDate(""); setEndDate("");
      toast.success("Event added — demand recalculated");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the event");
    } finally {
      setSaving(false);
    }
  };

  const removeEvent = async (id: string) => {
    const { error } = await supabase.from("hotel_events").delete().eq("id", id);
    if (error) { toast.error("Could not remove the event"); return; }
    await load();
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Gauge className="h-4 w-4 text-primary" />
          Demand board
        </CardTitle>
        <p className="text-[11px] text-muted-foreground">
          Every arrival date is graded 0–100 from your own booking data — pace against comparable
          weekdays, pickup momentum, rooms left this close to arrival, and the events you record.
          Set your own grade on any date and it overrides the calculation, exactly like the old
          demand book. Grades never change a price on their own; they steer the AI analyst.
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Building the demand board…
          </div>
        ) : (
          <ul className="divide-y rounded-md border max-h-[520px] overflow-y-auto">
            {board.map((d) => (
              <li key={d.date} className="p-2.5">
                <button type="button" className="w-full text-left" onClick={() => openGrade(d)}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{fmt(d.date)}</p>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {d.drivers.slice(0, 2).join(" · ")}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-sm font-semibold tabular-nums">{d.score}</span>
                      <Badge className={`text-[10px] font-normal ${BAND_CLASS[d.band]}`}>
                        {BAND_LABEL[d.band]}
                      </Badge>
                      {d.manual && (
                        <Badge variant="outline" className="text-[10px] font-normal">Manual</Badge>
                      )}
                      <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${openDate === d.date ? "rotate-180" : ""}`} />
                    </div>
                  </div>
                </button>

                {openDate === d.date && (
                  <div className="mt-3 space-y-3 rounded-md bg-muted/40 p-3">
                    <ul className="space-y-0.5">
                      {d.drivers.map((x, i) => (
                        <li key={i} className="text-[11px] text-muted-foreground">• {x}</li>
                      ))}
                    </ul>
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span>Your grade</span>
                        <span className="font-semibold tabular-nums">{gradeValue}/100</span>
                      </div>
                      <Slider value={[gradeValue]} min={0} max={100} step={1}
                        onValueChange={(v) => setGradeValue(v[0])} aria-label="Demand grade" />
                    </div>
                    <Input className="h-9" placeholder="Why? e.g. town full, medical congress"
                      value={gradeNote} onChange={(e) => setGradeNote(e.target.value)} />
                    <div className="flex gap-2">
                      <Button size="sm" className="h-9 flex-1" disabled={saving}
                        onClick={() => saveGrade(d.date)}>
                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save grade"}
                      </Button>
                      {d.manual && (
                        <Button size="sm" variant="outline" className="h-9" onClick={() => clearGrade(d.date)}>
                          <RotateCcw className="h-4 w-4 mr-1.5" /> Use calculated
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="outline" size="sm" className="h-9 w-full justify-between">
              <span className="flex items-center gap-2">
                <CalendarDays className="h-4 w-4" /> Events ({events.length})
              </span>
              <ChevronDown className="h-4 w-4" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-3 space-y-3">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
              <Input className="lg:col-span-2 h-9" placeholder="Event name (e.g. Sziget Festival)"
                value={title} onChange={(e) => setTitle(e.target.value)} />
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="h-9 text-xs" aria-label="Event category"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={impact} onValueChange={setImpact}>
                <SelectTrigger className="h-9 text-xs" aria-label="Expected impact"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {IMPACTS.map((i) => <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input type="date" className="h-9" aria-label="Start date"
                value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              <div className="flex gap-2">
                <Input type="date" className="h-9" aria-label="End date"
                  value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                <Button size="sm" className="h-9 shrink-0" onClick={addEvent} disabled={saving || !hotelId}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            {events.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No events recorded. Add the ones you already know about — group stays, closures, local demand drivers.
              </p>
            ) : (
              <ul className="divide-y rounded-md border">
                {events.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-2 p-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{e.title}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {fmt(e.event_date)}
                        {e.end_date && e.end_date !== e.event_date ? ` – ${fmt(e.end_date)}` : ""}
                        {e.category ? ` · ${e.category}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {e.impact && (
                        <Badge variant="secondary" className="text-[10px] font-normal capitalize">
                          {e.impact.replace(/_/g, " ")}
                        </Badge>
                      )}
                      <Button size="icon" variant="ghost" className="h-8 w-8"
                        aria-label={`Remove ${e.title}`} onClick={() => removeEvent(e.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
