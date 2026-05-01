import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Coffee, Upload, Loader2 } from "lucide-react";

export const BreakfastRosterUpload = () => {
  const [file, setFile] = useState<File | null>(null);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<{ rows: number; date: string } | null>(null);

  async function upload() {
    if (!file) { toast.error("Pick the daily_overview XLSX"); return; }
    setBusy(true);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("date", date);
    const { data, error } = await supabase.functions.invoke("breakfast-roster-upload", { body: fd });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    if (data?.error) { toast.error(data.error); return; }
    setLast({ rows: data?.rows ?? 0, date });
    setFile(null);
    toast.success(`Uploaded ${data?.rows ?? 0} rows for ${date}`);
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base"><Coffee className="h-4 w-4" /> Breakfast roster</CardTitle>
      </CardHeader>
      <CardContent className="grid md:grid-cols-3 gap-2 items-end">
        <div>
          <Label className="text-xs">Daily overview XLSX</Label>
          <Input type="file" accept=".xlsx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </div>
        <div>
          <Label className="text-xs">Date</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <Button onClick={upload} disabled={busy || !file}>
          {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Upload className="h-4 w-4 mr-1" />}
          Upload
        </Button>
        {last && <div className="md:col-span-3 text-xs text-muted-foreground">Last: {last.rows} rows for {last.date}</div>}
      </CardContent>
    </Card>
  );
};
