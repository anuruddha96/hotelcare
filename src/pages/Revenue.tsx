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
import { TrendingUp, TrendingDown, Upload, AlertTriangle, ArrowLeft, RefreshCw, Sparkles, Download, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { LineChart, Line, ResponsiveContainer } from "recharts";

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
  const [uploadHotel, setUploadHotel] = useState("");
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const [uploadKind, setUploadKind] = useState<"pickup" | "occupancy">("pickup");
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
    const { data: hotelRows } = await supabase
      .from("hotel_configurations")
      .select("hotel_id, hotel_name")
      .eq("is_active", true);

    const stats: HotelStat[] = [];
    for (const h of hotelRows ?? []) {
      const [{ data: snaps }, { data: recs }, { data: alerts }, { data: lastAI }] = await Promise.all([
        supabase.from("pickup_snapshots").select("delta, captured_at, snapshot_label")
          .eq("hotel_id", h.hotel_id).order("captured_at", { ascending: false }).limit(50),
        supabase.from("rate_recommendations").select("id").eq("hotel_id", h.hotel_id).eq("status", "pending"),
        supabase.from("revenue_alerts").select("id").eq("hotel_id", h.hotel_id).is("acknowledged_at", null).eq("alert_type", "abnormal_pickup"),
        supabase.from("revenue_ai_insights").select("created_at").eq("hotel_id", h.hotel_id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      ]);

      const spark = (snaps ?? []).slice(0, 14).reverse().map((s, i) => ({ d: String(i), v: s.delta || 0 }));
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

      <details className="rounded-lg border bg-card">
        <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium flex items-center gap-2">
          <Upload className="h-4 w-4" /> Upload Previo XLSX (pickup or occupancy)
          {jobs.length > 0 && <span className="ml-2 text-xs text-muted-foreground">({jobs.length} queued)</span>}
        </summary>
        <div className="p-4 pt-0 space-y-3">
          <div className="flex gap-2 text-sm">
            <button type="button" onClick={() => setUploadKind("pickup")}
              className={`px-3 py-1 rounded border ${uploadKind==="pickup"?"bg-primary text-primary-foreground":"bg-background"}`}>Pickup</button>
            <button type="button" onClick={() => setUploadKind("occupancy")}
              className={`px-3 py-1 rounded border ${uploadKind==="occupancy"?"bg-primary text-primary-foreground":"bg-background"}`}>Occupancy</button>
            <span className="text-xs text-muted-foreground self-center">
              {uploadKind === "pickup" ? "Daily pickup deltas (history kept)" : "Future occupancy snapshot from Previo (history kept)"}
            </span>
          </div>
          <div className="grid md:grid-cols-3 gap-3">
            <div>
              <Label>Files</Label>
              <Input type="file" accept=".xlsx" multiple onChange={(e) => pickFiles(e.target.files)} />
            </div>
            <div>
              <Label>Hotel (override if header missing)</Label>
              <select className="w-full border rounded h-10 px-2 bg-background"
                value={uploadHotel} onChange={(e) => setUploadHotel(e.target.value)}>
                <option value="">Auto-detect from each file</option>
                {hotels.map((h) => <option key={h.hotel_id} value={h.hotel_id}>{h.hotel_name}</option>)}
              </select>
            </div>
            <div className="flex items-end gap-2">
              <Button onClick={uploadAll} disabled={busy || jobs.length === 0} className="flex-1">
                {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Upload className="h-4 w-4 mr-1" />}
                Upload {jobs.length > 0 ? `(${jobs.length})` : ""}
              </Button>
              {jobs.length > 0 && <Button variant="ghost" onClick={() => setJobs([])}>Clear</Button>}
            </div>
          </div>
          {jobs.length > 0 && (
            <div className="border rounded divide-y">
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
                    {j.status === "ok" && `✓ ${j.rows} rows → ${j.hotel}`}
                    {j.status === "err" && j.message}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </details>

      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-3">
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
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                {h.pickup_today >= 0
                  ? <TrendingUp className="h-4 w-4 text-green-600" />
                  : <TrendingDown className="h-4 w-4 text-red-600" />}
                <span>14d pickup Δ: <b>{h.pickup_today}</b></span>
              </div>
              {h.spark.length > 1 && (
                <div className="h-10">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={h.spark}>
                      <Line type="monotone" dataKey="v" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
              <div className="text-muted-foreground text-xs truncate" title={h.last_label || ""}>
                Last: {h.last_snapshot ? new Date(h.last_snapshot).toLocaleString() : "never"}
                {h.last_label && <> · {h.last_label}</>}
              </div>
              <div>Pending recommendations: <b>{h.pending_recs}</b></div>
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
