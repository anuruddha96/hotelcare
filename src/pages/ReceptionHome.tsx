import { useEffect, useMemo, useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Header } from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Coffee,
  Upload,
  Loader2,
  CheckCircle2,
  FileSpreadsheet,
  Clock,
  Ticket,
  Home,
  Users,
  ClipboardList,
} from "lucide-react";

interface RecentUpload {
  stay_date: string;
  rows: number;
  last_uploaded_at: string | null;
}

function tomorrowISO(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

export default function ReceptionHome() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const { organizationSlug } = useParams<{ organizationSlug: string }>();
  const orgPath = `/${organizationSlug || "rdhotels"}`;

  const [file, setFile] = useState<File | null>(null);
  const [date, setDate] = useState(tomorrowISO());
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<{
    rows: number;
    date: string;
    fileName: string;
    dates: string[];
    warnings: string[];
  } | null>(null);
  const [recent, setRecent] = useState<RecentUpload[]>([]);
  const [recentLoading, setRecentLoading] = useState(false);

  const hotelId = profile?.assigned_hotel ?? "";

  const loadRecent = useCallback(async () => {
    if (!hotelId) return;
    setRecentLoading(true);
    const { data } = await supabase
      .from("breakfast_roster")
      .select("stay_date, created_at")
      .eq("hotel_id", hotelId)
      .order("stay_date", { ascending: false })
      .limit(500);
    const grouped = new Map<string, RecentUpload>();
    (data || []).forEach((r: any) => {
      const cur = grouped.get(r.stay_date) ?? {
        stay_date: r.stay_date,
        rows: 0,
        last_uploaded_at: null,
      };
      cur.rows += 1;
      if (!cur.last_uploaded_at || r.created_at > cur.last_uploaded_at) {
        cur.last_uploaded_at = r.created_at;
      }
      grouped.set(r.stay_date, cur);
    });
    setRecent(
      Array.from(grouped.values())
        .sort((a, b) => (a.stay_date < b.stay_date ? 1 : -1))
        .slice(0, 5),
    );
    setRecentLoading(false);
  }, [hotelId]);

  useEffect(() => {
    loadRecent();
  }, [loadRecent]);

  const onDrop = useCallback((accepted: File[]) => {
    if (accepted[0]) setFile(accepted[0]);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
      "application/vnd.ms-excel": [".xls"],
    },
    multiple: false,
  });

  async function upload() {
    if (!file) {
      toast.error("Please pick the daily_overview XLSX first");
      return;
    }
    if (!hotelId) {
      toast.error("Your account isn't assigned to a hotel. Ask an admin to set it.");
      return;
    }
    setBusy(true);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("date", date);
    fd.append("hotel_id", hotelId);
    const { data, error } = await supabase.functions.invoke(
      "breakfast-roster-upload",
      { body: fd },
    );
    setBusy(false);
    if (error) {
      // Try to read the real error body — supabase-js hides it behind a
      // generic "non-2xx status code" message.
      let msg = error.message;
      try {
        const ctx = (error as any).context;
        if (ctx && typeof ctx.text === "function") {
          const txt = await ctx.text();
          try { const j = JSON.parse(txt); msg = j.error || j.message || txt || msg; }
          catch { msg = txt || msg; }
        }
      } catch { /* ignore */ }
      toast.error(msg);
      return;
    }
    if (data?.error || data?.success === false) {
      toast.error(data.error ?? "Upload failed");
      return;
    }
    setLast({
      rows: data?.rows ?? 0,
      date,
      fileName: file.name,
      dates: data?.dates ?? [],
      warnings: data?.warnings ?? [],
    });
    setFile(null);
    toast.success(`Uploaded ${data?.rows ?? 0} rows`);
    loadRecent();
  }

  const todayISO = useMemo(() => new Date().toISOString().slice(0, 10), []);

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="max-w-5xl mx-auto p-4 sm:p-6 space-y-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
            Welcome{profile?.full_name ? `, ${profile.full_name.split(" ")[0]}` : ""}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Upload tonight's Daily Overview so the breakfast team can serve guests
            correctly tomorrow morning.
          </p>
        </div>

        {/* Primary action: upload */}
        <Card className="border-2 border-primary/20 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Coffee className="h-5 w-5 text-primary" />
              Upload Daily Overview (Previo XLSX)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-xs">Hotel</Label>
                <div className="mt-1 px-3 py-2 rounded-md border bg-muted/40 text-sm font-medium">
                  {hotelId || "— not assigned —"}
                </div>
              </div>
              <div>
                <Label className="text-xs" htmlFor="stay-date">
                  Breakfast date
                </Label>
                <Input
                  id="stay-date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="mt-1"
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  Defaults to tomorrow ({tomorrowISO()}). Override if the sheet covers a different day.
                </p>
              </div>
            </div>

            <div
              {...getRootProps()}
              className={`p-8 rounded-lg border-2 border-dashed cursor-pointer transition-colors text-center ${
                isDragActive
                  ? "border-primary bg-primary/5"
                  : "border-muted-foreground/30 hover:border-primary/50 hover:bg-muted/30"
              }`}
            >
              <input {...getInputProps()} />
              <FileSpreadsheet className="h-10 w-10 mx-auto text-muted-foreground mb-2" />
              {file ? (
                <div>
                  <p className="font-medium text-sm">{file.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {(file.size / 1024).toFixed(1)} KB • click or drop another file to replace
                  </p>
                </div>
              ) : (
                <div>
                  <p className="font-medium text-sm">
                    {isDragActive ? "Drop the file here" : "Drag & drop or click to choose .xlsx"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Export the Daily Overview from Previo and pick the file here
                  </p>
                </div>
              )}
            </div>

            <Button
              onClick={upload}
              disabled={busy || !file || !hotelId}
              size="lg"
              className="w-full"
            >
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Uploading…
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4 mr-2" />
                  Upload for {date}
                </>
              )}
            </Button>

            {last && (
              <div className="flex items-start gap-2 rounded-md border border-green-200 bg-green-50 dark:bg-green-950/30 dark:border-green-900 p-3 text-sm">
                <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
                <div className="space-y-1">
                  <p>
                    <span className="font-medium">{last.rows} rooms</span> uploaded from{" "}
                    <span className="font-mono text-xs">{last.fileName}</span>
                  </p>
                  {last.dates.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      Dates in file: {last.dates.join(", ")}
                    </p>
                  )}
                  {last.warnings.length > 0 && (
                    <ul className="text-xs text-amber-700 dark:text-amber-400 list-disc list-inside">
                      {last.warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent uploads */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="h-4 w-4" />
              Recent uploads
            </CardTitle>
          </CardHeader>
          <CardContent>
            {recentLoading ? (
              <div className="text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-3 w-3 animate-spin" /> Loading…
              </div>
            ) : recent.length === 0 ? (
              <p className="text-sm text-muted-foreground">No uploads yet for this hotel.</p>
            ) : (
              <ul className="divide-y">
                {recent.map((r) => (
                  <li key={r.stay_date} className="flex items-center justify-between py-2">
                    <div className="flex items-center gap-3">
                      <span className="font-medium text-sm">{r.stay_date}</span>
                      {r.stay_date === tomorrowISO() && (
                        <Badge variant="secondary" className="text-[10px]">Tomorrow</Badge>
                      )}
                      {r.stay_date === todayISO && (
                        <Badge variant="secondary" className="text-[10px]">Today</Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {r.rows} rooms
                      {r.last_uploaded_at &&
                        ` • ${new Date(r.last_uploaded_at).toLocaleString()}`}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Read-only quick links */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Browse (read-only)</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Button variant="outline" className="justify-start" onClick={() => navigate(`${orgPath}?tab=tickets`)}>
              <Ticket className="h-4 w-4 mr-2" /> Maintenance
            </Button>
            <Button variant="outline" className="justify-start" onClick={() => navigate(`${orgPath}?tab=rooms`)}>
              <Home className="h-4 w-4 mr-2" /> Rooms
            </Button>
            <Button variant="outline" className="justify-start" onClick={() => navigate(`${orgPath}?tab=housekeeping`)}>
              <Users className="h-4 w-4 mr-2" /> Housekeeping
            </Button>
            <Button variant="outline" className="justify-start" onClick={() => navigate(`${orgPath}?tab=attendance`)}>
              <ClipboardList className="h-4 w-4 mr-2" /> Attendance
            </Button>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
