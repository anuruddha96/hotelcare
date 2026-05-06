import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Coffee, Search, CheckCircle2, RefreshCw, MapPin } from "lucide-react";
import { toast } from "sonner";

const LOCATIONS = [
  { key: "memories_basement", label: "Memories Basement", hotel_id: "memories-budapest" },
  { key: "levante", label: "Levante", hotel_id: "mika-downtown" },
];
const STORAGE_KEY = "bb_location_v1";

export default function Breakfast() {
  const { hotelCode } = useParams<{ hotelCode?: string }>();
  const [location, setLocation] = useState<string | null>(() => localStorage.getItem(STORAGE_KEY));
  const [room, setRoom] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [served, setServed] = useState(0);
  const [savingMark, setSavingMark] = useState(false);
  const [todayList, setTodayList] = useState<any[]>([]);
  const [showList, setShowList] = useState(false);

  const loc = LOCATIONS.find((l) => l.key === location);

  useEffect(() => { setResult(null); }, [location, hotelCode]);

  // Legacy QR flow: if hotelCode provided, use legacy lookup
  async function lookup() {
    setBusy(true);
    setResult(null);
    if (hotelCode) {
      const { data, error } = await supabase.functions.invoke("breakfast-lookup", {
        body: { code: hotelCode.trim(), room: room.trim(), date },
      });
      setBusy(false);
      if (error) { setResult({ status: "error", message: error.message }); return; }
      setResult(data);
      setServed(data?.breakfast || data?.all_inclusive || 0);
      return;
    }
    if (!loc) { setBusy(false); return; }
    const { data, error } = await supabase.functions.invoke("breakfast-public-lookup", {
      body: { hotel_id: loc.hotel_id, room: room.trim(), date },
    });
    setBusy(false);
    if (error) { setResult({ status: "error", message: error.message }); return; }
    setResult(data);
    const remaining = Math.max(0, (data?.breakfast || data?.all_inclusive || 0) - (data?.already_served || 0));
    setServed(remaining);
  }

  async function markServed() {
    if (!loc || !result || result.status !== "eligible") return;
    setSavingMark(true);
    const { error } = await supabase.functions.invoke("breakfast-mark-served", {
      body: {
        hotel_id: loc.hotel_id,
        location: loc.key,
        stay_date: date,
        room_number: result.room,
        served_count: served,
        guest_names: result.guest_names ?? null,
      },
    });
    setSavingMark(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`Marked ${served} served for room ${result.room}`);
    setRoom("");
    setResult(null);
    if (showList) void loadTodayList();
  }

  async function loadTodayList() {
    if (!loc) return;
    // Public list: requires viewer role; for staff use a server function instead.
    const { data, error } = await supabase
      .from("breakfast_attendance")
      .select("room_number, served_count, guest_names, created_at")
      .eq("hotel_id", loc.hotel_id)
      .eq("location", loc.key)
      .eq("stay_date", date)
      .order("created_at", { ascending: false });
    if (error) {
      // Non-fatal — staff may not be signed in
      setTodayList([]);
      return;
    }
    setTodayList(data ?? []);
  }

  // Location picker (public, no auth)
  if (!hotelCode && !location) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <Coffee className="h-6 w-6" /> Breakfast Verification
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">Select your breakfast location to begin.</p>
            <div className="grid gap-2">
              {LOCATIONS.map((l) => (
                <Button
                  key={l.key}
                  variant="outline"
                  className="h-16 text-base justify-start"
                  onClick={() => { localStorage.setItem(STORAGE_KEY, l.key); setLocation(l.key); }}
                >
                  <MapPin className="h-5 w-5 mr-2" /> {l.label}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-xl">
            <Coffee className="h-6 w-6" /> Breakfast Verification
          </CardTitle>
          {loc && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground flex items-center gap-1"><MapPin className="h-3 w-3" />{loc.label}</span>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { localStorage.removeItem(STORAGE_KEY); setLocation(null); }}>
                Change
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label>Room number</Label>
            <Input
              value={room}
              onChange={(e) => setRoom(e.target.value)}
              placeholder="101"
              autoFocus
              onKeyDown={(e) => { if (e.key === "Enter" && room) lookup(); }}
            />
          </div>
          <div>
            <Label>Date</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <Button onClick={lookup} disabled={busy || !room} className="w-full">
            <Search className="h-4 w-4 mr-2" /> Check
          </Button>

          {result && (
            <div className="mt-2 rounded-lg border p-4 space-y-2">
              {result.status === "eligible" && (
                <>
                  <Badge className="bg-green-600">Eligible for breakfast</Badge>
                  <div className="text-2xl font-bold flex items-center gap-2">
                    Room {result.room}
                    {result.room_suffix === "SH" && <Badge variant="secondary">Shabbat</Badge>}
                  </div>
                  {result.room_type_label && (
                    <div className="text-xs text-muted-foreground">{result.room_type_label}</div>
                  )}
                  <div className="text-sm text-muted-foreground">
                    Pax: {result.pax} · Breakfasts: {result.breakfast}
                    {result.all_inclusive > 0 ? ` · All-inclusive: ${result.all_inclusive}` : ""}
                  </div>
                  {result.already_served > 0 && (
                    <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                      Already marked today: <b>{result.already_served}</b>
                    </div>
                  )}
                  {result.guest_names && (Array.isArray(result.guest_names) ? result.guest_names.length > 0 : String(result.guest_names).trim().length > 0) && (
                    <div>
                      <div className="font-semibold mt-1 text-sm">Guests:</div>
                      {Array.isArray(result.guest_names) ? (
                        <ul className="list-disc list-inside text-sm">
                          {result.guest_names.map((n: string, i: number) => <li key={i}>{n}</li>)}
                        </ul>
                      ) : (
                        <div className="text-sm whitespace-pre-wrap">{result.guest_names}</div>
                      )}
                    </div>
                  )}
                  {!hotelCode && (
                    <div className="pt-2 border-t space-y-2">
                      <Label className="text-xs">Mark how many served now</Label>
                      <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" onClick={() => setServed(Math.max(0, served - 1))}>−</Button>
                        <div className="text-2xl font-bold w-12 text-center">{served}</div>
                        <Button variant="outline" size="sm" onClick={() => setServed(served + 1)}>+</Button>
                        <Button onClick={markServed} disabled={savingMark || served <= 0} className="flex-1 ml-2">
                          <CheckCircle2 className="h-4 w-4 mr-1" /> Confirm
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}
              {result.status === "not_eligible" && (
                <>
                  <Badge variant="destructive">Not eligible for breakfast</Badge>
                  <div>Room {result.room} · Pax {result.pax}</div>
                </>
              )}
              {result.status === "not_found" && (
                <Badge variant="outline">No reservation found for this room/date</Badge>
              )}
              {result.status === "invalid_code" && (
                <Badge variant="destructive">This hotel link is no longer valid. Please scan a fresh QR.</Badge>
              )}
              {result.status === "error" && (
                <div className="text-red-600 text-sm">{result.message}</div>
              )}
            </div>
          )}

          {!hotelCode && loc && (
            <div className="pt-2 border-t">
              <Button variant="ghost" size="sm" className="w-full" onClick={() => { setShowList(!showList); if (!showList) void loadTodayList(); }}>
                <RefreshCw className="h-3 w-3 mr-1" /> {showList ? "Hide" : "Show"} today's served list
              </Button>
              {showList && (
                <div className="mt-2 max-h-60 overflow-y-auto border rounded divide-y text-sm">
                  {todayList.length === 0 && <div className="p-2 text-muted-foreground text-xs">No entries yet (or sign-in required to view).</div>}
                  {todayList.map((row, i) => (
                    <div key={i} className="p-2 flex items-center justify-between">
                      <div>
                        <div className="font-medium">Room {row.room_number} · {row.served_count}</div>
                        <div className="text-xs text-muted-foreground">{new Date(row.created_at).toLocaleTimeString()}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
