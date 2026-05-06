import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Coffee, Search, CheckCircle2, RefreshCw, MapPin, Building2, ArrowLeft } from "lucide-react";
import { toast } from "sonner";

interface HotelDef {
  hotel_id: string;
  label: string;
  restaurants: { key: string; label: string }[];
}

const HOTELS: HotelDef[] = [
  {
    hotel_id: "memories-budapest",
    label: "Hotel Memories Budapest",
    restaurants: [
      { key: "levante", label: "Levante" },
      { key: "memories_basement", label: "Hotel Breakfast" },
    ],
  },
  { hotel_id: "mika-downtown", label: "Hotel Mika Downtown", restaurants: [{ key: "main", label: "Breakfast" }] },
  { hotel_id: "ottofiori", label: "Hotel Ottofiori", restaurants: [{ key: "main", label: "Breakfast" }] },
  { hotel_id: "gozsdu-court", label: "Gozsdu Court Budapest", restaurants: [{ key: "main", label: "Breakfast" }] },
];

const STORAGE_KEY = "bb_selection_v2";

interface Selection {
  hotel_id: string;
  hotel_label: string;
  location_key: string;
  location_label: string;
}

function loadSelection(): Selection | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

export default function Breakfast() {
  const { hotelCode } = useParams<{ hotelCode?: string }>();
  const [selection, setSelection] = useState<Selection | null>(loadSelection);
  const [pickHotel, setPickHotel] = useState<HotelDef | null>(null);
  const [room, setRoom] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [served, setServed] = useState(0);
  const [savingMark, setSavingMark] = useState(false);
  const [todayList, setTodayList] = useState<any[]>([]);
  const [showList, setShowList] = useState(false);

  useEffect(() => { setResult(null); }, [selection, hotelCode]);

  function chooseHotel(h: HotelDef) {
    if (h.restaurants.length === 1) {
      const r = h.restaurants[0];
      const sel: Selection = { hotel_id: h.hotel_id, hotel_label: h.label, location_key: r.key, location_label: r.label };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sel));
      setSelection(sel);
      setPickHotel(null);
    } else {
      setPickHotel(h);
    }
  }

  function chooseRestaurant(h: HotelDef, key: string, label: string) {
    const sel: Selection = { hotel_id: h.hotel_id, hotel_label: h.label, location_key: key, location_label: label };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sel));
    setSelection(sel);
    setPickHotel(null);
  }

  function changeSelection() {
    localStorage.removeItem(STORAGE_KEY);
    setSelection(null);
    setPickHotel(null);
    setResult(null);
  }

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
    if (!selection) { setBusy(false); return; }
    const { data, error } = await supabase.functions.invoke("breakfast-public-lookup", {
      body: { hotel_id: selection.hotel_id, room: room.trim(), date },
    });
    setBusy(false);
    if (error) { setResult({ status: "error", message: error.message }); return; }
    setResult(data);
    const remaining = Math.max(0, (data?.breakfast || data?.all_inclusive || 0) - (data?.already_served || 0));
    setServed(remaining);
  }

  async function markServed() {
    if (!selection || !result || result.status !== "eligible") return;
    setSavingMark(true);
    const { error } = await supabase.functions.invoke("breakfast-mark-served", {
      body: {
        hotel_id: selection.hotel_id,
        location: selection.location_key,
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
    if (!selection) return;
    const { data, error } = await supabase
      .from("breakfast_attendance")
      .select("room_number, served_count, guest_names, created_at")
      .eq("hotel_id", selection.hotel_id)
      .eq("location", selection.location_key)
      .eq("stay_date", date)
      .order("created_at", { ascending: false });
    if (error) { setTodayList([]); return; }
    setTodayList(data ?? []);
  }

  // ── Hotel picker ──
  if (!hotelCode && !selection && !pickHotel) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <Coffee className="h-6 w-6" /> Breakfast Verification
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">Select your hotel to begin.</p>
            <div className="grid gap-2">
              {HOTELS.map((h) => (
                <Button key={h.hotel_id} variant="outline" className="h-16 text-base justify-start" onClick={() => chooseHotel(h)}>
                  <Building2 className="h-5 w-5 mr-2" /> {h.label}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Restaurant picker (Memories only) ──
  if (!hotelCode && !selection && pickHotel) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <Coffee className="h-6 w-6" /> {pickHotel.label}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">Select your restaurant.</p>
            <div className="grid gap-2">
              {pickHotel.restaurants.map((r) => (
                <Button key={r.key} variant="outline" className="h-16 text-base justify-start" onClick={() => chooseRestaurant(pickHotel, r.key, r.label)}>
                  <MapPin className="h-5 w-5 mr-2" /> {r.label}
                </Button>
              ))}
              <Button variant="ghost" size="sm" onClick={() => setPickHotel(null)}>
                <ArrowLeft className="h-4 w-4 mr-1" /> Back
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const showSnapshotWarning = result?.snapshot_date && result.snapshot_date !== date;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-xl">
            <Coffee className="h-6 w-6" /> Breakfast Verification
          </CardTitle>
          {selection && (
            <div className="flex items-center justify-between text-sm pt-1">
              <div className="flex flex-col">
                <span className="font-semibold flex items-center gap-1"><Building2 className="h-3 w-3" />{selection.hotel_label}</span>
                <span className="text-muted-foreground flex items-center gap-1 text-xs"><MapPin className="h-3 w-3" />{selection.location_label}</span>
              </div>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={changeSelection}>Change</Button>
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
              {showSnapshotWarning && (
                <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                  No overview uploaded for {date}. Showing data from {result.snapshot_date}.
                </div>
              )}
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

          {!hotelCode && selection && (
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
