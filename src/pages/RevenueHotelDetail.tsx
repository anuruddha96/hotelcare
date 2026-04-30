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
import { ArrowLeft } from "lucide-react";

interface Rec {
  id: string;
  stay_date: string;
  current_rate_eur: number | null;
  recommended_rate_eur: number;
  delta_eur: number;
  reason: string | null;
  status: string;
}

const ALLOWED = ["admin", "top_management"];

export default function RevenueHotelDetail() {
  const { profile, loading } = useAuth();
  const { organizationSlug, hotelId } = useParams<{ organizationSlug: string; hotelId: string }>();
  const navigate = useNavigate();
  const [recs, setRecs] = useState<Rec[]>([]);
  const [hotelName, setHotelName] = useState("");
  const [bulkRange, setBulkRange] = useState({ from: "", to: "", value: "-3", weekendValue: "-2" });

  useEffect(() => {
    if (loading) return;
    if (!profile || !ALLOWED.includes(profile.role)) {
      navigate(`/${organizationSlug || "rdhotels"}`);
      return;
    }
    void load();
  }, [loading, profile?.role, hotelId]);

  async function load() {
    if (!hotelId) return;
    const { data: h } = await supabase
      .from("hotel_configurations").select("hotel_name").eq("hotel_id", hotelId).maybeSingle();
    setHotelName(h?.hotel_name ?? hotelId);
    const { data } = await supabase
      .from("rate_recommendations")
      .select("*")
      .eq("hotel_id", hotelId)
      .order("stay_date", { ascending: true })
      .limit(120);
    setRecs((data ?? []) as Rec[]);
  }

  async function approve(rec: Rec) {
    const { error } = await supabase.from("rate_recommendations")
      .update({ status: "approved", reviewed_by: profile?.id, reviewed_at: new Date().toISOString() })
      .eq("id", rec.id);
    if (error) { toast.error(error.message); return; }
    await supabase.from("rate_history").insert({
      hotel_id: hotelId!, organization_slug: profile?.organization_slug ?? "rdhotels",
      stay_date: rec.stay_date, old_rate_eur: rec.current_rate_eur,
      new_rate_eur: rec.recommended_rate_eur, source: "engine",
      changed_by: profile?.id, notes: rec.reason ?? null,
    });
    toast.success("Approved");
    void load();
  }

  async function override(rec: Rec, newRate: number) {
    await supabase.from("rate_recommendations")
      .update({ status: "overridden", recommended_rate_eur: newRate, reviewed_by: profile?.id, reviewed_at: new Date().toISOString() })
      .eq("id", rec.id);
    await supabase.from("rate_history").insert({
      hotel_id: hotelId!, organization_slug: profile?.organization_slug ?? "rdhotels",
      stay_date: rec.stay_date, old_rate_eur: rec.current_rate_eur,
      new_rate_eur: newRate, source: "manual", changed_by: profile?.id, notes: "manual override",
    });
    toast.success("Overridden");
    void load();
  }

  async function bulkAdjust() {
    if (!bulkRange.from || !bulkRange.to) { toast.error("Pick range"); return; }
    const wd = parseFloat(bulkRange.value);
    const we = parseFloat(bulkRange.weekendValue);
    const start = new Date(bulkRange.from);
    const end = new Date(bulkRange.to);
    const inserts: any[] = [];
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      const dow = d.getUTCDay();
      const isWeekend = dow === 5 || dow === 6;
      const delta = isWeekend ? we : wd;
      inserts.push({
        hotel_id: hotelId!,
        organization_slug: profile?.organization_slug ?? "rdhotels",
        stay_date: d.toISOString().slice(0, 10),
        current_rate_eur: null,
        recommended_rate_eur: 60 + delta,
        delta_eur: delta,
        reason: `Bulk adjust ${delta > 0 ? "+" : ""}${delta}€ (${isWeekend ? "Fri/Sat" : "weekday"})`,
        status: "pending",
      });
    }
    const { error } = await supabase.from("rate_recommendations").insert(inserts);
    if (error) { toast.error(error.message); return; }
    toast.success(`Created ${inserts.length} recommendations`);
    void load();
  }

  return (
    <div className="container mx-auto p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate(`/${organizationSlug}/revenue`)}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <h1 className="text-2xl font-semibold">{hotelName}</h1>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Bulk adjust</CardTitle></CardHeader>
        <CardContent className="grid md:grid-cols-5 gap-2">
          <div><Label>From</Label><Input type="date" value={bulkRange.from} onChange={(e) => setBulkRange({ ...bulkRange, from: e.target.value })} /></div>
          <div><Label>To</Label><Input type="date" value={bulkRange.to} onChange={(e) => setBulkRange({ ...bulkRange, to: e.target.value })} /></div>
          <div><Label>Mon–Thu/Sun €</Label><Input type="number" value={bulkRange.value} onChange={(e) => setBulkRange({ ...bulkRange, value: e.target.value })} /></div>
          <div><Label>Fri/Sat €</Label><Input type="number" value={bulkRange.weekendValue} onChange={(e) => setBulkRange({ ...bulkRange, weekendValue: e.target.value })} /></div>
          <div className="flex items-end"><Button onClick={bulkAdjust} className="w-full">Apply</Button></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Recommendations (next 120 days)</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr><th className="p-2">Date</th><th>Current</th><th>Recommended</th><th>Δ</th><th>Reason</th><th>Status</th><th></th></tr>
              </thead>
              <tbody>
                {recs.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="p-2">{r.stay_date}</td>
                    <td>{r.current_rate_eur != null ? `€${r.current_rate_eur}` : "—"}</td>
                    <td className="font-semibold">€{r.recommended_rate_eur}</td>
                    <td className={r.delta_eur >= 0 ? "text-green-600" : "text-red-600"}>{r.delta_eur > 0 ? "+" : ""}{r.delta_eur}€</td>
                    <td className="text-xs">{r.reason}</td>
                    <td><Badge variant={r.status === "pending" ? "secondary" : "outline"}>{r.status}</Badge></td>
                    <td className="space-x-1">
                      {r.status === "pending" && (
                        <>
                          <Button size="sm" variant="outline" onClick={() => approve(r)}>Approve</Button>
                          <Button size="sm" variant="ghost" onClick={() => {
                            const v = prompt("New rate €", String(r.recommended_rate_eur));
                            if (v) override(r, parseFloat(v));
                          }}>Override</Button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
                {recs.length === 0 && <tr><td colSpan={7} className="p-4 text-center text-muted-foreground">No recommendations yet. Upload a pickup XLSX or run the engine.</td></tr>}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Push to Previo</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Disabled until Previo Rate API endpoint and rate-plan IDs are configured.
          <Button className="ml-2" disabled>Push approved rates</Button>
        </CardContent>
      </Card>
    </div>
  );
}
