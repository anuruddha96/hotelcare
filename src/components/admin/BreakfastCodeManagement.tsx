import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Coffee, RefreshCw } from "lucide-react";

interface CodeRow {
  hotel_id: string;
  code: string;
  is_active: boolean;
  organization_slug: string;
}

interface HotelRow { hotel_id: string; hotel_name: string; }

export const BreakfastCodeManagement = () => {
  const [codes, setCodes] = useState<CodeRow[]>([]);
  const [hotels, setHotels] = useState<HotelRow[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function load() {
    const [{ data: c }, { data: h }] = await Promise.all([
      supabase.from("hotel_breakfast_codes").select("*"),
      supabase.from("hotel_configurations").select("hotel_id, hotel_name").eq("is_active", true),
    ]);
    setCodes((c ?? []) as CodeRow[]);
    setHotels((h ?? []) as HotelRow[]);
  }

  useEffect(() => { void load(); }, []);

  async function save(hotel_id: string) {
    const code = (edits[hotel_id] ?? "").trim();
    if (!code) { toast.error("Code required"); return; }
    setBusy(true);
    const existing = codes.find(c => c.hotel_id === hotel_id);
    const { data: prof } = await supabase.from("profiles").select("organization_slug").eq("id", (await supabase.auth.getUser()).data.user!.id).single();
    if (existing) {
      const { error } = await supabase.from("hotel_breakfast_codes").update({ code, is_active: true }).eq("hotel_id", hotel_id);
      if (error) toast.error(error.message); else toast.success("Code updated");
    } else {
      const { error } = await supabase.from("hotel_breakfast_codes").insert({ hotel_id, code, is_active: true, organization_slug: prof?.organization_slug ?? "rdhotels" });
      if (error) toast.error(error.message); else toast.success("Code created");
    }
    setBusy(false);
    setEdits(e => ({ ...e, [hotel_id]: "" }));
    void load();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><Coffee className="h-4 w-4" /> Breakfast lookup codes</CardTitle>
        <p className="text-xs text-muted-foreground">These codes let breakfast staff verify guests at <code>/bb</code> without logging in.</p>
      </CardHeader>
      <CardContent className="space-y-2">
        {hotels.map(h => {
          const cur = codes.find(c => c.hotel_id === h.hotel_id);
          return (
            <div key={h.hotel_id} className="flex items-center gap-2 border rounded p-2">
              <div className="flex-1">
                <div className="font-semibold text-sm">{h.hotel_name}</div>
                <div className="text-xs text-muted-foreground">
                  Current: {cur ? <Badge variant={cur.is_active ? "default" : "outline"}>{cur.code}</Badge> : <span>none</span>}
                </div>
              </div>
              <div>
                <Label className="text-xs">New code</Label>
                <Input value={edits[h.hotel_id] ?? ""} onChange={(e) => setEdits(s => ({ ...s, [h.hotel_id]: e.target.value }))} placeholder="e.g. mika-2026" className="w-48" />
              </div>
              <Button size="sm" onClick={() => save(h.hotel_id)} disabled={busy}>
                <RefreshCw className="h-3 w-3 mr-1" /> {cur ? "Rotate" : "Create"}
              </Button>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
};
