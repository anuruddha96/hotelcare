import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Loader2, Plus, Repeat, Settings2, Sparkles, Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export interface DemandEventRow {
  id: string;
  organization_slug: string;
  hotel_id: string | null;
  city: string;
  country: string;
  title: string;
  category: string;
  venue: string | null;
  event_date: string;
  end_date: string | null;
  expected_impact: string;
  recurs_annually: boolean;
  notes: string | null;
  source: string;
  confidence: number | null;
  approved: boolean;
}

interface Candidate {
  event_date: string;
  end_date: string | null;
  title: string;
  category: string;
  venue: string | null;
  expected_impact: string;
  recurs_annually: boolean;
  url: string | null;
  confidence: number | null;
  city: string;
  country: string;
}

const CATEGORIES = ["concert", "festival", "sports", "conference", "fair", "holiday", "other"];
const IMPACTS = [
  { value: "high", label: "High impact" },
  { value: "medium", label: "Medium impact" },
  { value: "low", label: "Low impact" },
];

const monthKey = (d: Date) => d.toISOString().slice(0, 7);
const fmtMonth = (m: string) =>
  new Date(`${m}-01T00:00:00Z`).toLocaleDateString(undefined, { timeZone: "UTC", month: "long", year: "numeric" });
const fmtDay = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { timeZone: "UTC", day: "numeric", month: "short" });

const impactTone = (impact: string) =>
  impact === "high" ? "bg-red-100 text-red-700"
    : impact === "medium" ? "bg-amber-100 text-amber-700"
    : "bg-muted text-muted-foreground";

/**
 * The demand events calendar: manual entries plus an on-demand AI search for a
 * chosen city and month. Nothing found by AI is used until it is approved here.
 */
export default function EventsPanel({ hotelId, selectedMonth }: { hotelId: string | null; selectedMonth?: string }) {
  const [orgSlug, setOrgSlug] = useState<string | null>(null);
  const [month, setMonth] = useState(() => selectedMonth ?? monthKey(new Date()));
  const [city, setCity] = useState("Budapest");
  const [country, setCountry] = useState("Hungary");
  const [events, setEvents] = useState<DemandEventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [picked, setPicked] = useState<Record<number, boolean>>({});

  // manual form
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("conference");
  const [impact, setImpact] = useState("high");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [venue, setVenue] = useState("");
  const [recurring, setRecurring] = useState(false);

  useEffect(() => {
    if (selectedMonth) setMonth(selectedMonth);
  }, [selectedMonth]);

  const range = useMemo(() => {
    const start = `${month}-01`;
    const end = new Date(`${start}T00:00:00Z`);
    end.setUTCMonth(end.getUTCMonth() + 1);
    end.setUTCDate(0);
    return { start, end: end.toISOString().slice(0, 10) };
  }, [month]);

  useEffect(() => {
    if (selectedMonth) setMonth(selectedMonth);
  }, [selectedMonth]);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: session } = await supabase.auth.getUser();
    const { data: profile } = await supabase
      .from("profiles").select("organization_slug").eq("id", session.user?.id ?? "").maybeSingle();
    const slug = profile?.organization_slug ?? null;
    setOrgSlug(slug);

    if (hotelId) {
      const { data: settings } = await (supabase as any)
        .from("hotel_revenue_settings")
        .select("market_city, market_country")
        .eq("hotel_id", hotelId)
        .maybeSingle();
      if (settings?.market_city) setCity(settings.market_city);
      if (settings?.market_country) setCountry(settings.market_country);
    }

    if (!slug) { setEvents([]); setLoading(false); return; }
    const { data } = await (supabase as any)
      .from("demand_events")
      .select("*")
      .eq("organization_slug", slug)
      .order("event_date", { ascending: true })
      .limit(1000);

    // Annual events are stored once and projected onto the month being viewed.
    const rows = ((data ?? []) as DemandEventRow[]).filter((row) => {
      if (!row.recurs_annually) return row.event_date <= range.end && (row.end_date ?? row.event_date) >= range.start;
      return String(row.event_date).slice(5, 7) === month.slice(5, 7);
    });
    setEvents(rows);
    setLoading(false);
  }, [hotelId, month, range.start, range.end]);

  useEffect(() => { void load(); }, [load]);

  const shiftMonth = (delta: number) => {
    const d = new Date(`${month}-01T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + delta);
    setMonth(monthKey(d));
    setCandidates(null);
  };

  const saveLocation = async () => {
    if (!hotelId) return;
    const { error } = await (supabase as any)
      .from("hotel_revenue_settings")
      .update({ market_city: city, market_country: country })
      .eq("hotel_id", hotelId);
    if (error) toast.error(error.message);
    else toast.success(`Event searches now use ${city}, ${country}`);
  };

  const addManual = async () => {
    if (!orgSlug) return;
    if (!title.trim() || !startDate) { toast.error("A title and a date are required."); return; }
    const { error } = await (supabase as any).from("demand_events").insert({
      organization_slug: orgSlug,
      hotel_id: hotelId,
      city, country,
      title: title.trim(),
      category,
      venue: venue.trim() || null,
      event_date: startDate,
      end_date: endDate || null,
      expected_impact: impact,
      recurs_annually: recurring,
      source: "manual",
      approved: true,
    });
    if (error) { toast.error(error.message); return; }
    setTitle(""); setVenue(""); setStartDate(""); setEndDate(""); setRecurring(false);
    toast.success("Event added");
    void load();
  };

  const remove = async (id: string) => {
    const { error } = await (supabase as any).from("demand_events").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    setEvents((prev) => prev.filter((e) => e.id !== id));
  };

  const runSearch = async () => {
    setSearching(true);
    setCandidates(null);
    try {
      const { data, error } = await supabase.functions.invoke("demand-events-search", {
        body: { city, country, month },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? "Event search failed");
      const found = (data.candidates ?? []) as Candidate[];
      const known = new Set(events.map((e) => `${e.event_date}|${e.title.toLowerCase()}`));
      const fresh = found.filter((c) => !known.has(`${c.event_date}|${c.title.toLowerCase()}`));
      setCandidates(fresh);
      setPicked(Object.fromEntries(fresh.map((_, i) => [i, true])));
      if (!fresh.length) toast.info("No new events found for this month.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSearching(false);
    }
  };

  const saveSelected = async () => {
    if (!orgSlug || !candidates) return;
    const chosen = candidates.filter((_, i) => picked[i]);
    if (!chosen.length) { toast.error("Nothing selected."); return; }
    // The unique index is on lower(title), so PostgREST cannot resolve it as a
    // conflict target — duplicates are filtered out client-side before insert.
    const { error } = await (supabase as any).from("demand_events").insert(
      chosen.map((c) => ({
        organization_slug: orgSlug,
        hotel_id: hotelId,
        city: c.city, country: c.country,
        title: c.title, category: c.category, venue: c.venue,
        event_date: c.event_date, end_date: c.end_date,
        expected_impact: c.expected_impact,
        recurs_annually: c.recurs_annually,
        url: c.url, confidence: c.confidence,
        source: "ai", approved: true,
      })),
    );
    if (error) { toast.error(error.message); return; }
    toast.success(`${chosen.length} event${chosen.length === 1 ? "" : "s"} added to the calendar`);
    setCandidates(null);
    void load();
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
          <span className="inline-flex items-center gap-2">
            <CalendarDays className="h-4 w-4" /> Events &amp; demand calendar
          </span>
          <span className="flex flex-wrap items-center justify-end gap-1">
            <Button variant="outline" size="icon" onClick={() => shiftMonth(-1)} aria-label="Previous month">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-[9rem] text-center text-sm font-medium">{fmtMonth(month)}</span>
            <Button variant="outline" size="icon" onClick={() => shiftMonth(1)} aria-label="Next month">
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button size="sm" onClick={runSearch} disabled={searching}>
              {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              <span className="ml-1.5 hidden sm:inline">Find events</span>
            </Button>
          </span>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* location + AI search */}
        <Collapsible>
          <div className="flex items-center justify-between mb-2">
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs">
                <Settings2 className="h-3.5 w-3.5 mr-1.5" />
                AI Search & Location Settings
                <ChevronDown className="ml-1.5 h-3.5 w-3.5" />
              </Button>
            </CollapsibleTrigger>
          </div>
          <CollapsibleContent>
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] border rounded-lg p-3 bg-muted/20 mb-4">
              <div>
                <Label className="text-xs text-muted-foreground">City</Label>
                <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Budapest" className="h-8" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Country</Label>
                <Input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="Hungary" className="h-8" />
              </div>
              <Button variant="outline" size="sm" className="self-end h-8" onClick={saveLocation} disabled={!hotelId}>
                Save location
              </Button>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* AI candidates awaiting approval */}
        {candidates && candidates.length > 0 && (
          <div className="rounded-lg border p-3 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Suggested for {fmtMonth(month)} — tick the ones to keep</p>
              <Button size="sm" onClick={saveSelected}>Add selected</Button>
            </div>
            <ul className="space-y-1">
              {candidates.map((c, i) => (
                <li key={`${c.event_date}-${c.title}`} className="flex items-start gap-2 text-sm">
                  <Checkbox
                    checked={!!picked[i]}
                    onCheckedChange={(v) => setPicked((p) => ({ ...p, [i]: !!v }))}
                    className="mt-0.5"
                  />
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{c.title}</span>
                      <Badge variant="secondary" className={impactTone(c.expected_impact)}>{c.expected_impact}</Badge>
                      {c.recurs_annually && (
                        <Badge variant="outline" className="gap-1"><Repeat className="h-3 w-3" /> yearly</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {fmtDay(c.event_date)}{c.end_date ? ` – ${fmtDay(c.end_date)}` : ""}
                      {c.venue ? ` · ${c.venue}` : ""}
                      {c.confidence != null ? ` · confidence ${Math.round(c.confidence * 100)}%` : ""}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* the month's events */}
        <div className="space-y-2">
          {loading ? (
            <p className="text-sm text-muted-foreground inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading events…
            </p>
          ) : events.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No events recorded for {fmtMonth(month)} yet. Add one below or run the AI search.
            </p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {events.map((e) => (
                <li key={e.id} className="flex items-start justify-between gap-3 p-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{e.title}</span>
                      <Badge variant="secondary" className={impactTone(e.expected_impact)}>{e.expected_impact}</Badge>
                      {e.recurs_annually && (
                        <Badge variant="outline" className="gap-1"><Repeat className="h-3 w-3" /> yearly</Badge>
                      )}
                      {e.source === "ai" && <Badge variant="outline">AI</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {fmtDay(e.event_date)}{e.end_date ? ` – ${fmtDay(e.end_date)}` : ""}
                      {e.venue ? ` · ${e.venue}` : ""} · {e.category} · {e.city}
                    </p>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => remove(e.id)} aria-label="Delete event">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* manual entry */}
        <Collapsible>
          <div className="flex items-center justify-between mb-2">
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs">
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                Add event manually
                <ChevronDown className="ml-1.5 h-3.5 w-3.5" />
              </Button>
            </CollapsibleTrigger>
          </div>
          <CollapsibleContent>
            <div className="rounded-lg border p-3 space-y-2 bg-muted/10">
              <div className="grid gap-2 sm:grid-cols-2">
                <Input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} className="h-8" />
                <Input placeholder="Venue (optional)" value={venue} onChange={(e) => setVenue(e.target.value)} className="h-8" />
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-8" />
                <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} placeholder="End date" className="h-8" />
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={impact} onValueChange={setImpact}>
                  <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {IMPACTS.map((i) => <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="inline-flex items-center gap-2 text-xs">
                  <Checkbox checked={recurring} onCheckedChange={(v) => setRecurring(!!v)} />
                  Repeats every year
                </label>
                <Button size="sm" onClick={addManual} disabled={!orgSlug}>
                  Add event
                </Button>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
