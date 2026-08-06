import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CalendarDays, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface HotelEvent {
  id: string;
  title: string;
  category: string | null;
  impact: string | null;
  event_date: string;
  end_date: string | null;
  notes: string | null;
}
interface MarketEvent {
  id: string;
  title: string;
  category: string | null;
  expected_impact: string | null;
  event_date: string;
  end_date: string | null;
  venue: string | null;
  source: string | null;
}

const CATEGORIES = ["conference", "concert", "sports", "festival", "holiday", "fair", "closure", "other"];
const IMPACTS = [
  { value: "very_high", label: "Very high demand" },
  { value: "high", label: "High demand" },
  { value: "medium", label: "Medium demand" },
  { value: "low", label: "Low demand" },
  { value: "negative", label: "Demand negative" },
];

function fmt(d: string) {
  return new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, {
    timeZone: "UTC", day: "numeric", month: "short",
  });
}

/** Phase 3 — manually maintained property and city demand signals fed to the AI analyst. */
export default function MarketSignalsPanel({ hotelId }: { hotelId: string | null }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hotelEvents, setHotelEvents] = useState<HotelEvent[]>([]);
  const [marketEvents, setMarketEvents] = useState<MarketEvent[]>([]);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("conference");
  const [impact, setImpact] = useState("high");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const load = useCallback(async () => {
    if (!hotelId) { setLoading(false); return; }
    setLoading(true);
    const [{ data: he }, { data: me }] = await Promise.all([
      supabase.from("hotel_events")
        .select("id,title,category,impact,event_date,end_date,notes")
        .eq("hotel_id", hotelId).gte("event_date", today)
        .order("event_date").limit(100),
      supabase.from("market_events")
        .select("id,title,category,expected_impact,event_date,end_date,venue,source")
        .gte("event_date", today).order("event_date").limit(50),
    ]);
    setHotelEvents((he ?? []) as HotelEvent[]);
    setMarketEvents((me ?? []) as MarketEvent[]);
    setLoading(false);
  }, [hotelId, today]);

  useEffect(() => { void load(); }, [load]);

  const add = async () => {
    if (!hotelId || !title.trim() || !startDate) {
      toast.error("Add a title and a start date");
      return;
    }
    setSaving(true);
    try {
      const { data: session } = await supabase.auth.getUser();
      const { data: profile } = await supabase.from("profiles")
        .select("organization_slug").eq("id", session.user?.id ?? "").maybeSingle();
      const { error } = await supabase.from("hotel_events").insert({
        hotel_id: hotelId,
        organization_slug: profile?.organization_slug ?? null,
        title: title.trim(),
        category,
        impact,
        event_date: startDate,
        end_date: endDate || startDate,
        created_by: session.user?.id ?? null,
      });
      if (error) throw error;
      setTitle(""); setStartDate(""); setEndDate("");
      toast.success("Event added — it will be used in the next analysis");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the event");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("hotel_events").delete().eq("id", id);
    if (error) { toast.error("Could not remove the event"); return; }
    setHotelEvents((xs) => xs.filter((x) => x.id !== id));
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-primary" />
          Demand signals &amp; events
        </CardTitle>
        <p className="text-[11px] text-muted-foreground">
          Events you record here adjust the demand score for those dates and give the AI analyst
          context it cannot see in the booking data. They never change a price on their own.
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* add form — stacks on mobile */}
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
            <Button size="sm" className="h-9 shrink-0" onClick={add} disabled={saving || !hotelId}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading signals…
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1">
              <h3 className="text-sm font-medium">Property events</h3>
              {hotelEvents.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No events recorded. Add the ones you already know about — group stays, closures, local demand drivers.
                </p>
              ) : (
                <ul className="divide-y rounded-md border">
                  {hotelEvents.map((e) => (
                    <li key={e.id} className="flex items-center justify-between gap-2 p-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{e.title}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {fmt(e.event_date)}{e.end_date && e.end_date !== e.event_date ? ` – ${fmt(e.end_date)}` : ""}
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
                          aria-label={`Remove ${e.title}`} onClick={() => remove(e.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {marketEvents.length > 0 && (
              <div className="space-y-1">
                <h3 className="text-sm font-medium">City &amp; market events</h3>
                <ul className="divide-y rounded-md border">
                  {marketEvents.slice(0, 12).map((e) => (
                    <li key={e.id} className="flex items-center justify-between gap-2 p-2">
                      <div className="min-w-0">
                        <p className="text-sm truncate">{e.title}{e.venue ? ` — ${e.venue}` : ""}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {fmt(e.event_date)}{e.end_date && e.end_date !== e.event_date ? ` – ${fmt(e.end_date)}` : ""}
                          {e.source ? ` · ${e.source}` : ""}
                        </p>
                      </div>
                      {e.expected_impact && (
                        <Badge variant="outline" className="text-[10px] font-normal capitalize shrink-0">
                          {e.expected_impact.replace(/_/g, " ")}
                        </Badge>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
