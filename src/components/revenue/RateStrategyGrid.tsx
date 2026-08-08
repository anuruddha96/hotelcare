import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Loader2, CalendarRange, Info, AlertTriangle, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useTranslation } from "@/hooks/useTranslation";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  addDays, dateRange, eur, formatDay, formatMonth, formatWeekday, isWeekend,
  type DayMetrics, type RoomTypeRate,
} from "@/lib/revenueAnalytics";
import {
  localizedRoomTypeName, occupancyTone2, pickupTone, rateTone,
  DEFAULT_THRESHOLDS, type RevenueThresholds,
} from "@/lib/revenueThresholds";
import { getRevenueCurrency, moneyBase, useRevenueCurrency } from "@/lib/revenueCurrency";
import type { RevenueRoomType } from "@/hooks/useRevenueHotelData";
import { BAND_LABEL, type DemandBand } from "@/lib/demandScore";

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
  /** Internal demand grade per stay date (old-school demand book). */
  demandByDate?: Map<string, { score: number; band: DemandBand; drivers: string[] }>;
  /** Rooms still sellable per `${roomTypeLabel}|${date}`. */
  leftByTypeDate?: Map<string, number>;
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
  { value: 2, label: "Yesterday + today" },
  { value: 3, label: "Last 3 days" },
  { value: 7, label: "Last 7 days" },
  { value: 14, label: "Last 14 days" },
  { value: 30, label: "Last 30 days" },
  { value: 60, label: "Last 60 days" },
  { value: 90, label: "Last 90 days" },
];

/** Row geometry — the two panes must agree pixel for pixel. */
const ROW_H = 32;
/** Room-type group rows wrap onto two lines, so they are taller. */
const GROUP_H = 40;
const MONTH_H = 22;
const DAY_H = 46;
const HEAD_H = MONTH_H + DAY_H;
const CELL_W = 60;

const rowH = (kind: string) => (kind === "group" ? GROUP_H : ROW_H);

/** Contiguous month bands for the sticky header above the date row. */
function monthBands(dates: string[]) {
  const out: Array<{ key: string; label: string; span: number }> = [];
  for (const d of dates) {
    const key = d.slice(0, 7);
    const last = out[out.length - 1];
    if (last && last.key === key) last.span += 1;
    else out.push({ key, label: formatMonth(d), span: 1 });
  }
  return out;
}

/** Colour coding for the internal demand grade. */
function demandTone(band: DemandBand): string {
  switch (band) {
    case "very_strong": return "bg-red-500 text-white";
    case "strong": return "bg-orange-300 text-orange-950 dark:bg-orange-700 dark:text-orange-50";
    case "normal": return "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100";
    case "soft": return "bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-100";
    default: return "bg-muted text-muted-foreground";
  }
}

/** Short label so the cell stays readable at 60px. */
const DEMAND_SHORT: Record<DemandBand, string> = {
  very_strong: "V.High",
  strong: "High",
  normal: "Med",
  soft: "Low",
  weak: "Low",
};

/** How much inventory is left, colour-graded from plenty to sold out. */
function leftTone(left: number, units: number): string {
  if (units <= 0) return "text-muted-foreground";
  if (left <= 0) return "bg-destructive/20 text-destructive font-semibold";
  const pct = left / units;
  if (pct <= 0.2) return "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100";
  return "text-muted-foreground";
}

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
  | { kind: "group"; key: string; label: string; note: string; units: number; typeName: string; rawName: string }
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
  demandByDate, leftByTypeDate,
}: Props) {
  const { language } = useTranslation();
  const isMobile = useIsMobile();
  const LEFT_W = isMobile ? 124 : 200;
  const [days, setDays] = useState(30);
  const [visibleMonth, setVisibleMonth] = useState<string>(formatMonth(today));
  const [edit, setEdit] = useState<DraftEdit | null>(null);
  /** Bulk options in the price editor. */
  const [applyDays, setApplyDays] = useState(1);
  const [applyWeekdays, setApplyWeekdays] = useState<"all" | "weekend" | "weekday">("all");
  const [applyAllOcc, setApplyAllOcc] = useState(false);
  const [editMode, setEditMode] = useState<"set" | "percent">("set");
  const [saving, setSaving] = useState(false);
  const [drafts, setDrafts] = useState<Map<string, number>>(new Map());
  const [pending, setPending] = useState<PendingDraft[]>([]);
  const [pushOpen, setPushOpen] = useState(false);
  const [pushing, setPushing] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const allDates = useMemo(() => dateRange(today, addDays(today, days - 1)), [today, days]);
  /** When on, the grid shows only the cells flagged by the safety net. */
  const [reviewOnly, setReviewOnly] = useState(false);

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

  const allRows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const rt of pricedTypes) {
      const label = localizedRoomTypeName(rt.name, rt.name_translations, language);
      out.push({ kind: "group", key: `g-${rt.id}`, label, note: `×${rt.num_rooms}`, units: rt.num_rooms || 0, typeName: label, rawName: rt.name });
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
    const idx = Math.min(allDates.length - 1, Math.max(0, Math.round(el.scrollLeft / CELL_W)));
    const label = formatMonth(allDates[idx]);
    setVisibleMonth((prev) => (prev === label ? prev : label));
    const nearEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - CELL_W * 3;
    if (nearEnd) {
      setDays((d) => (d < 30 ? 30 : d < 60 ? 60 : d < 120 ? 120 : d < 180 ? 180 : d));
    }
  }

  /**
   * Save one or many drafts. The editor can set a fixed price or apply a
   * percentage change across a date range, optionally for every occupancy
   * level of the same room type. Nothing is sent to Previo here.
   */
  async function saveDraft() {
    if (!edit || !hotelId) return;
    const input = Number(edit.value);
    if (!Number.isFinite(input) || (editMode === "set" && input <= 0)) {
      toast.error("Enter a valid number"); return;
    }
    setSaving(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const start = dates.indexOf(edit.stay_date);
      const targetDates = (start >= 0 ? dates.slice(start, start + applyDays) : [edit.stay_date])
        .filter((d) =>
          applyWeekdays === "all" ? true :
          applyWeekdays === "weekend" ? isWeekend(d) : !isWeekend(d));

      const occs = applyAllOcc && edit.obk_id
        ? Array.from(priceMap.get(edit.obk_id)?.keys() ?? [edit.occupancy])
        : [edit.occupancy];

      const rowsToSave: any[] = [];
      for (const d of targetDates) {
        for (const occ of occs) {
          const current = edit.obk_id ? priceMap.get(edit.obk_id)?.get(occ)?.get(d) ?? null : null;
          const next = editMode === "set"
            ? input
            : current === null ? null : Math.round(current * (1 + input / 100));
          if (next === null || !Number.isFinite(next) || next <= 0) continue;
          rowsToSave.push({
            hotel_id: hotelId,
            organization_slug: organizationSlug ?? null,
            stay_date: d,
            obk_id: edit.obk_id,
            room_type_name: edit.room_type_name,
            occupancy: occ,
            old_price: current,
            new_price: next,
            status: "draft",
            created_by: auth.user?.id ?? null,
          });
        }
      }
      if (rowsToSave.length === 0) { toast.error("Nothing to change with these options"); return; }

      const { error } = await supabase.from("revenue_rate_drafts").upsert(rowsToSave, {
        onConflict: "hotel_id,stay_date,room_type_name,occupancy,status",
      });
      if (error) throw error;
      await refreshDrafts();
      toast.success(`${rowsToSave.length} price${rowsToSave.length === 1 ? "" : "s"} saved as draft — not sent to Previo yet`);
      setEdit(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the draft");
    } finally {
      setSaving(false);
    }
  }

  /** Cells priced below the critical safety-net threshold — likely typos. */
  const flagged = useMemo(() => {
    let count = 0;
    const dateKeys = new Set<string>();
    const rowKeys = new Set<string>();
    for (const r of allRows) {
      if (r.kind !== "rate" || !r.obk) continue;
      for (const d of allDates) {
        const p = priceMap.get(r.obk)?.get(r.occ)?.get(d);
        if (rateTone(p, thresholds).severity === "critical") {
          count += 1;
          dateKeys.add(d);
          rowKeys.add(r.key);
        }
      }
    }
    return { count, dateKeys, rowKeys };
  }, [allRows, allDates, priceMap, thresholds]);

  const suspicious = flagged.count;

  useEffect(() => { if (suspicious === 0) setReviewOnly(false); }, [suspicious]);

  const dates = reviewOnly && flagged.dateKeys.size
    ? allDates.filter((d) => flagged.dateKeys.has(d))
    : allDates;
  const rows = reviewOnly && flagged.rowKeys.size
    ? allRows.filter((r) => (r.kind === "rate" ? flagged.rowKeys.has(r.key) : r.kind !== "group"))
    : allRows;

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
              <span className="flex items-center gap-1">
                <button type="button" onClick={() => setReviewOnly((v) => !v)}>
                  <Badge variant={reviewOnly ? "default" : "destructive"} className="gap-1 font-normal cursor-pointer">
                    <AlertTriangle className="h-3 w-3" />
                    {reviewOnly ? "Showing" : "Review"} {suspicious} price{suspicious === 1 ? "" : "s"}
                  </Badge>
                </button>
                <MetricInfo
                  title="Prices to review"
                  body={`${suspicious} price cells are below your critical safety-net threshold (set in Revenue settings). That is usually a typing mistake (e.g. 2 EUR instead of 200) or a rate that was never loaded for that date. Tap the badge to show only those cells; tap again to see the whole calendar.`}
                />
              </span>
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
        <p className="text-[11px] text-muted-foreground">
          Prices come straight from the Previo pricelist (one row per room type and guest count).
          Pickup and occupancy come from Previo reservations; ADR and RevPAR are calculated in Hotel Care.
          {canEditRates ? " Tap any price to draft a change — nothing reaches Previo until you push it." : ""}
        </p>
        {canEditRates && pending.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-primary/40 bg-primary/5 px-3 py-2">
            <span className="text-xs">
              <strong>{pending.length}</strong> price change{pending.length === 1 ? "" : "s"} saved as draft — not in Previo yet.
            </span>
            <Button size="sm" className="h-8 text-xs" onClick={() => setPushOpen(true)}>
              <Send className="h-3.5 w-3.5 mr-1" />Review &amp; push
            </Button>
          </div>
        )}
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
                  body="New room-nights booked in the selected window minus room-nights cancelled in the same window. Negative means the date lost rooms. Source: Previo reservations."
                />
              </div>
              <div className="flex items-center px-2 border-b font-medium" style={{ height: ROW_H }}>
                Occupancy
                <MetricInfo
                  title="Occupancy"
                  body="Rooms sold ÷ sellable rooms for that night. Rooms sold come from Previo; the sellable-room count comes from your room types (non-sellable products excluded)."
                />
              </div>
              <div className="flex items-center px-2 border-b font-medium" style={{ height: ROW_H }}>
                Left to sell
                <MetricInfo
                  title="Rooms left to sell"
                  body="Sellable rooms minus rooms sold for that night, for the whole house. The room-type rows show the same figure per room type."
                />
              </div>
              <div className="flex items-center px-2 border-b font-medium" style={{ height: ROW_H }}>
                Demand
                <MetricInfo
                  title="Demand grade"
                  body="Hotel Care's own 0–100 demand grade for that date, built from booking pace against comparable weekdays, recent pickup, how much inventory is left this close to arrival, recorded events and any manual manager override. Low / Med / High / V.High."
                />
              </div>
              {rows.map((r) => (
                <div
                  key={r.key}
                  className={`flex items-center px-2 border-b ${r.kind === "group" ? "bg-muted/50 font-semibold" : r.kind === "rate" ? "text-muted-foreground" : "bg-primary/10 border-l-2 border-l-primary font-semibold"}`}
                  style={{ height: rowH(r.kind) }}
                >
                  {r.kind === "group" ? (
                    <span className="leading-tight line-clamp-2 break-words" title={r.label}>
                      {r.label}
                      <span className="ml-1 text-[10px] font-normal text-muted-foreground">{r.note}</span>
                    </span>
                  ) : (
                    <span className="truncate" title={r.label}>{r.label}</span>
                  )}
                  {r.kind === "adr" && (
                    <MetricInfo
                      title="ADR = Average Daily Rate"
                      body="Room revenue ÷ rooms sold. The average price of the rooms you actually sold that night. Calculated in Hotel Care from Previo booking data."
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
                {/* Month band — always tells you which month you are scrolled into */}
                <div className="flex bg-muted/60" style={{ height: MONTH_H }}>
                  {monthBands(dates).map((b) => (
                    <div
                      key={b.key}
                      className="shrink-0 flex items-center border-l-2 border-l-foreground/30 px-2 text-[11px] font-semibold"
                      style={{ width: b.span * CELL_W }}
                    >
                      <span className="sticky left-1 truncate">{b.label}</span>
                    </div>
                  ))}
                </div>
                {/* Date header */}
                <div className="flex border-b bg-card" style={{ height: DAY_H }}>
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

                {/* Left to sell — house level */}
                <div className="flex border-b" style={{ height: ROW_H }}>
                  {dates.map((d) => {
                    const m = metricByDate.get(d);
                    const units = m?.roomsAvailable ?? 0;
                    const left = m?.roomsLeft ?? 0;
                    return (
                      <div
                        key={d}
                        title={`${left} of ${units} rooms left to sell on ${d}`}
                        className={`flex flex-col items-center justify-center shrink-0 tabular-nums ${leftTone(left, units)} ${d.endsWith("-01") ? "border-l-2 border-l-foreground/30" : ""}`}
                        style={{ width: CELL_W }}
                      >
                        <span className="leading-none">{units ? (left === 0 ? "Sold out" : left) : "—"}</span>
                        {units > 0 && (
                          <span className="mt-0.5 h-1 w-8 rounded-full bg-muted overflow-hidden">
                            <span
                              className="block h-full bg-primary/60"
                              style={{ width: `${Math.round((left / units) * 100)}%` }}
                            />
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Demand grade */}
                <div className="flex border-b" style={{ height: ROW_H }}>
                  {dates.map((d) => {
                    const dem = demandByDate?.get(d);
                    return (
                      <div
                        key={d}
                        title={dem
                          ? `${d} · demand ${BAND_LABEL[dem.band]} (${dem.score}/100)\n${dem.drivers.slice(0, 4).join("\n")}`
                          : `${d} · demand not available yet`}
                        className={`flex items-center justify-center shrink-0 text-[10px] font-semibold ${dem ? demandTone(dem.band) : "text-muted-foreground"} ${d.endsWith("-01") ? "border-l-2 border-l-foreground/30" : ""}`}
                        style={{ width: CELL_W }}
                      >
                        {dem ? DEMAND_SHORT[dem.band] : "·"}
                      </div>
                    );
                  })}
                </div>

                {/* Room-type / metric rows */}
                {rows.map((row) => (
                  <div
                    key={row.key}
                    className={`flex border-b ${row.kind === "group" ? "bg-muted/50" : row.kind === "rate" ? "" : "bg-primary/10 font-semibold"}`}
                    style={{ height: rowH(row.kind) }}
                  >
                    {dates.map((d) => {
                      if (row.kind === "group") {
                        const units = row.units;
                        const left = leftByTypeDate?.get(`${row.rawName}|${d}`);
                        return (
                          <div
                            key={d}
                            title={left === undefined
                              ? `${row.typeName} · availability not synced for ${d}`
                              : `${row.typeName} · ${left} of ${units} left on ${d}`}
                            className={`flex items-center justify-center shrink-0 text-[10px] tabular-nums ${left === undefined ? "text-muted-foreground" : leftTone(left, units)} ${d.endsWith("-01") ? "border-l-2 border-l-foreground/30" : ""}`}
                            style={{ width: CELL_W }}
                          >
                            {left === undefined ? "" : left === 0 ? "Sold out" : `${left} left`}
                          </div>
                        );
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
                          onClick={() => canEditRates && (setApplyDays(1), setApplyWeekdays("all"), setApplyAllOcc(false), setEditMode("set"), setEdit({
                            stay_date: d,
                            obk_id: row.obk,
                            room_type_name: row.roomTypeName,
                            occupancy: row.occ,
                            old_price: published ?? null,
                            value: String(shown ?? ""),
                          }))}
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

              <div className="flex rounded-md border overflow-hidden w-fit">
                <Button
                  size="sm" variant={editMode === "set" ? "default" : "ghost"}
                  className="h-8 rounded-none px-3 text-xs" onClick={() => setEditMode("set")}
                >Set price</Button>
                <Button
                  size="sm" variant={editMode === "percent" ? "default" : "ghost"}
                  className="h-8 rounded-none px-3 text-xs" onClick={() => setEditMode("percent")}
                >Change %</Button>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Current</span>
                <span className="font-medium tabular-nums">{moneyBase(edit.old_price)}</span>
                <span className="text-muted-foreground">→</span>
                <Input
                  type="number"
                  inputMode="decimal"
                  className="h-9 w-28"
                  value={edit.value}
                  onChange={(e) => setEdit({ ...edit, value: e.target.value })}
                />
                <span className="text-muted-foreground">{editMode === "set" ? getRevenueCurrency().code : "%"}</span>
              </div>

              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">Apply to</label>
                <Select value={String(applyDays)} onValueChange={(v) => setApplyDays(Number(v))}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">This date only</SelectItem>
                    <SelectItem value="7">Next 7 days</SelectItem>
                    <SelectItem value="14">Next 14 days</SelectItem>
                    <SelectItem value="30">Next 30 days</SelectItem>
                    <SelectItem value="90">Next 90 days</SelectItem>
                  </SelectContent>
                </Select>
                {applyDays > 1 && (
                  <Select value={applyWeekdays} onValueChange={(v) => setApplyWeekdays(v as any)}>
                    <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Every day</SelectItem>
                      <SelectItem value="weekend">Weekends only (Fri–Sun)</SelectItem>
                      <SelectItem value="weekday">Weekdays only</SelectItem>
                    </SelectContent>
                  </Select>
                )}
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={applyAllOcc}
                    onChange={(e) => setApplyAllOcc(e.target.checked)}
                  />
                  Apply to every guest count of this room type
                </label>
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

      <Dialog open={pushOpen} onOpenChange={(o) => !o && setPushOpen(false)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-base">Send price changes to Previo</DialogTitle>
          </DialogHeader>
          <div className="max-h-[50vh] overflow-y-auto -mx-2 px-2">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr className="border-b">
                  <th className="text-left py-1.5">Date</th>
                  <th className="text-left py-1.5">Room type</th>
                  <th className="text-right py-1.5">Now</th>
                  <th className="text-right py-1.5">New</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {pending.map((d) => (
                  <tr key={d.id} className="border-b last:border-0">
                    <td className="py-1.5 whitespace-nowrap">{d.stay_date}</td>
                    <td className="py-1.5">{d.room_type_name} · {d.occupancy}g</td>
                    <td className="py-1.5 text-right tabular-nums text-muted-foreground">{moneyBase(d.old_price)}</td>
                    <td className="py-1.5 text-right tabular-nums font-semibold">{moneyBase(d.new_price)}</td>
                    <td className="py-1.5 text-right">
                      <Button
                        size="icon" variant="ghost" className="h-7 w-7"
                        aria-label="Discard this change"
                        onClick={() => void discardDraft(d.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              These prices are written to Previo immediately and become live for guests.
              Anything that fails stays here with its error so you can retry.
            </p>
            <p className="text-xs rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5">
              Writing prices back requires Previo to enable rate-write access for this property.
              Until they confirm the endpoint, pushes will fail with a Previo error and your drafts stay safe here.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPushOpen(false)}>Cancel</Button>
            <Button onClick={() => void pushDrafts()} disabled={pushing || pending.length === 0}>
              {pushing && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              Push {pending.length} change{pending.length === 1 ? "" : "s"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
