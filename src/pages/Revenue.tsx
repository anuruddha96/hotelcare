import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { TrendingUp, TrendingDown, Upload, AlertTriangle, ArrowLeft, RefreshCw, Sparkles } from "lucide-react";
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
}

const ALLOWED = ["admin", "top_management"];

export default function Revenue() {
  const { profile, loading } = useAuth();
  const { organizationSlug } = useParams<{ organizationSlug: string }>();
  const navigate = useNavigate();
  const [hotels, setHotels] = useState<HotelStat[]>([]);
  const [busy, setBusy] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadHotel, setUploadHotel] = useState("");

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
      const { data: snaps } = await supabase
        .from("pickup_snapshots")
        .select("delta, captured_at")
        .eq("hotel_id", h.hotel_id)
        .order("captured_at", { ascending: false })
        .limit(50);
      const { data: recs } = await supabase
        .from("rate_recommendations")
        .select("id")
        .eq("hotel_id", h.hotel_id)
        .eq("status", "pending");
      const { data: alerts } = await supabase
        .from("revenue_alerts")
        .select("id")
        .eq("hotel_id", h.hotel_id)
        .is("acknowledged_at", null)
        .eq("alert_type", "abnormal_pickup");

      stats.push({
        hotel_id: h.hotel_id,
        hotel_name: h.hotel_name,
        pickup_today: (snaps ?? []).reduce((a, r) => a + (r.delta || 0), 0),
        last_snapshot: snaps?.[0]?.captured_at ?? null,
        pending_recs: recs?.length ?? 0,
        abnormal: (alerts?.length ?? 0) > 0,
      });
    }
    setHotels(stats);
    setBusy(false);
  }

  async function doUpload() {
    if (!uploadFile) { toast.error("Pick a file"); return; }
    setBusy(true);
    const fd = new FormData();
    fd.append("file", uploadFile);
    if (uploadHotel) fd.append("hotel_id", uploadHotel);
    const { data, error } = await supabase.functions.invoke("revenue-pickup-upload", { body: fd });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`Uploaded ${data?.rows ?? 0} rows for ${data?.hotel_id}`);
    setUploadFile(null);
    void load();
  }

  async function runEngine() {
    setBusy(true);
    const { error } = await supabase.functions.invoke("revenue-engine-tick", { body: {} });
    setBusy(false);
    if (error) toast.error(error.message); else toast.success("Engine ran");
    void load();
  }

  return (
    <div className="container mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => navigate(`/${organizationSlug}`)}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <h1 className="text-2xl font-semibold">Revenue Management</h1>
        </div>
        <Button onClick={runEngine} variant="outline" disabled={busy}>
          <RefreshCw className="h-4 w-4 mr-1" /> Run engine
        </Button>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Upload className="h-4 w-4" /> Upload Previo pickup XLSX</CardTitle></CardHeader>
        <CardContent className="grid md:grid-cols-3 gap-3">
          <div>
            <Label>File</Label>
            <Input type="file" accept=".xlsx" onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)} />
          </div>
          <div>
            <Label>Hotel (override if header missing)</Label>
            <select className="w-full border rounded h-10 px-2 bg-background"
              value={uploadHotel} onChange={(e) => setUploadHotel(e.target.value)}>
              <option value="">Auto-detect from file</option>
              {hotels.map((h) => <option key={h.hotel_id} value={h.hotel_id}>{h.hotel_name}</option>)}
            </select>
          </div>
          <div className="flex items-end">
            <Button onClick={doUpload} disabled={busy || !uploadFile} className="w-full">Upload</Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-3">
        {hotels.map((h) => (
          <Card key={h.hotel_id} className={h.abnormal ? "border-red-500" : ""}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center justify-between">
                {h.hotel_name}
                {h.abnormal && <Badge variant="destructive" className="gap-1"><AlertTriangle className="h-3 w-3" />Abnormal</Badge>}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                {h.pickup_today >= 0
                  ? <TrendingUp className="h-4 w-4 text-green-600" />
                  : <TrendingDown className="h-4 w-4 text-red-600" />}
                <span>Recent pickup Δ: <b>{h.pickup_today}</b></span>
              </div>
              <div className="text-muted-foreground text-xs">
                Last snapshot: {h.last_snapshot ? new Date(h.last_snapshot).toLocaleString() : "never"}
              </div>
              <div>Pending recommendations: <b>{h.pending_recs}</b></div>
              <Button size="sm" variant="outline" className="w-full"
                onClick={() => navigate(`/${organizationSlug}/revenue/${h.hotel_id}`)}>
                Open hotel
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
