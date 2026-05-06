import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Coffee, Search, CheckCircle2, RefreshCw, MapPin, Building2, ArrowLeft, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "@/hooks/useTranslation";
import { bbT } from "@/lib/breakfast-translations";

interface HotelDef {
  hotel_id: string;
  label: string;
  restaurants: { key: string; labelKey: string }[];
}

const HOTELS: HotelDef[] = [
  {
    hotel_id: "memories-budapest",
    label: "Hotel Memories Budapest",
    restaurants: [
      { key: "levante", labelKey: "restaurant_levante" },
      { key: "memories_basement", labelKey: "restaurant_memories_basement" },
    ],
  },
  { hotel_id: "mika-downtown", label: "Hotel Mika Downtown", restaurants: [{ key: "main", labelKey: "restaurant_main" }] },
  { hotel_id: "ottofiori", label: "Hotel Ottofiori", restaurants: [{ key: "main", labelKey: "restaurant_main" }] },
  { hotel_id: "gozsdu-court", label: "Gozsdu Court Budapest", restaurants: [{ key: "main", labelKey: "restaurant_main" }] },
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
  const { language } = useTranslation();
  const tt = (k: string, vars?: Record<string, string | number>) => bbT(language, k, vars);
  const [selection, setSelection] = useState<Selection | null>(loadSelection);
  const [pickHotel, setPickHotel] = useState<HotelDef | null>(null);
  const [room, setRoom] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [served, setServed] = useState(0);
  const [savingMark, setSavingMark] = useState(false);
  const [rooms, setRooms] = useState<any[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(false);

  useEffect(() => { setResult(null); }, [selection, hotelCode]);

  function chooseHotel(h: HotelDef) {
    if (h.restaurants.length === 1) {
      const r = h.restaurants[0];
      const sel: Selection = { hotel_id: h.hotel_id, hotel_label: h.label, location_key: r.key, location_label: tt(r.labelKey) };
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
    const { data, error } = await supabase.functions.invoke("breakfast-mark-served", {
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
    if (error || (data && data.ok === false)) {
      toast.error((data && (data.error as string)) || error?.message || "Failed");
      return;
    }
    toast.success(tt("marked", { n: served, room: result.room }));
    setRoom("");
    setResult(null);
    void loadRooms();
  }

  async function loadRooms() {
    if (!selection) return;
    setRoomsLoading(true);
    const { data, error } = await supabase.functions.invoke("breakfast-public-lookup", {
      body: { hotel_id: selection.hotel_id, date, mode: "list" },
    });
    setRoomsLoading(false);
    if (error || !data) { setRooms([]); return; }
    setRooms(data.rooms ?? []);
  }

  // Initial load + on selection/date change
  useEffect(() => {
    if (!selection || hotelCode) return;
    void loadRooms();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection?.hotel_id, selection?.location_key, date]);

  // Realtime subscription on breakfast_attendance for this hotel + date
  useEffect(() => {
    if (!selection || hotelCode) return;
    let timer: any;
    const channel = supabase
      .channel(`bb-${selection.hotel_id}-${date}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "breakfast_attendance", filter: `hotel_id=eq.${selection.hotel_id}` }, () => {
        clearTimeout(timer);
        timer = setTimeout(() => void loadRooms(), 300);
      })
      .subscribe();
    return () => { clearTimeout(timer); supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection?.hotel_id, date]);

  async function openRoom(roomNum: string) {
    setRoom(roomNum);
    setBusy(true);
    setResult(null);
    const { data, error } = await supabase.functions.invoke("breakfast-public-lookup", {
      body: { hotel_id: selection!.hotel_id, room: roomNum, date },
    });
    setBusy(false);
    if (error) { setResult({ status: "error", message: error.message }); return; }
    setResult(data);
    const remaining = Math.max(0, (data?.breakfast || data?.all_inclusive || 0) - (data?.already_served || 0));
    setServed(remaining);
  }

  // ── Hotel picker ──
  if (!hotelCode && !selection && !pickHotel) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <Coffee className="h-6 w-6" /> {tt("title")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">{tt("selectHotel")}</p>
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
            <p className="text-sm text-muted-foreground">{tt("selectRestaurant")}</p>
            <div className="grid gap-2">
              {pickHotel.restaurants.map((r) => (
                <Button key={r.key} variant="outline" className="h-16 text-base justify-start" onClick={() => chooseRestaurant(pickHotel, r.key, tt(r.labelKey))}>
                  <MapPin className="h-5 w-5 mr-2" /> {tt(r.labelKey)}
                </Button>
              ))}
              <Button variant="ghost" size="sm" onClick={() => setPickHotel(null)}>
                <ArrowLeft className="h-4 w-4 mr-1" /> {tt("back")}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const showSnapshotWarning = result?.snapshot_date && result.snapshot_date !== date;

  // Cross-restaurant prior visit (only for Memories Budapest where multiple restaurants exist)
  const priorVisit: { location: string; time: string } | null = (() => {
    if (!selection || !result?.served_records?.length) return null;
    const other = (result.served_records as any[])
      .filter((s) => s.location && s.location !== selection.location_key)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())[0];
    if (!other) return null;
    const labelKey = `restaurant_${other.location}`;
    const time = new Date(other.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return { location: bbT(language, labelKey) || other.location, time };
  })();

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-xl">
            <Coffee className="h-6 w-6" /> {tt("title")}
          </CardTitle>
          {selection && (
            <div className="flex items-center justify-between text-sm pt-1">
              <div className="flex flex-col">
                <span className="font-semibold flex items-center gap-1"><Building2 className="h-3 w-3" />{selection.hotel_label}</span>
                <span className="text-muted-foreground flex items-center gap-1 text-xs"><MapPin className="h-3 w-3" />{selection.location_label}</span>
              </div>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={changeSelection}>{tt("change")}</Button>
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label>{tt("roomNumber")}</Label>
            <Input
              value={room}
              onChange={(e) => setRoom(e.target.value)}
              placeholder="101"
              autoFocus
              onKeyDown={(e) => { if (e.key === "Enter" && room) lookup(); }}
            />
          </div>
          <div>
            <Label>{tt("date")}</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <Button onClick={lookup} disabled={busy || !room} className="w-full">
            <Search className="h-4 w-4 mr-2" /> {tt("check")}
          </Button>

          {result && (
            <div className="mt-2 rounded-lg border p-4 space-y-2">
              {showSnapshotWarning && (
                <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                  {tt("snapshotWarning", { date, snapshot: result.snapshot_date })}
                </div>
              )}
              {priorVisit && (
                <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2 flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <div>
                    <div className="font-semibold">{tt("alreadyVisited", { location: priorVisit.location, time: priorVisit.time })}</div>
                    <div className="opacity-80">{tt("alreadyVisitedHelp")}</div>
                  </div>
                </div>
              )}
              {result.status === "eligible" && (
                <>
                  <Badge className="bg-green-600">{tt("eligible")}</Badge>
                  <div className="text-2xl font-bold flex items-center gap-2">
                    Room {result.room}
                    {result.room_suffix === "SH" && <Badge variant="secondary">{tt("shabbat")}</Badge>}
                  </div>
                  {result.room_type_label && (
                    <div className="text-xs text-muted-foreground">{result.room_type_label}</div>
                  )}
                  <div className="text-sm text-muted-foreground">
                    {tt("pax")}: {result.pax} · {tt("breakfasts")}: {result.breakfast}
                    {result.all_inclusive > 0 ? ` · ${tt("allInclusive")}: ${result.all_inclusive}` : ""}
                  </div>
                  {result.already_served > 0 && (
                    <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                      {tt("alreadyServed")}: <b>{result.already_served}</b>
                    </div>
                  )}
                  {result.guest_names && (Array.isArray(result.guest_names) ? result.guest_names.length > 0 : String(result.guest_names).trim().length > 0) && (
                    <div>
                      <div className="font-semibold mt-1 text-sm">{tt("guests")}:</div>
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
                      <Label className="text-xs">{tt("markHowMany")}</Label>
                      <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" onClick={() => setServed(Math.max(0, served - 1))}>−</Button>
                        <div className="text-2xl font-bold w-12 text-center">{served}</div>
                        <Button variant="outline" size="sm" onClick={() => setServed(served + 1)}>+</Button>
                        <Button onClick={markServed} disabled={savingMark || served <= 0} className="flex-1 ml-2">
                          <CheckCircle2 className="h-4 w-4 mr-1" /> {tt("confirm")}
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}
              {(result.status === "not_eligible" || result.status === "not_eligible_no_breakfast") && (
                <>
                  <Badge variant="destructive">{tt("notEligibleNoBreakfast")}</Badge>
                  <div className="text-sm">Room {result.room}{result.pax ? ` · ${tt("pax")} ${result.pax}` : ""}</div>
                  <div className="text-sm text-muted-foreground">{tt("notEligibleHelp")}</div>
                </>
              )}
              {result.status === "not_found" && (
                <Badge variant="outline">{tt("notFound")}</Badge>
              )}
              {result.status === "invalid_code" && (
                <Badge variant="destructive">{tt("invalidCode")}</Badge>
              )}
              {result.status === "error" && (
                <div className="text-red-600 text-sm">{result.message}</div>
              )}
            </div>
          )}

          {!hotelCode && selection && (
            <div className="pt-2 border-t">
              <Button variant="ghost" size="sm" className="w-full" onClick={() => { setShowList(!showList); if (!showList) void loadTodayList(); }}>
                <RefreshCw className="h-3 w-3 mr-1" /> {showList ? tt("hideServed") : tt("showServed")}
              </Button>
              {showList && (
                <div className="mt-2 max-h-60 overflow-y-auto border rounded divide-y text-sm">
                  {todayList.length === 0 && <div className="p-2 text-muted-foreground text-xs">{tt("noEntries")}</div>}
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
