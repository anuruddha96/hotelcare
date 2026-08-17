// Competitor rate watch.
//
// The hotel lists the properties it competes with (name + public rate page).
// A scheduled scan reads their published nightly rate for the next weeks and
// stores it, so this panel can show where our own price sits against the set.

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
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
}

interface CompRate {
  competitor_id: string;
  stay_date: string;
  rate: number | null;
  currency: string;
}

export default function CompetitorRatePanel({ hotelId, organizationSlug, canEdit, ratesByDate }: Props) {
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [rates, setRates] = useState<CompRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");

  const load = useCallback(async () => {
    if (!hotelId) return;
    setLoading(true);
    const [{ data: comps }, { data: rs }] = await Promise.all([
      supabase.from("competitor_properties").select("id, name, source_url, active").eq("hotel_id", hotelId).order("name"),
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

  const add = async () => {
    if (!hotelId || !organizationSlug || !name.trim()) return;
    const { error } = await supabase.from("competitor_properties").insert({
      hotel_id: hotelId,
      organization_slug: organizationSlug,
      name: name.trim(),
      source_url: url.trim() || null,
    });
    if (error) { toast.error(error.message); return; }
    setName(""); setUrl("");
    void load();
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("competitor_properties").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
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
      toast.success(`Captured ${(data as { captured?: number } | null)?.captured ?? 0} competitor prices`);
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
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium">Your competitive set</h4>
          <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={scan} disabled={scanning || !competitors.length}>
            {scanning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Scan prices
          </Button>
        </div>
        {competitors.length === 0 && (
          <p className="text-xs text-muted-foreground">No competitors yet. Add the hotels you price against.</p>
        )}
        <ul className="space-y-1">
          {competitors.map((c) => (
            <li key={c.id} className="flex items-center gap-2 rounded border px-2 py-1.5 text-sm">
              <span className="flex-1 truncate">{c.name}</span>
              {c.source_url && <Badge variant="secondary" className="text-[10px]">link</Badge>}
              {canEdit && (
                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => remove(c.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </li>
          ))}
        </ul>
        {canEdit && (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Competitor hotel name" className="h-8 text-sm" />
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Public rate page (optional)" className="h-8 text-sm" />
            <Button size="sm" className="h-8 gap-1" onClick={add} disabled={!name.trim()}>
              <Plus className="h-3.5 w-3.5" /> Add
            </Button>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-medium">You against the set</h4>
        {comparison.length === 0 ? (
          <p className="text-xs text-muted-foreground">No competitor prices captured yet — run a scan.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="py-1.5 text-left font-medium">Date</th>
                  <th className="py-1.5 text-right font-medium">Set avg.</th>
                  <th className="py-1.5 text-right font-medium">You</th>
                  <th className="py-1.5 text-right font-medium">Gap</th>
                </tr>
              </thead>
              <tbody>
                {comparison.map((r) => (
                  <tr key={r.date} className="border-b border-border/50">
                    <td className="py-1.5">{r.date}</td>
                    <td className="py-1.5 text-right tabular-nums">{money(r.avg)} <span className="text-[10px] text-muted-foreground">({r.n})</span></td>
                    <td className="py-1.5 text-right tabular-nums">{r.ours != null ? money(r.ours) : "—"}</td>
                    <td className={`py-1.5 text-right tabular-nums ${r.diff == null ? "text-muted-foreground" : Math.abs(r.diff) < 10 ? "" : r.diff > 0 ? "text-amber-600" : "text-red-600"}`}>
                      {r.diff == null ? "—" : `${r.diff >= 0 ? "+" : ""}${r.diff.toFixed(0)}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
