// Competitor rate watch.
//
// The hotel lists the properties it competes with (name + public rate page).
// The set can be filled in automatically: the assistant searches the web for
// comparable hotels and their published rate page. A scan then reads their
// nightly rate for the next weeks so this panel can show where we sit.

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, Plus, RefreshCw, Sparkles, Trash2, ExternalLink, Check, AlertTriangle } from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { money } from "@/lib/revenueCurrency";
import type { DayMetrics } from "@/lib/revenueAnalytics";

interface Props {
  hotelId: string | null;
  organizationSlug: string | null;
  canEdit: boolean;
  /** Our own rate per date, used for the "you are X% above the set" line. */
  ratesByDate: Map<string, number>;
  metrics?: DayMetrics[];
}

interface Competitor {
  id: string;
  name: string;
  source_url: string | null;
  active: boolean;
  last_scan_at: string | null;
  last_scan_status: string | null;
  last_scan_error: string | null;
  last_scan_prices: number | null;
}

interface CompRate {
  competitor_id: string;
  stay_date: string;
  rate: number | null;
  currency: string;
}

interface Suggestion {
  name: string;
  source_url: string | null;
  why: string | null;
}

/** Distinct, theme-safe line colours for each watched hotel. */
const LINE_COLORS = [
  "hsl(var(--chart-1, 220 70% 50%))",
  "hsl(var(--chart-2, 160 60% 45%))",
  "hsl(var(--chart-3, 30 80% 55%))",
  "hsl(var(--chart-4, 280 65% 60%))",
  "hsl(var(--chart-5, 340 75% 55%))",
  "hsl(var(--muted-foreground))",
];

export default function CompetitorRatePanel({ hotelId, organizationSlug, canEdit, ratesByDate }: Props) {
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [rates, setRates] = useState<CompRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [finding, setFinding] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [adding, setAdding] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [showEach, setShowEach] = useState(false);
  const [showSiblings, setShowSiblings] = useState(false);
  const [siblings, setSiblings] = useState<Array<{ hotelId: string; label: string; adr: Map<string, number> }>>([]);

  const load = useCallback(async () => {
    if (!hotelId) return;
    setLoading(true);
    const [{ data: comps }, { data: rs }] = await Promise.all([
      supabase
        .from("competitor_properties")
        .select("id, name, source_url, active, last_scan_at, last_scan_status, last_scan_error, last_scan_prices")
        .eq("hotel_id", hotelId).order("name"),
      supabase
        .from("competitor_rates")
        .select("competitor_id, stay_date, rate, currency")
        .eq("hotel_id", hotelId)
        .gte("stay_date", new Date().toISOString().slice(0, 10))
        .order("stay_date"),
    ]);
    setCompetitors((comps ?? []) as Competitor[]);
    setRates((rs ?? []) as CompRate[]);
    setLoading(false);
  }, [hotelId]);

  useEffect(() => { void load(); }, [load]);

  // Sister properties in the same organisation, so the set can be read next to
  // how our own hotels are priced for the same nights.
  useEffect(() => {
    if (!showSiblings || !hotelId || siblings.length) return;
    let cancelled = false;
    void (async () => {
      const { data: hotels } = await supabase.rpc("get_user_organization_hotels");
      const list = ((hotels ?? []) as Array<{ hotel_id: string; hotel_name: string }>)
        .filter((h) => h.hotel_id && h.hotel_id !== hotelId);
      if (!list.length) return;
      const from = new Date().toISOString().slice(0, 10);
      const to = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
      const { data: snaps } = await supabase.rpc("revenue_portfolio_latest_snapshots", {
        _hotel_ids: list.map((h) => h.hotel_id), _from: from, _to: to,
      });
      if (cancelled) return;
      const byHotel = new Map<string, Map<string, number>>();
      for (const row of ((snaps ?? []) as Array<{ hotel_id: string; stay_date: string; adr_eur: number | null }>)) {
        if (row.adr_eur == null) continue;
        const m = byHotel.get(row.hotel_id) ?? new Map<string, number>();
        m.set(String(row.stay_date).slice(0, 10), Number(row.adr_eur));
        byHotel.set(row.hotel_id, m);
      }
      setSiblings(list
        .filter((h) => byHotel.has(h.hotel_id))
        .map((h) => ({ hotelId: h.hotel_id, label: h.hotel_name || h.hotel_id, adr: byHotel.get(h.hotel_id)! })));
    })();
    return () => { cancelled = true; };
  }, [showSiblings, hotelId, siblings.length]);

  const byDate = useMemo(() => {
    const m = new Map<string, number[]>();
    for (const r of rates) {
      if (r.rate == null) continue;
      const arr = m.get(r.stay_date) ?? [];
      arr.push(Number(r.rate));
      m.set(r.stay_date, arr);
    }
    return m;
  }, [rates]);

  const comparison = useMemo(() => {
    const dates = [...byDate.keys()].sort().slice(0, 30);
    return dates.map((d) => {
      const set = byDate.get(d)!;
      const avg = set.reduce((a, b) => a + b, 0) / set.length;
      const ours = ratesByDate.get(d) ?? null;
      const diff = ours && avg ? ((ours - avg) / avg) * 100 : null;
      return { date: d, avg, ours, diff, n: set.length };
    });
  }, [byDate, ratesByDate]);

  /** Chart rows: our price, the set average, and optionally each hotel. */
  const chartData = useMemo(() => {
    const perCompetitor = new Map<string, Map<string, number>>();
    for (const r of rates) {
      if (r.rate == null) continue;
      const m = perCompetitor.get(r.competitor_id) ?? new Map<string, number>();
      m.set(r.stay_date, Number(r.rate));
      perCompetitor.set(r.competitor_id, m);
    }
    return comparison.map((row) => {
      const point: Record<string, string | number | null> = {
        date: row.date.slice(5),
        You: row.ours,
        "Set average": Number(row.avg.toFixed(0)),
      };
      if (showEach) {
        for (const c of competitors) point[c.name] = perCompetitor.get(c.id)?.get(row.date) ?? null;
      }
      if (showSiblings) {
        for (const s of siblings) point[s.label] = s.adr.get(row.date) ?? null;
      }
      return point;
    });
  }, [comparison, rates, competitors, showEach, showSiblings, siblings]);

  const insert = async (n: string, u: string | null) => {
    if (!hotelId || !organizationSlug) return false;
    const { error } = await supabase.from("competitor_properties").insert({
      hotel_id: hotelId,
      organization_slug: organizationSlug,
      name: n.trim(),
      source_url: u?.trim() || null,
    });
    if (error) { toast.error(error.message); return false; }
    return true;
  };

  const add = async () => {
    if (!name.trim()) return;
    if (await insert(name, url)) {
      setName(""); setUrl("");
      void load();
    }
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("competitor_properties").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    void load();
  };

  const findWithAi = async () => {
    if (!hotelId) return;
    setFinding(true);
    try {
      const { data, error } = await supabase.functions.invoke("competitor-discover", {
        body: { hotelId, count: 6 },
      });
      if (error) throw error;
      const list = ((data as { suggestions?: Suggestion[] } | null)?.suggestions ?? []);
      if (!list.length) { toast.info("No new competitors found this time."); return; }
      setSuggestions(list);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not look up competitors");
    } finally {
      setFinding(false);
    }
  };

  const acceptSuggestion = async (s: Suggestion) => {
    setAdding(s.name);
    if (await insert(s.name, s.source_url)) {
      setSuggestions((prev) => prev.filter((x) => x.name !== s.name));
      void load();
    }
    setAdding(null);
  };

  const acceptAll = async () => {
    setAdding("__all__");
    for (const s of suggestions) await insert(s.name, s.source_url);
    setSuggestions([]);
    setAdding(null);
    void load();
  };

  const scan = async () => {
    if (!hotelId) return;
    setScanning(true);
    try {
      const { data, error } = await supabase.functions.invoke("competitor-rate-scan", {
        body: { hotelId, days: 30 },
      });
      if (error) throw error;
      const captured = (data as { captured?: number } | null)?.captured ?? 0;
      if (captured) toast.success(`Captured ${captured} competitor prices`);
      else toast.info("No public prices were found this time.");
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The scan failed");
    } finally {
      setScanning(false);
    }
  };

  if (loading) {
    return <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;
  }

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 className="text-sm font-semibold">Your competitive set</h4>
            <p className="text-xs text-muted-foreground">
              {competitors.length ? `${competitors.length} ${competitors.length === 1 ? "hotel" : "hotels"} watched` : "Nobody watched yet"}
            </p>
          </div>
          <div className="flex gap-2">
            {canEdit && (
              <Button size="sm" variant="secondary" className="h-8 gap-1.5 text-xs" onClick={findWithAi} disabled={finding}>
                {finding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                Find competitors
              </Button>
            )}
            <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={scan} disabled={scanning || !competitors.length}>
              {scanning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Scan prices
            </Button>
          </div>
        </div>

        {competitors.length === 0 && suggestions.length === 0 && (
          <div className="rounded-lg border border-dashed p-4 text-center">
            <p className="text-sm font-medium">No competitors yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Let the assistant search the web for comparable hotels and their public rate pages, or add one by hand.
            </p>
          </div>
        )}

        {suggestions.length > 0 && (
          <div className="space-y-2 rounded-lg border bg-muted/40 p-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold">Suggested by the assistant</p>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={acceptAll} disabled={adding === "__all__"}>
                {adding === "__all__" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Add all"}
              </Button>
            </div>
            <ul className="space-y-2">
              {suggestions.map((s) => (
                <li key={s.name} className="rounded-md border bg-background p-2.5">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{s.name}</p>
                      {s.why && <p className="mt-0.5 text-xs text-muted-foreground">{s.why}</p>}
                      {s.source_url && (
                        <a
                          href={s.source_url} target="_blank" rel="noreferrer"
                          className="mt-1 inline-flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline"
                        >
                          <ExternalLink className="h-3 w-3" /> Public rate page
                        </a>
                      )}
                    </div>
                    <Button size="sm" className="h-7 gap-1 text-xs" onClick={() => void acceptSuggestion(s)} disabled={adding === s.name}>
                      {adding === s.name ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                      Add
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {competitors.length > 0 && (
          <ul className="space-y-1.5">
            {competitors.map((c) => (
              <li key={c.id} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{c.name}</p>
                  {c.source_url && (
                    <a
                      href={c.source_url} target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:underline"
                    >
                      <ExternalLink className="h-3 w-3" /> rate page
                    </a>
                  )}
                  {c.last_scan_at && (
                    <p className={`mt-0.5 flex items-center gap-1 text-[11px] ${c.last_scan_status === "ok" ? "text-muted-foreground" : "text-amber-600"}`}>
                      {c.last_scan_status !== "ok" && <AlertTriangle className="h-3 w-3" />}
                      {c.last_scan_status === "ok"
                        ? `Last checked ${new Date(c.last_scan_at).toLocaleString()}`
                        : c.last_scan_status === "no_prices_found"
                          ? "Last check found no public price"
                          : `Last check failed: ${c.last_scan_error ?? "unknown reason"}`}
                    </p>
                  )}
                </div>
                <Badge variant="secondary" className="text-[10px]">
                  {rates.filter((r) => r.competitor_id === c.id).length} prices
                </Badge>
                {canEdit && (
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => remove(c.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        {canEdit && (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Competitor hotel name" className="h-9 text-base sm:text-sm" />
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Public rate page (optional)" className="h-9 text-base sm:text-sm" />
            <Button size="sm" className="h-9 gap-1 sm:w-auto" onClick={add} disabled={!name.trim()}>
              <Plus className="h-3.5 w-3.5" /> Add
            </Button>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h4 className="text-sm font-semibold">You against the set</h4>
          {comparison.length > 0 && (
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <Switch id="comp-each" checked={showEach} onCheckedChange={setShowEach} />
                <Label htmlFor="comp-each" className="text-xs font-normal">Each competitor</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch id="comp-siblings" checked={showSiblings} onCheckedChange={setShowSiblings} />
                <Label htmlFor="comp-siblings" className="text-xs font-normal">Our other hotels</Label>
              </div>
            </div>
          )}
        </div>

        {comparison.length > 0 && (
          <div className="h-64 w-full rounded-lg border p-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10 }} width={44} />
                <Tooltip contentStyle={{ fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="You" stroke="hsl(var(--primary))" strokeWidth={2.5} dot={false} connectNulls />
                <Line type="monotone" dataKey="Set average" stroke="hsl(var(--muted-foreground))" strokeWidth={2} strokeDasharray="4 3" dot={false} connectNulls />
                {showEach && competitors.map((c, i) => (
                  <Line key={c.id} type="monotone" dataKey={c.name} stroke={LINE_COLORS[i % LINE_COLORS.length]} strokeWidth={1.5} dot={false} connectNulls />
                ))}
                {showSiblings && siblings.map((s, i) => (
                  <Line key={s.hotelId} type="monotone" dataKey={s.label} stroke={LINE_COLORS[(i + 2) % LINE_COLORS.length]} strokeWidth={1.5} strokeDasharray="2 2" dot={false} connectNulls />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {comparison.length === 0 ? (
          <p className="text-xs text-muted-foreground">No competitor prices captured yet — run a scan.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-xs text-muted-foreground">
                  <th className="px-3 py-2 text-left font-medium">Date</th>
                  <th className="px-3 py-2 text-right font-medium">Set avg.</th>
                  <th className="px-3 py-2 text-right font-medium">You</th>
                  <th className="px-3 py-2 text-right font-medium">Gap</th>
                </tr>
              </thead>
              <tbody>
                {comparison.map((r) => (
                  <tr key={r.date} className="border-b border-border/50 last:border-0">
                    <td className="px-3 py-2">{r.date}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(r.avg)} <span className="text-[10px] text-muted-foreground">({r.n})</span></td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.ours != null ? money(r.ours) : "—"}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${r.diff == null ? "text-muted-foreground" : Math.abs(r.diff) < 10 ? "" : r.diff > 0 ? "text-amber-600" : "text-red-600"}`}>
                      {r.diff == null ? "—" : `${r.diff >= 0 ? "+" : ""}${r.diff.toFixed(0)}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
