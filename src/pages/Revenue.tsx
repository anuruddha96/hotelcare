import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Upload, AlertTriangle, ArrowLeft, RefreshCw, Sparkles, Download, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { LineChart, Line, ResponsiveContainer } from "recharts";

interface PickupDateRow { stay_date: string; delta: number }
interface OccByDate { stay_date: string; occupancy_pct: number; rooms_sold: number }

interface HotelStat {
  hotel_id: string;
  hotel_name: string;
  pickup_today: number;
  last_snapshot: string | null;
  pending_recs: number;
  abnormal: boolean;
  spark: { d: string; v: number }[];
  hasFreshAI: boolean;
  last_label: string | null;
  topPickupDates: PickupDateRow[];
  occNext7: OccByDate[];
  occAvg7: number;
  occAvg30: number;
  lastOccAt: string | null;
}

interface UploadJob {
  file: File;
  status: "queued" | "uploading" | "ok" | "err";
  message?: string;
  rows?: number;
  hotel?: string;
}

const ALLOWED = ["admin", "top_management"];

export default function Revenue() {
  const { profile, loading } = useAuth();
  const { organizationSlug } = useParams<{ organizationSlug: string }>();
  const navigate = useNavigate();
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
  }, [loading, profile?.role]);

  async function load() {
    setBusy(true);

    // Resolve org id from profile.organization_slug to scope hotels
    let orgId: string | null = null;
    if (profile?.organization_slug) {
      const { data: org } = await supabase
        .from("organizations")
        .select("id")
        .eq("slug", profile.organization_slug)
        .maybeSingle();
      orgId = org?.id ?? null;
    }

    let hq = supabase
      .from("hotel_configurations")
      .select("hotel_id, hotel_name, organization_id")
      .eq("is_active", true);
    if (orgId) hq = hq.eq("organization_id", orgId);
    const { data: hotelRows } = await hq;

    const today = new Date().toISOString().slice(0, 10);
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
      ] = await Promise.all([
        supabase.from("pickup_snapshots").select("delta, captured_at, snapshot_label")
          .eq("hotel_id", h.hotel_id).order("captured_at", { ascending: false }).limit(50),
        supabase.from("rate_recommendations").select("id").eq("hotel_id", h.hotel_id).eq("status", "pending"),
        supabase.from("revenue_alerts").select("id").eq("hotel_id", h.hotel_id).is("acknowledged_at", null).eq("alert_type", "abnormal_pickup"),
        supabase.from("revenue_ai_insights").select("created_at").eq("hotel_id", h.hotel_id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
        supabase.from("pickup_snapshots").select("stay_date, delta, captured_at")
          .eq("hotel_id", h.hotel_id).gte("stay_date", today).order("captured_at", { ascending: false }).limit(200),
        supabase.from("occupancy_snapshots").select("stay_date, occupancy_pct, rooms_sold, captured_at")
          .eq("hotel_id", h.hotel_id).gte("stay_date", today).lte("stay_date", in30)
          .order("captured_at", { ascending: false }).limit(500),
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
      const lastOccAt = (occRows ?? [])[0]?.captured_at ?? null;

      const spark = occSorted.slice(0, 14).map((r, i) => ({ d: String(i), v: r.occupancy_pct }));

      stats.push({
        hotel_id: h.hotel_id,
        hotel_name: h.hotel_name,
        pickup_today: (snaps ?? []).reduce((a, r) => a + (r.delta || 0), 0),
        last_snapshot: snaps?.[0]?.captured_at ?? null,
        last_label: snaps?.[0]?.snapshot_label ?? null,
        pending_recs: recs?.length ?? 0,
        abnormal: (alerts?.length ?? 0) > 0,
        spark,
        hasFreshAI: lastAI ? (Date.now() - new Date(lastAI.created_at).getTime()) < 12 * 3600 * 1000 : false,
        topPickupDates,
        occNext7,
        occAvg7,
        occAvg30,
        lastOccAt,
      });
    }
    setHotels(stats);
    setBusy(false);
  }

  function pickFiles(files: FileList | null) {
    if (!files) return;
    const newJobs: UploadJob[] = Array.from(files).map((f) => ({ file: f, status: "queued" }));
    setJobs((j) => [...j, ...newJobs]);
  }

  async function uploadAll() {
    if (jobs.length === 0) { toast.error("Pick at least one file"); return; }
    setBusy(true);
    for (let i = 0; i < jobs.length; i++) {
      if (jobs[i].status === "ok") continue;
      setJobs((arr) => arr.map((j, idx) => idx === i ? { ...j, status: "uploading" } : j));
      const fd = new FormData();
      fd.append("file", jobs[i].file);
      if (uploadHotel) fd.append("hotel_id", uploadHotel);
      const fn = uploadKind === "occupancy" ? "revenue-occupancy-upload" : "revenue-pickup-upload";
      const { data, error } = await supabase.functions.invoke(fn, { body: fd });
      const apiErr = (data && data.ok === false && data.error)
        ? data.error
        : (data?.error || error?.message);
      if (apiErr) {
        setJobs((arr) => arr.map((j, idx) => idx === i ? { ...j, status: "err", message: apiErr } : j));
      } else {
        setJobs((arr) => arr.map((j, idx) => idx === i ? { ...j, status: "ok", rows: data.rows, hotel: data.hotel_id } : j));
      }
    }
    setBusy(false);
    void load();
  }

  async function runEngine() {
    setBusy(true);
    const { error } = await supabase.functions.invoke("revenue-engine-tick", { body: {} });
    setBusy(false);
    if (error) toast.error(error.message); else toast.success("Engine ran");
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

      <p className="text-xs text-muted-foreground">Click <b>Upload</b> on a hotel card to add Pickup, Occupancy, or Daily Overview XLSX files. The file's hotel name is verified before saving.</p>

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

              {h.spark.length > 1 && (
                <div className="h-14 -mx-1">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={h.spark}>
                      <Line type="monotone" dataKey="v" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
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
                <div className="truncate" title={h.last_label || ""}>
                  Pickup upload: {h.last_snapshot ? new Date(h.last_snapshot).toLocaleString() : "never"}
                </div>
                <div>Occupancy upload: {h.lastOccAt ? new Date(h.lastOccAt).toLocaleString() : "never"}</div>
                <div>Pending recs: <b className="text-foreground">{h.pending_recs}</b></div>
              </div>

              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="flex-1"
                  onClick={() => navigate(`/${organizationSlug}/revenue/${h.hotel_id}`)}>
                  Open
                </Button>
                <Button size="sm" variant="default" className="flex-1"
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

function HotelUploadDialog({ hotel, onClose, jobs, setJobs, onComplete }: {
  hotel: { id: string; name: string } | null;
  onClose: () => void;
  jobs: UploadJob[];
  setJobs: React.Dispatch<React.SetStateAction<UploadJob[]>>;
  onComplete: () => void;
}) {
  const [kind, setKind] = useState<"pickup" | "occupancy">("pickup");
  const [busy, setBusy] = useState(false);

  function pick(files: FileList | null) {
    if (!files) return;
    setJobs((j) => [...j, ...Array.from(files).map((f) => ({ file: f, status: "queued" as const }))]);
  }
  async function doUpload() {
    if (!hotel || jobs.length === 0) return;
    setBusy(true);
    for (let i = 0; i < jobs.length; i++) {
      if (jobs[i].status === "ok") continue;
      setJobs((arr) => arr.map((j, idx) => idx === i ? { ...j, status: "uploading" } : j));
      const fd = new FormData();
      fd.append("file", jobs[i].file);
      fd.append("hotel_id", hotel.id);
      const fn = kind === "occupancy" ? "revenue-occupancy-upload" : "revenue-pickup-upload";
      const { data, error } = await supabase.functions.invoke(fn, { body: fd });
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

  return (
    <Dialog open={!!hotel} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload for {hotel?.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex gap-2 text-sm">
            <button type="button" onClick={() => setKind("pickup")}
              className={`px-3 py-1 rounded border ${kind === "pickup" ? "bg-primary text-primary-foreground" : "bg-background"}`}>Pickup</button>
            <button type="button" onClick={() => setKind("occupancy")}
              className={`px-3 py-1 rounded border ${kind === "occupancy" ? "bg-primary text-primary-foreground" : "bg-background"}`}>Occupancy</button>
          </div>
          <div>
            <Label>Previo XLSX file(s)</Label>
            <Input type="file" accept=".xlsx" multiple onChange={(e) => pick(e.target.files)} />
            <p className="text-xs text-muted-foreground mt-1">
              {kind === "pickup" ? "Daily pickup deltas — history kept" : "Future occupancy snapshot — history kept"}
            </p>
          </div>
          {jobs.length > 0 && (
            <div className="border rounded divide-y max-h-60 overflow-y-auto">
              {jobs.map((j, i) => (
                <div key={i} className="flex items-start justify-between p-2 text-sm gap-2">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    {j.status === "ok" && <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />}
                    {j.status === "err" && <XCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />}
                    {j.status === "uploading" && <Loader2 className="h-4 w-4 animate-spin shrink-0" />}
                    {j.status === "queued" && <span className="h-4 w-4 rounded-full border shrink-0" />}
                    <span className="truncate">{j.file.name}</span>
                  </div>
                  <span className={`text-xs ml-2 max-w-[60%] text-right ${j.status === "err" ? "text-red-600" : "text-muted-foreground"}`}>
                    {j.status === "ok" && `✓ ${j.rows} rows`}
                    {j.status === "err" && j.message}
                  </span>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={onClose}>Close</Button>
            <Button onClick={doUpload} disabled={busy || jobs.length === 0}>
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
