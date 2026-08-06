import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Loader2, CalendarRange, Info, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useTranslation } from "@/hooks/useTranslation";
import {
  addDays, dateRange, eur, formatDay, formatMonth, formatWeekday, isWeekend,
  type DayMetrics, type RoomTypeRate,
} from "@/lib/revenueAnalytics";
import {
  localizedRoomTypeName, occupancyTone2, pickupTone, rateTone,
  DEFAULT_THRESHOLDS, type RevenueThresholds,
} from "@/lib/revenueThresholds";
import type { RevenueRoomType } from "@/hooks/useRevenueHotelData";

interface Props {
  loading: boolean;
  today: string;
  hotelId?: string | null;
  organizationSlug?: string | null;
  roomTypes: RevenueRoomType[];
  rates: RoomTypeRate[];
  metrics: DayMetrics[];
  pickupWindowDays: number;
  onPickupWindowChange: (days: number) => void;
  thresholds?: RevenueThresholds;
  /** Only these users may draft a new price for a cell. */
  canEditRates?: boolean;
}

const RANGE_OPTIONS = [
  { value: 14, label: "14d" },
  { value: 30, label: "30d" },
  { value: 60, label: "60d" },
  { value: 90, label: "90d" },
  { value: 120, label: "120d" },
  { value: 180, label: "6m" },
];

const PICKUP_WINDOWS = [
  { value: 1, label: "Today" },
  { value: 2, label: "Last 2 days" },
  { value: 3, label: "Last 3 days" },
  { value: 7, label: "Last 7 days" },
  { value: 14, label: "Last 14 days" },
  { value: 30, label: "Last 30 days" },
];

/** Row geometry — the two panes must agree pixel for pixel. */
const ROW_H = 32;
const HEAD_H = 46;
const CELL_W = 60;
const LEFT_W = 132;

/** Small info bubble that works on hover and on touch. */
function MetricInfo({ title, body }: { title: string; body: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`What is ${title}?`}
          className="ml-1 inline-flex align-middle text-muted-foreground hover:text-foreground"
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-64 text-xs leading-relaxed">
        <p className="font-semibold mb-1">{title}</p>
        <p className="text-muted-foreground">{body}</p>
      </PopoverContent>
    </Popover>
  );
}

type Row =
  | { kind: "group"; key: string; label: string; note: string }
  | { kind: "rate"; key: string; label: string; obk: string | null; occ: number; roomTypeName: string }
  | { kind: "adr"; key: string; label: string }
  | { kind: "revpar"; key: string; label: string };

interface DraftEdit {
  stay_date: string;
  obk_id: string | null;
  room_type_name: string;
  occupancy: number;
  old_price: number | null;
  value: string;
}

interface PendingDraft {
  id: string;
  stay_date: string;
  room_type_name: string;
  occupancy: number;
  old_price: number | null;
  new_price: number;
}

/**
 * Previo-style pricelist: room types down a FROZEN left column with one
 * sub-row per guest count, dates in a horizontally scrolling pane. Mobile
 * first — the left pane never moves, the month you are looking at stays
 * visible, and scrolling to the right end automatically extends the horizon.
 */
export default function RateStrategyGrid({
  loading, today, hotelId, organizationSlug, roomTypes, rates, metrics,
  pickupWindowDays, onPickupWindowChange, thresholds = DEFAULT_THRESHOLDS, canEditRates = false,
}: Props) {
  const { language } = useTranslation();
  const [days, setDays] = useState(30);
  const [visibleMonth, setVisibleMonth] = useState<string>(formatMonth(today));
  const [edit, setEdit] = useState<DraftEdit | null>(null);
  const [saving, setSaving] = useState(false);
  const [drafts, setDrafts] = useState<Map<string, number>>(new Map());
  const scrollRef = useRef<HTMLDivElement>(null);

  const dates = useMemo(() => dateRange(today, addDays(today, days - 1)), [today, days]);

  // obk_id -> occupancy -> stay_date -> price
  const priceMap = useMemo(() => {
    const m = new Map<string, Map<number, Map<string, number>>>();
    for (const r of rates) {
      let byOcc = m.get(r.obk_id);
      if (!byOcc) { byOcc = new Map(); m.set(r.obk_id, byOcc); }
      let byDate = byOcc.get(r.occupancy);
      if (!byDate) { byDate = new Map(); byOcc.set(r.occupancy, byDate); }
      byDate.set(r.stay_date, Number(r.price));
    }
    return m;
  }, [rates]);

  const metricByDate = useMemo(() => {
    const m = new Map<string, DayMetrics>();
    for (const x of metrics) m.set(x.stay_date, x);
    return m;
  }, [metrics]);

  const pricedTypes = useMemo(() => {
    const priced = roomTypes.filter((rt) => rt.pms_room_id && priceMap.has(rt.pms_room_id));
    return priced.length ? priced : roomTypes;
  }, [roomTypes, priceMap]);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const rt of pricedTypes) {
      const label = localizedRoomTypeName(rt.name, rt.name_translations, language);
      out.push({ kind: "group", key: `g-${rt.id}`, label, note: `×${rt.num_rooms}` });
      const byOcc = rt.pms_room_id ? priceMap.get(rt.pms_room_id) : undefined;
      const occs = byOcc ? Array.from(byOcc.keys()).sort((a, b) => a - b) : [2];
      for (const occ of occs) {
        out.push({
          kind: "rate",
          key: `${rt.id}-${occ}`,
          label: `${occ} ${occ > 1 ? "guests" : "guest"}`,
          obk: rt.pms_room_id,
          occ,
          roomTypeName: label,
        });
      }
    }
    out.push({ kind: "adr", key: "adr", label: "ADR" });
    out.push({ kind: "revpar", key: "revpar", label: "RevPAR" });
    return out;
  }, [pricedTypes, priceMap, language]);

  /** Load pending drafts so edited cells show their new price immediately. */
  const refreshDrafts = useCallback(async () => {
    if (!hotelId) return;
    const { data } = await supabase
      .from("revenue_rate_drafts")
      .select("id, stay_date, room_type_name, occupancy, old_price, new_price")
      .eq("hotel_id", hotelId)
      .eq("status", "draft")
      .order("stay_date");
    const rows = (data ?? []) as PendingDraft[];
    setPending(rows);
    const m = new Map<string, number>();
    for (const d of rows) {
      m.set(`${d.stay_date}|${d.room_type_name}|${d.occupancy}`, Number(d.new_price));
    }
    setDrafts(m);
  }, [hotelId]);

  useEffect(() => { void refreshDrafts(); }, [refreshDrafts]);

  /** Send the confirmed drafts to Previo. Nothing leaves the app before this. */
  async function pushDrafts() {
    if (!hotelId || pending.length === 0) return;
    setPushing(true);
    try {
      const { data, error } = await supabase.functions.invoke("revenue-push-drafts", {
        body: { hotelId, draftIds: pending.map((d) => d.id) },
      });
      if (error) throw error;
      const res = data as { pushed?: number; failed?: number; error?: string };
      if (res?.error) throw new Error(res.error);
      if (res?.failed) {
        toast.error(`${res.pushed ?? 0} sent, ${res.failed} failed — check Sync history`);
      } else {
        toast.success(`${res?.pushed ?? 0} price change${res?.pushed === 1 ? "" : "s"} sent to Previo`);
      }
      setPushOpen(false);
      await refreshDrafts();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not push the prices to Previo");
    } finally {
      setPushing(false);
    }
  }

  async function discardDraft(id: string) {
    const { error } = await supabase.from("revenue_rate_drafts").delete().eq("id", id);
    if (error) { toast.error("Could not discard the draft"); return; }
    await refreshDrafts();
  }

  /** Sticky month label + auto-extend the horizon when the user scrolls right. */
  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const idx = Math.min(dates.length - 1, Math.max(0, Math.round(el.scrollLeft / CELL_W)));
    const label = formatMonth(dates[idx]);
    setVisibleMonth((prev) => (prev === label ? prev : label));
    const nearEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - CELL_W * 3;
    if (nearEnd) {
      setDays((d) => (d < 30 ? 30 : d < 60 ? 60 : d < 120 ? 120 : d < 180 ? 180 : d));
    }
  }

  async function saveDraft() {
    if (!edit || !hotelId) return;
    const price = Number(edit.value);
    if (!Number.isFinite(price) || price <= 0) { toast.error("Enter a valid price"); return; }
    setSaving(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const { error } = await supabase.from("revenue_rate_drafts").upsert({
        hotel_id: hotelId,
        organization_slug: organizationSlug ?? null,
        stay_date: edit.stay_date,
        obk_id: edit.obk_id,
        room_type_name: edit.room_type_name,
        occupancy: edit.occupancy,
        old_price: edit.old_price,
        new_price: price,
        status: "draft",
        created_by: auth.user?.id ?? null,
      }, { onConflict: "hotel_id,stay_date,room_type_name,occupancy,status" });
      if (error) throw error;
      setDrafts((m) => new Map(m).set(`${edit.stay_date}|${edit.room_type_name}|${edit.occupancy}`, price));
      toast.success("Saved as draft — not sent to Previo yet");
      setEdit(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the draft");
    } finally {
      setSaving(false);
    }
  }

  const suspicious = useMemo(() => {
    let n = 0;
    for (const r of rows) {
      if (r.kind !== "rate" || !r.obk) continue;
      for (const d of dates) {
        const p = priceMap.get(r.obk)?.get(r.occ)?.get(d);
        if (rateTone(p, thresholds).severity === "critical") n += 1;
      }
    }
    return n;
  }, [rows, dates, priceMap, thresholds]);

  function cellFor(row: Row, d: string) {
    if (row.kind === "group") return null;
    if (row.kind === "adr") return eur(metricByDate.get(d)?.adrEur ?? null);
    if (row.kind === "revpar") return eur(metricByDate.get(d)?.revparEur ?? null);
    return null;
  }

  return (
    <Card data-training="revenue-grid">
      <CardHeader className="pb-3 gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm sm:text-base flex items-center gap-2">
            <CalendarRange className="h-4 w-4 text-primary" />
            Rate &amp; pickup calendar
            {suspicious > 0 && (
              <Badge variant="destructive" className="gap-1 font-normal">
                <AlertTriangle className="h-3 w-3" />{suspicious} to check
              </Badge>
            )}
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={String(pickupWindowDays)} onValueChange={(v) => onPickupWindowChange(Number(v))}>
              <SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PICKUP_WINDOWS.map((p) => (
                  <SelectItem key={p.value} value={String(p.value)}>Pickup: {p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex rounded-md border overflow-hidden">
              {RANGE_OPTIONS.map((r) => (
                <Button
                  key={r.value}
                  size="sm"
                  variant={days === r.value ? "default" : "ghost"}
                  className="h-8 rounded-none px-2 text-xs"
                  onClick={() => setDays(r.value)}
                >
                  {r.label}
                </Button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1"><i className="h-3 w-3 rounded-sm bg-destructive/40 border inline-block" />needs attention</span>
          <span className="flex items-center gap-1"><i className="h-3 w-3 rounded-sm bg-amber-200 dark:bg-amber-800 border inline-block" />below target</span>
          <span className="flex items-center gap-1"><i className="h-3 w-3 rounded-sm bg-emerald-400 border inline-block" />strong</span>
          <span className="flex items-center gap-1"><i className="h-3 w-3 rounded-sm bg-sky-200 dark:bg-sky-900 border inline-block" />cancellations</span>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <div className="p-6 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading calendar…
          </div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">
            No room types yet — run a sync to pull them from Previo.
          </div>
        ) : (
          <div className="flex text-[11px] sm:text-xs">
            {/* FROZEN left pane */}
            <div className="shrink-0 border-r bg-card" style={{ width: LEFT_W }}>
              <div
                className="flex items-end px-2 pb-1 border-b bg-card font-semibold"
                style={{ height: HEAD_H }}
              >
                <span className="truncate">{visibleMonth}</span>
              </div>
              <div className="flex items-center px-2 border-b font-medium" style={{ height: ROW_H }}>
                Pickup
                <MetricInfo
                  title="Net pickup"
                  body="New room-nights booked in the selected window minus room-nights cancelled in the same window. Negative means the date lost rooms."
                />
              </div>
              <div className="flex items-center px-2 border-b font-medium" style={{ height: ROW_H }}>
                Occupancy
              </div>
              {rows.map((r) => (
                <div
                  key={r.key}
                  className={`flex items-center px-2 border-b ${r.kind === "group" ? "bg-muted/50 font-semibold" : r.kind === "rate" ? "text-muted-foreground" : "bg-muted/30 font-medium"}`}
                  style={{ height: ROW_H }}
                >
                  <span className="truncate" title={r.label}>{r.label}</span>
                  {r.kind === "group" && (
                    <span className="ml-1 text-[10px] font-normal text-muted-foreground shrink-0">{r.note}</span>
                  )}
                  {r.kind === "adr" && (
                    <MetricInfo
                      title="ADR = Average Daily Rate"
                      body="Room revenue ÷ rooms sold. The average price of the rooms you actually sold that night."
                    />
                  )}
                  {r.kind === "revpar" && (
                    <MetricInfo
                      title="RevPAR = ADR × Occupancy"
                      body="Revenue per available room: room revenue ÷ all sellable rooms. What every room in the hotel earns on average, sold or not."
                    />
                  )}
                </div>
              ))}
            </div>

            {/* SCROLLING date pane */}
            <div
              ref={scrollRef}
              onScroll={onScroll}
              className="flex-1 overflow-x-auto overscroll-x-contain"
              style={{ WebkitOverflowScrolling: "touch" } as React.CSSProperties}
            >
              <div style={{ width: dates.length * CELL_W }}>
                {/* Date header */}
                <div className="flex border-b bg-card" style={{ height: HEAD_H }}>
                  {dates.map((d) => (
                    <div
                      key={d}
                      className={`flex flex-col items-center justify-center shrink-0 ${isWeekend(d) ? "bg-muted" : ""} ${d.endsWith("-01") ? "border-l-2 border-l-foreground/30" : ""} ${d === today ? "ring-1 ring-inset ring-primary/50" : ""}`}
                      style={{ width: CELL_W }}
                    >
                      <span className="text-[10px] text-muted-foreground">{formatWeekday(d)}</span>
                      <span className="font-medium">{formatDay(d)}</span>
                    </div>
                  ))}
                </div>

                {/* Pickup */}
                <div className="flex border-b" style={{ height: ROW_H }}>
                  {dates.map((d) => {
                    const m = metricByDate.get(d);
                    const pickup = m?.netPickup ?? null;
                    const tone = pickupTone(pickup, thresholds);
                    return (
                      <div
                        key={d}
                        title={pickup === null
                          ? `${d} · pickup not available yet`
                          : `${d} · ${pickup > 0 ? "+" : ""}${pickup} (${tone.label}) — ${m?.newBookings ?? 0} new, ${m?.cancelledBookings ?? 0} cancelled`}
                        className={`flex items-center justify-center shrink-0 font-semibold tabular-nums ${tone.className} ${d.endsWith("-01") ? "border-l-2 border-l-foreground/30" : ""}`}
                        style={{ width: CELL_W }}
                      >
                        {pickup === null || pickup === 0 ? "·" : `${pickup > 0 ? "+" : ""}${pickup}`}
                      </div>
                    );
                  })}
                </div>

                {/* Occupancy */}
                <div className="flex border-b" style={{ height: ROW_H }}>
                  {dates.map((d) => {
                    const m = metricByDate.get(d);
                    const pct = m?.occupancyPct ?? 0;
                    const tone = occupancyTone2(pct, thresholds);
                    return (
                      <div
                        key={d}
                        title={`${m?.roomsSold ?? 0} / ${m?.roomsAvailable ?? 0} rooms · ${tone.label}`}
                        className={`flex items-center justify-center shrink-0 tabular-nums ${tone.className} ${d.endsWith("-01") ? "border-l-2 border-l-foreground/30" : ""}`}
                        style={{ width: CELL_W }}
                      >
                        {pct ? `${Math.round(pct)}%` : "—"}
                      </div>
                    );
                  })}
                </div>

                {/* Room-type / metric rows */}
                {rows.map((row) => (
                  <div
                    key={row.key}
                    className={`flex border-b ${row.kind === "group" ? "bg-muted/50" : row.kind === "rate" ? "" : "bg-muted/30"}`}
                    style={{ height: ROW_H }}
                  >
                    {dates.map((d) => {
                      if (row.kind === "group") {
                        return <div key={d} className="shrink-0" style={{ width: CELL_W }} />;
                      }
                      if (row.kind !== "rate") {
                        return (
                          <div
                            key={d}
                            className={`flex items-center justify-center shrink-0 tabular-nums ${d.endsWith("-01") ? "border-l-2 border-l-foreground/30" : ""}`}
                            style={{ width: CELL_W }}
                          >
                            {cellFor(row, d)}
                          </div>
                        );
                      }
                      const published = row.obk ? priceMap.get(row.obk)?.get(row.occ)?.get(d) : undefined;
                      const draft = drafts.get(`${d}|${row.roomTypeName}|${row.occ}`);
                      const shown = draft ?? published;
                      const tone = rateTone(shown, thresholds);
                      return (
                        <button
                          key={d}
                          type="button"
                          disabled={!canEditRates}
                          onClick={() => canEditRates && setEdit({
                            stay_date: d,
                            obk_id: row.obk,
                            room_type_name: row.roomTypeName,
                            occupancy: row.occ,
                            old_price: published ?? null,
                            value: String(shown ?? ""),
                          })}
                          title={`${d} · ${row.roomTypeName} · ${row.occ} guests · ${tone.label}`}
                          className={`flex items-center justify-center shrink-0 tabular-nums ${tone.className} ${isWeekend(d) ? "bg-muted/40" : ""} ${d.endsWith("-01") ? "border-l-2 border-l-foreground/30" : ""} ${canEditRates ? "hover:ring-1 hover:ring-inset hover:ring-primary/50" : "cursor-default"} ${draft !== undefined ? "underline decoration-dotted underline-offset-2" : ""}`}
                          style={{ width: CELL_W }}
                        >
                          {shown === undefined ? <span className="text-muted-foreground">—</span> : eur(shown)}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </CardContent>

      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">Edit price</DialogTitle>
          </DialogHeader>
          {edit && (
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground">
                {edit.room_type_name} · {edit.occupancy} guests · {edit.stay_date}
              </p>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Current</span>
                <span className="font-medium tabular-nums">{eur(edit.old_price)}</span>
                <span className="text-muted-foreground">→</span>
                <Input
                  type="number"
                  inputMode="decimal"
                  className="h-9 w-28"
                  value={edit.value}
                  onChange={(e) => setEdit({ ...edit, value: e.target.value })}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Saved as a draft only. Nothing is sent to Previo until a push is confirmed.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEdit(null)}>Cancel</Button>
            <Button onClick={() => void saveDraft()} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-1" />}Save draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
