import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useLiveSync } from "@/contexts/LiveSyncContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Upload, AlertTriangle, ArrowLeft, RefreshCw, Sparkles, Download, Loader2, CheckCircle2, XCircle, Radio, Info } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ComposedChart, Area, Bar, Line, XAxis, YAxis, Tooltip as RTooltip, ResponsiveContainer } from "recharts";
import RevenueSyncHistory from "@/components/revenue/RevenueSyncHistory";
import { MainTabsBar } from "@/components/layout/MainTabsBar";
import { Header } from "@/components/layout/Header";

interface PickupDateRow { stay_date: string; delta: number }
interface OccByDate { stay_date: string; occupancy_pct: number; rooms_sold: number }
interface ComboPoint { d: string; date: string; occ: number | null; pickup: number; rate: number | null }

interface HotelStat {
  hotel_id: string;
  hotel_name: string;
  pickup_today: number;
  last_snapshot: string | null;
  pending_recs: number;
  abnormal: boolean;
  combo: ComboPoint[];
  hasFreshAI: boolean;
  last_label: string | null;
  topPickupDates: PickupDateRow[];
  occNext7: OccByDate[];
  occAvg7: number;
  occAvg30: number;
  lastOccUpload: string | null;   // newest XLSX-source occupancy snapshot
  lastOccLive: string | null;     // newest Previo-source occupancy snapshot
  lastPickupUpload: string | null;
  lastPickupLive: string | null;
  isPrevio: boolean;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
  lastSyncError: string | null;
}


interface UploadJob {
  file: File;
  status: "queued" | "uploading" | "ok" | "err";
  message?: string;
  rows?: number;
  hotel?: string;
}

const ALLOWED = ["admin", "top_management", "top_management_manager"];

export default function Revenue() {
  const { profile, loading } = useAuth();
  const { organizationSlug } = useParams<{ organizationSlug: string }>();
  const navigate = useNavigate();
  const liveSync = useLiveSync();
  const [hotels, setHotels] = useState<HotelStat[]>([]);
  const [busy, setBusy] = useState(false);
  const [hotelDialog, setHotelDialog] = useState<{ id: string; name: string } | null>(null);
  const [dialogJobs, setDialogJobs] = useState<UploadJob[]>([]);

  useEffect(() => {
    if (loading) return;
    if (!profile || !ALLOWED.includes(profile.role)) {
      navigate(`/${organizationSlug || "rdhotels"}`);
      return;
    }
    void load();
    // Re-load when URL org changes (admin switching tenants)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, profile?.role, organizationSlug]);

  async function load() {
    setBusy(true);

    // Prefer the org slug from the URL so admins who just switched tenants
    // see the correct hotels even if profile.organization_slug is still
    // catching up. Fall back to profile.
    const effectiveSlug = organizationSlug || profile?.organization_slug;
    let orgId: string | null = null;
    if (effectiveSlug) {
      const { data: org } = await supabase
        .from("organizations")
        .select("id")
        .eq("slug", effectiveSlug)
        .maybeSingle();
      orgId = org?.id ?? null;
    }

    let hq = supabase
      .from("hotel_configurations")
      .select("hotel_id, hotel_name, organization_id")
      .eq("is_active", true);
    if (orgId) hq = hq.eq("organization_id", orgId);
    const { data: hotelRows } = await hq;

    // Which of these hotels are wired up to Previo? Drives the "Sync" button.
    const hotelIds = (hotelRows ?? []).map((h) => h.hotel_id);
    const previoIds = new Set<string>();
    const lastSyncByHotel = new Map<string, string>();
    const lastSyncStatusByHotel = new Map<string, string>();
    const lastSyncErrorByHotel = new Map<string, string>();
    if (hotelIds.length > 0) {
      const { data: pmsRows } = await supabase
        .from("pms_configurations")
        .select("hotel_id, pms_type, last_sync_at, last_sync_status, last_sync_error, is_active")
        .in("hotel_id", hotelIds)
        .eq("pms_type", "previo")
        .eq("is_active", true);
      for (const p of pmsRows ?? []) {
        previoIds.add(p.hotel_id);
        if ((p as any).last_sync_at) lastSyncByHotel.set(p.hotel_id, (p as any).last_sync_at);
        if ((p as any).last_sync_status) lastSyncStatusByHotel.set(p.hotel_id, (p as any).last_sync_status);
        if ((p as any).last_sync_error) lastSyncErrorByHotel.set(p.hotel_id, (p as any).last_sync_error);
      }
    }

    const today = new Date().toISOString().slice(0, 10);
    const in14 = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
    const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

    const stats: HotelStat[] = [];
    for (const h of hotelRows ?? []) {
      const [
        { data: snaps },
        { data: recs },
        { data: alerts },
        { data: lastAI },
        { data: lastPickupDates },
        { data: occRows },
        { data: refPrices },
      ] = await Promise.all([
        supabase.from("pickup_snapshots").select("delta, captured_at, snapshot_label, source, stay_date")
          .eq("hotel_id", h.hotel_id).order("captured_at", { ascending: false }).limit(500),
        supabase.from("rate_recommendations").select("id").eq("hotel_id", h.hotel_id).eq("status", "pending"),
        supabase.from("revenue_alerts").select("id").eq("hotel_id", h.hotel_id).is("acknowledged_at", null).eq("alert_type", "abnormal_pickup"),
        supabase.from("revenue_ai_insights").select("created_at").eq("hotel_id", h.hotel_id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
        supabase.from("pickup_snapshots").select("stay_date, delta, captured_at")
          .eq("hotel_id", h.hotel_id).gte("stay_date", today).order("captured_at", { ascending: false }).limit(500),
        supabase.from("occupancy_snapshots").select("stay_date, occupancy_pct, rooms_sold, captured_at, source")
          .eq("hotel_id", h.hotel_id).gte("stay_date", today).lte("stay_date", in30)
          .order("captured_at", { ascending: false }).limit(800),
        (supabase as any).from("previo_reference_prices").select("stay_date, rate_eur")
          .eq("hotel_id", h.hotel_id).gte("stay_date", today).lte("stay_date", in14)
          .order("stay_date", { ascending: true }),
      ]);

      // Aggregate top pickup dates from most recent snapshot batch (last 24h)
      const cutoff = Date.now() - 24 * 3600 * 1000;
      const pickByDate = new Map<string, number>();
      for (const r of lastPickupDates ?? []) {
        if (new Date(r.captured_at).getTime() < cutoff) break;
        pickByDate.set(r.stay_date, (pickByDate.get(r.stay_date) ?? 0) + (r.delta || 0));
      }
      const topPickupDates = Array.from(pickByDate.entries())
        .map(([stay_date, delta]) => ({ stay_date, delta }))
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
        .slice(0, 5);

      // Latest occupancy per stay_date
      const occByDate = new Map<string, OccByDate>();
      for (const r of occRows ?? []) {
        if (!occByDate.has(r.stay_date)) {
          occByDate.set(r.stay_date, {
            stay_date: r.stay_date,
            occupancy_pct: Number(r.occupancy_pct ?? 0),
            rooms_sold: r.rooms_sold ?? 0,
          });
        }
      }
      const occSorted = Array.from(occByDate.values()).sort((a, b) => a.stay_date.localeCompare(b.stay_date));
      const occNext7 = occSorted.slice(0, 7);
      const occAvg7 = occNext7.length ? occNext7.reduce((a, r) => a + r.occupancy_pct, 0) / occNext7.length : 0;
      const occAvg30 = occSorted.length ? occSorted.reduce((a, r) => a + r.occupancy_pct, 0) / occSorted.length : 0;

      // Source-aware "last activity" timestamps so the card distinguishes
      // XLSX uploads from live Previo syncs.
      const lastOccUpload = (occRows ?? []).find((r: any) => (r.source ?? "").toLowerCase() !== "previo")?.captured_at ?? null;
      const lastOccLive = (occRows ?? []).find((r: any) => (r.source ?? "").toLowerCase() === "previo")?.captured_at ?? null;
      const lastPickupUpload = (snaps ?? []).find((r: any) => (r.source ?? "").toLowerCase() !== "previo" && r.snapshot_label !== "previo-live")?.captured_at ?? null;
      const lastPickupLive = (snaps ?? []).find((r: any) => (r.source ?? "").toLowerCase() === "previo" || r.snapshot_label === "previo-live")?.captured_at ?? null;

      // Build 14-day combo series: occupancy %, daily pickup delta, reference rate.
      const refByDate = new Map<string, number>();
      for (const r of (refPrices ?? []) as any[]) {
        if (!refByDate.has(r.stay_date)) refByDate.set(r.stay_date, Number(r.rate_eur));
      }
      // Latest pickup per stay_date (snaps already ordered desc).
      const pickupByDate = new Map<string, number>();
      for (const r of (snaps ?? []) as any[]) {
        if (!r.stay_date || r.stay_date < today || r.stay_date > in14) continue;
        if (!pickupByDate.has(r.stay_date)) pickupByDate.set(r.stay_date, Number(r.delta ?? 0));
      }
      const combo: ComboPoint[] = [];
      for (let i = 0; i < 14; i++) {
        const dt = new Date(Date.now() + i * 86400000);
        const iso = dt.toISOString().slice(0, 10);
        const occ = occByDate.get(iso)?.occupancy_pct ?? null;
        combo.push({
          d: dt.toLocaleDateString(undefined, { weekday: "short", day: "numeric" }),
          date: iso,
          occ: occ != null ? Math.round(occ) : null,
          pickup: pickupByDate.get(iso) ?? 0,
          rate: refByDate.get(iso) ?? null,
        });
      }

      stats.push({
        hotel_id: h.hotel_id,
        hotel_name: h.hotel_name,
        pickup_today: (snaps ?? []).reduce((a, r) => a + (r.delta || 0), 0),
        last_snapshot: snaps?.[0]?.captured_at ?? null,
        last_label: snaps?.[0]?.snapshot_label ?? null,
        pending_recs: recs?.length ?? 0,
        abnormal: (alerts?.length ?? 0) > 0,
        combo,
        hasFreshAI: lastAI ? (Date.now() - new Date(lastAI.created_at).getTime()) < 12 * 3600 * 1000 : false,
        topPickupDates,
        occNext7,
        occAvg7,
        occAvg30,
        lastOccUpload,
        lastOccLive,
        lastPickupUpload,
        lastPickupLive,
        isPrevio: previoIds.has(h.hotel_id),
        lastSyncAt: lastSyncByHotel.get(h.hotel_id) ?? null,
        lastSyncStatus: lastSyncStatusByHotel.get(h.hotel_id) ?? null,
        lastSyncError: lastSyncErrorByHotel.get(h.hotel_id) ?? null,
      });
    }
    setHotels(stats);
    setBusy(false);
  }


  async function runEngine() {
    setBusy(true);
    const { error } = await supabase.functions.invoke("revenue-engine-tick", { body: {} });
    setBusy(false);
    if (error) toast.error(error.message); else toast.success("Engine ran");
    void load();
  }

  async function syncFromPrevio(hotelId: string, hotelName: string) {
    toast.info(`Syncing ${hotelName} from Previo…`);
    const [revRes, overviewRes] = await Promise.all([
      supabase.functions.invoke("previo-pull-revenue", { body: { hotelId } }),
      supabase.functions.invoke("previo-sync-daily-overview", { body: { hotelId, days: 90 } }),
    ]);
    if (revRes.error || (revRes.data && (revRes.data as any).ok === false)) {
      toast.error((revRes.data as any)?.error || revRes.error?.message || "Revenue sync failed");
      return;
    }
    const d = revRes.data as any;
    const ov = overviewRes.data as any;
    const ovPart = overviewRes.error
      ? ` · overview failed`
      : ov?.supported === false
        ? ""
        : ` · ${ov?.rowsInserted ?? 0} overview rows`;
    toast.success(
      `Synced ${hotelName} · ${d?.occInserted ?? 0} occ · ${d?.dailyRatesPms ?? 0} PMS rates · ${d?.dailyRatesRealized ?? 0} ADR${ovPart}`,
    );
    void load();
  }


  async function exportAll(format: "csv" | "xlsx") {
    const { data, error } = await supabase.functions.invoke("revenue-export", {
      body: { format, kind: "recommendations" },
    });
    if (error) { toast.error(error.message); return; }
    // data is a blob via supabase-js
    const blob = data instanceof Blob ? data : new Blob([data as any]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `revenue-recommendations.${format}`;
    a.click(); URL.revokeObjectURL(url);
  }

  return (
    <div className="container mx-auto p-4 space-y-4">
      <MainTabsBar current="revenue" />
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => navigate(`/${organizationSlug}`)}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <h1 className="text-2xl font-semibold">Revenue Management</h1>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => exportAll("xlsx")} variant="outline" size="sm"><Download className="h-4 w-4 mr-1" />Export XLSX</Button>
          <Button onClick={() => exportAll("csv")} variant="outline" size="sm"><Download className="h-4 w-4 mr-1" />CSV</Button>
          <Button onClick={runEngine} variant="outline" disabled={busy}>
            <RefreshCw className="h-4 w-4 mr-1" /> Run engine
          </Button>
        </div>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <SummaryStat label="Hotels tracked" value={hotels.length} />
        <SummaryStat label="14d pickup Δ (all)" value={hotels.reduce((a, h) => a + h.pickup_today, 0)} />
        <SummaryStat label="Pending recs" value={hotels.reduce((a, h) => a + h.pending_recs, 0)} highlight={hotels.some((h) => h.pending_recs > 0)} />
        <SummaryStat label="Abnormal pickups" value={hotels.filter((h) => h.abnormal).length} danger={hotels.some((h) => h.abnormal)} />
      </div>

      {liveSync.enabled && (() => {
        const rev = liveSync.tasks.revenue;
        const isSync = rev.status === 'syncing';
        const isErr = rev.status === 'error';
        const isUnsupported = rev.meta?.supported === false;
        const Icon = isSync
          ? Loader2
          : isUnsupported
          ? Info
          : isErr
          ? XCircle
          : rev.lastAt
          ? CheckCircle2
          : Radio;
        const color = isSync
          ? 'border-primary/30 bg-primary/5 text-primary'
          : isUnsupported
          ? 'border-border bg-muted/40 text-muted-foreground'
          : isErr
          ? 'border-destructive/30 bg-destructive/5 text-destructive'
          : rev.lastAt
          ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400'
          : 'border-border bg-muted/30 text-muted-foreground';
        const title = isSync
          ? 'Pulling live data from Previo…'
          : isUnsupported
          ? 'Live rate sync not available'
          : isErr
          ? 'Live sync failed'
          : rev.lastAt
          ? 'Live · connected to Previo'
          : 'Live · ready';
        const subtitle = isUnsupported
          ? (rev.message || "Previo hasn't enabled the rates endpoint for this hotel — upload the XLSX files below to keep numbers fresh.")
          : `${rev.lastAt ? `Last update ${formatDistanceToNow(rev.lastAt)} ago` : 'Auto-syncs on login & focus'}${isErr && rev.message ? ` · ${rev.message}` : ''}`;
        return (
          <div className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm ${color}`}>
            <div className="flex items-center gap-2 min-w-0">
              <Icon className={`h-4 w-4 shrink-0 ${isSync ? 'animate-spin' : ''}`} />
              <div className="min-w-0">
                <div className="font-medium">{title}</div>
                <div className="text-xs opacity-80 truncate">{subtitle}</div>
              </div>
            </div>
            {!isUnsupported && (
              <Button size="sm" variant="ghost" disabled={isSync} onClick={() => void liveSync.refresh('revenue')}>
                <RefreshCw className={`h-3.5 w-3.5 mr-1 ${isSync ? 'animate-spin' : ''}`} /> Refresh
              </Button>
            )}
          </div>
        );
      })()}

      <p className="text-xs text-muted-foreground">Click <b>Upload</b> on a hotel card to add Pickup, Occupancy, or Daily Overview XLSX files. The file's hotel name is verified before saving.</p>

      <RevenueSyncHistory limit={8} />

      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
        {hotels.map((h) => (
          <Card key={h.hotel_id} className={h.abnormal ? "border-red-500" : ""}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center justify-between gap-1">
                <span className="truncate">{h.hotel_name}</span>
                <span className="flex items-center gap-1">
                  {h.hasFreshAI && <Badge variant="outline" className="gap-1 text-purple-700 border-purple-300"><Sparkles className="h-3 w-3" />AI</Badge>}
                  {h.abnormal && <Badge variant="destructive" className="gap-1"><AlertTriangle className="h-3 w-3" />!</Badge>}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="grid grid-cols-3 gap-2">
                <KPI label="7d Occ" value={h.occAvg7 ? `${h.occAvg7.toFixed(0)}%` : "—"} />
                <KPI label="30d Occ" value={h.occAvg30 ? `${h.occAvg30.toFixed(0)}%` : "—"} />
                <KPI label="Pickup Δ" value={String(h.pickup_today)} accent={h.pickup_today >= 0 ? "up" : "down"} />
              </div>

              {h.combo.some(p => p.occ != null || p.rate != null || p.pickup !== 0) && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                    <span className="font-medium uppercase tracking-wide">Next 14 days</span>
                    <span className="flex items-center gap-2">
                      <span className="flex items-center gap-1"><i className="h-1.5 w-2.5 rounded-sm bg-primary/60 inline-block" /> Occ</span>
                      <span className="flex items-center gap-1"><i className="h-1.5 w-2.5 rounded-sm bg-amber-500 inline-block" /> Pickup</span>
                      <span className="flex items-center gap-1"><i className="h-0.5 w-3 bg-emerald-600 inline-block" /> Rate €</span>
                    </span>
                  </div>
                  <div className="h-32 -mx-1">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={h.combo} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                        <XAxis dataKey="d" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} interval={1} />
                        <YAxis yAxisId="left" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} width={24} domain={[0, 100]} />
                        <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} width={28} />
                        <RTooltip
                          contentStyle={{ fontSize: 11, padding: "4px 8px" }}
                          formatter={(value: any, name: string) => {
                            if (name === "Occ") return [`${value}%`, name];
                            if (name === "Rate") return [`€${value}`, name];
                            return [value, name];
                          }}
                        />
                        <Area yAxisId="left" type="monotone" dataKey="occ" name="Occ" stroke="hsl(var(--primary))" fill="hsl(var(--primary) / 0.2)" strokeWidth={1.5} />
                        <Bar yAxisId="left" dataKey="pickup" name="Pickup" fill="hsl(38 92% 50%)" radius={[2, 2, 0, 0]} maxBarSize={10} />
                        <Line yAxisId="right" type="monotone" dataKey="rate" name="Rate" stroke="hsl(142 71% 35%)" strokeWidth={2} dot={false} connectNulls />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {h.topPickupDates.length > 0 && (
                <div className="space-y-1">
                  <div className="text-xs font-medium text-muted-foreground">Top pickup dates (last 24h)</div>
                  <div className="space-y-0.5">
                    {h.topPickupDates.slice(0, 3).map((d) => (
                      <div key={d.stay_date} className="flex items-center justify-between text-xs">
                        <span>{new Date(d.stay_date).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</span>
                        <span className={d.delta >= 0 ? "text-green-600 font-medium" : "text-red-600 font-medium"}>
                          {d.delta >= 0 ? "+" : ""}{d.delta}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {h.occNext7.length > 0 && (
                <div className="space-y-1">
                  <div className="text-xs font-medium text-muted-foreground">Occupancy next 7 days</div>
                  <div className="flex gap-1">
                    {h.occNext7.map((o) => {
                      const pct = Math.max(0, Math.min(100, o.occupancy_pct));
                      const color = pct >= 85 ? "bg-red-500" : pct >= 60 ? "bg-amber-500" : "bg-green-500";
                      return (
                        <div key={o.stay_date} className="flex-1 text-center" title={`${o.stay_date}: ${pct.toFixed(0)}% (${o.rooms_sold} rooms)`}>
                          <div className="h-8 rounded bg-muted relative overflow-hidden">
                            <div className={`absolute bottom-0 left-0 right-0 ${color}`} style={{ height: `${pct}%` }} />
                          </div>
                          <div className="text-[10px] text-muted-foreground mt-0.5">
                            {new Date(o.stay_date).toLocaleDateString(undefined, { weekday: "short" }).slice(0, 2)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="text-muted-foreground text-xs space-y-0.5 pt-1 border-t">
                {h.isPrevio && h.lastPickupLive ? (
                  <div className="flex items-center gap-1">
                    <Radio className="h-3 w-3 text-primary" />
                    Previo pickup: {new Date(h.lastPickupLive).toLocaleString()}
                  </div>
                ) : (
                  <div className="truncate" title={h.last_label || ""}>
                    Pickup upload: {h.lastPickupUpload ? new Date(h.lastPickupUpload).toLocaleString() : "never"}
                  </div>
                )}
                {h.isPrevio && h.lastOccLive ? (
                  <div className="flex items-center gap-1">
                    <Radio className="h-3 w-3 text-primary" />
                    Previo occupancy: {new Date(h.lastOccLive).toLocaleString()}
                  </div>
                ) : (
                  <div>Occupancy upload: {h.lastOccUpload ? new Date(h.lastOccUpload).toLocaleString() : "never"}</div>
                )}
                {h.isPrevio && (
                  <div className="flex items-center gap-1" title={h.lastSyncError || ""}>
                    <Radio className={`h-3 w-3 ${h.lastSyncStatus === "error" ? "text-destructive" : h.lastSyncStatus === "warning" ? "text-amber-500" : "text-primary"}`} />
                    Previo sync: {h.lastSyncAt ? new Date(h.lastSyncAt).toLocaleString() : "never"}
                    {h.lastSyncStatus === "error" && <span className="text-destructive">· failed</span>}
                  </div>
                )}
                <div>Pending recs: <b className="text-foreground">{h.pending_recs}</b></div>
              </div>


              <div className="flex gap-2 flex-wrap">
                <Button size="sm" variant="outline" className="flex-1 min-w-[80px]"
                  onClick={() => navigate(`/${organizationSlug}/revenue/${h.hotel_id}`)}>
                  Open
                </Button>
                {h.isPrevio && (
                  <Button size="sm" variant="secondary" className="flex-1 min-w-[80px]"
                    onClick={() => void syncFromPrevio(h.hotel_id, h.hotel_name)}
                    title="Pull pickup, occupancy and PMS rates from Previo API">
                    <RefreshCw className="h-3 w-3 mr-1" /> Sync
                  </Button>
                )}
                <Button size="sm" variant="default" className="flex-1 min-w-[80px]"
                  onClick={() => { setHotelDialog({ id: h.hotel_id, name: h.hotel_name }); setDialogJobs([]); }}>
                  <Upload className="h-3 w-3 mr-1" /> Upload
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <HotelUploadDialog
        hotel={hotelDialog}
        onClose={() => setHotelDialog(null)}
        jobs={dialogJobs}
        setJobs={setDialogJobs}
        onComplete={() => void load()}
      />
    </div>
  );
}

type UploadKind = "pickup" | "occupancy" | "overview";

function HotelUploadDialog({ hotel, onClose, jobs, setJobs, onComplete }: {
  hotel: { id: string; name: string } | null;
  onClose: () => void;
  jobs: UploadJob[];
  setJobs: React.Dispatch<React.SetStateAction<UploadJob[]>>;
  onComplete: () => void;
}) {
  const [kind, setKind] = useState<UploadKind>("pickup");
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function addFiles(files: File[] | FileList | null) {
    if (!files) return;
    const arr = Array.from(files).filter((f) => /\.xlsx$/i.test(f.name));
    if (!arr.length) { toast.error("Only .xlsx files are accepted"); return; }
    setJobs((j) => [...j, ...arr.map((f) => ({ file: f, status: "queued" as const }))]);
  }
  function removeJob(i: number) {
    setJobs((arr) => arr.filter((_, idx) => idx !== i));
  }
  async function doUpload() {
    if (!hotel || jobs.length === 0) return;
    setBusy(true);
    const fnName: Record<UploadKind, string> = {
      pickup: "revenue-pickup-upload",
      occupancy: "revenue-occupancy-upload",
      overview: "revenue-overview-upload",
    };
    for (let i = 0; i < jobs.length; i++) {
      if (jobs[i].status === "ok") continue;
      setJobs((arr) => arr.map((j, idx) => idx === i ? { ...j, status: "uploading" } : j));
      const fd = new FormData();
      fd.append("file", jobs[i].file);
      fd.append("hotel_id", hotel.id);
      const { data, error } = await supabase.functions.invoke(fnName[kind], { body: fd });
      const apiErr = (data && data.ok === false && data.error) ? data.error : (data?.error || error?.message);
      if (apiErr) {
        setJobs((arr) => arr.map((j, idx) => idx === i ? { ...j, status: "err", message: apiErr } : j));
      } else {
        setJobs((arr) => arr.map((j, idx) => idx === i ? { ...j, status: "ok", rows: (data as any).rows, hotel: (data as any).hotel_id } : j));
      }
    }
    setBusy(false);
    onComplete();
  }

  const desc: Record<UploadKind, string> = {
    pickup: "Daily pickup deltas (e.g. 'Pickup for Hotel Ottofiori') — history kept",
    occupancy: "Future occupancy snapshot from Previo — history kept",
    overview: "Daily overview: per-room arrivals/departures, meals & housekeeping",
  };

  return (
    <Dialog open={!!hotel} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[95vw] max-w-lg max-h-[90vh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="text-base sm:text-lg pr-8 break-words">Upload for {hotel?.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 min-w-0">
          <div className="flex gap-2 text-sm flex-wrap">
            {(["pickup", "occupancy", "overview"] as UploadKind[]).map((k) => (
              <button key={k} type="button" onClick={() => setKind(k)}
                className={`px-3 py-1 rounded border ${kind === k ? "bg-primary text-primary-foreground" : "bg-background"}`}>
                {k === "pickup" ? "Pickup" : k === "occupancy" ? "Occupancy" : "Daily Overview"}
              </button>
            ))}
          </div>
          <div>
            <Label>XLSX file(s)</Label>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
              onClick={() => inputRef.current?.click()}
              className={`mt-1 cursor-pointer rounded-lg border-2 border-dashed p-6 text-center transition-colors ${dragOver ? "border-primary bg-primary/5" : "border-muted-foreground/30 hover:border-muted-foreground/60"}`}
            >
              <Upload className="h-6 w-6 mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm">Drag & drop XLSX files here, or click to browse</p>
              <p className="text-xs text-muted-foreground mt-1">{desc[kind]}</p>
              <input ref={inputRef} type="file" accept=".xlsx" multiple className="hidden"
                onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              The file's hotel name is checked — uploads to the wrong hotel are rejected.
            </p>
          </div>
          {jobs.length > 0 && (
            <div className="border rounded divide-y max-h-60 overflow-y-auto">
              {jobs.map((j, i) => (
                <div key={i} className="flex items-start justify-between p-2 text-sm gap-2 min-w-0">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    {j.status === "ok" && <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />}
                    {j.status === "err" && <XCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />}
                    {j.status === "uploading" && <Loader2 className="h-4 w-4 animate-spin shrink-0" />}
                    {j.status === "queued" && <span className="h-4 w-4 rounded-full border shrink-0" />}
                    <span className="truncate min-w-0 flex-1" title={j.file.name}>{j.file.name}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 max-w-[50%]">
                    <span className={`text-xs truncate text-right ${j.status === "err" ? "text-red-600" : "text-muted-foreground"}`} title={j.status === "err" ? j.message : undefined}>
                      {j.status === "ok" && `✓ ${j.rows} rows`}
                      {j.status === "err" && j.message}
                    </span>
                    {j.status !== "uploading" && (
                      <button onClick={() => removeJob(i)} className="text-muted-foreground hover:text-foreground shrink-0">
                        <XCircle className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-2 justify-end items-center pt-2">
            <Button variant="ghost" onClick={onClose} className="shrink-0">Close</Button>
            <Button onClick={doUpload} disabled={busy || jobs.length === 0} className="shrink-0">
              {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Upload className="h-4 w-4 mr-1" />}
              Upload {jobs.length > 0 ? `(${jobs.length})` : ""}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SummaryStat({ label, value, highlight, danger }: { label: string; value: number; highlight?: boolean; danger?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 bg-card ${danger ? "border-red-500" : highlight ? "border-primary" : ""}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-bold ${danger ? "text-red-600" : highlight ? "text-primary" : ""}`}>{value}</div>
    </div>
  );
}

function KPI({ label, value, accent }: { label: string; value: string; accent?: "up" | "down" }) {
  const color = accent === "up" ? "text-green-600" : accent === "down" ? "text-red-600" : "text-foreground";
  return (
    <div className="rounded-md border bg-muted/30 p-2 text-center">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-base font-bold leading-tight ${color}`}>{value}</div>
    </div>
  );
}
