import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, CalendarRange, ChevronDown, Info, AlertTriangle, Send, Trash2, History, SlidersHorizontal, Maximize2, Minimize2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useTranslation } from "@/hooks/useTranslation";
import { useIsMobile } from "@/hooks/use-mobile";
import { useUiPreference } from "@/hooks/useUiPreference";
import {
  addDays, dateRange, eur, formatDay, formatMonth, formatWeekday, isWeekend,
  type BookingNight, type DayMetrics, type RoomTypeRate,
} from "@/lib/revenueAnalytics";
import {
  localizedRoomTypeName, occupancyTone2, pickupTone, rateTone,
  DEFAULT_THRESHOLDS, type RevenueThresholds,
} from "@/lib/revenueThresholds";
import { getRevenueCurrency, moneyBase, useRevenueCurrency } from "@/lib/revenueCurrency";
import type { RevenueRoomType } from "@/hooks/useRevenueHotelData";
import { BAND_LABEL, type DemandBand } from "@/lib/demandScore";
import { useRateAudit } from "@/hooks/useRateAudit";
import { usePickupAutomationActions, type AutomationAction } from "@/hooks/usePickupAutomationActions";
import { cellKey, formatWhen, logRateChanges, type RateAuditRow } from "@/lib/rateAudit";
import { cellOriginEvents, distinctOrigins, countByOrigin, fromAuditSource, RECENT_WINDOW_MS, budapestDayStartMs, ORIGIN_DOT_CLASS, ORIGIN_LABEL, type OriginEvent, type ChangeOrigin } from "@/lib/rateOrigin";
import RateCellHistory from "@/components/revenue/RateCellHistory";
import RateActivityPanel from "@/components/revenue/RateActivityPanel";
import BulkPriceEditor from "@/components/revenue/BulkPriceEditor";
import PickupAutomationRules from "@/components/revenue/PickupAutomationRules";
import { publishRates } from "@/lib/ratePublishing";
import { rememberedRange, writeNumberPref } from "@/lib/revenuePrefs";


import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";


interface Props {
  loading: boolean;
  today: string;
  hotelId?: string | null;
  organizationSlug?: string | null;
  roomTypes: RevenueRoomType[];
  rates: RoomTypeRate[];
  metrics: DayMetrics[];
  nights?: BookingNight[];
  pickupWindowDays: number;
  onPickupWindowChange: (days: number) => void;
  thresholds?: RevenueThresholds;
  /** Only these users may draft a new price for a cell. */
  canEditRates?: boolean;
  /** Internal demand grade per stay date (old-school demand book). */
  demandByDate?: Map<string, { score: number; band: DemandBand; drivers: string[] }>;
  /** Rooms still sellable per `${roomTypeLabel}|${date}`. */
  leftByTypeDate?: Map<string, number>;
  /** Reload the hotel's rates after Previo confirms a price push. */
  onRatesUpdated?: () => void | Promise<void>;
}


const RANGE_OPTIONS = [
  { value: 14, label: "14d" },
  { value: 30, label: "30d" },
  { value: 45, label: "1.5m" },
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

/** Row geometry at 100% — the two panes must agree pixel for pixel. */
const BASE_ROW_H = 32;
/** Room-type group rows wrap onto two lines, so they are taller. */
const BASE_GROUP_H = 40;
const BASE_MONTH_H = 22;
const BASE_DAY_H = 46;
const BASE_CELL_W = 60;

/**
 * How far the calendar may be zoomed. Below 70% the prices stop being legible;
 * above 160% barely a week fits on screen, which defeats a calendar.
 */
export const GRID_ZOOM_MIN = 0.7;
export const GRID_ZOOM_MAX = 1.6;
export const GRID_ZOOM_STEP = 0.1;


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

/** Monday starts a new week — the strongest rhythm the eye can follow. */
function isMonday(d: string): boolean {
  return new Date(`${d}T00:00:00Z`).getUTCDay() === 1;
}

/** Vertical rules: month > week > day, so columns never blur together. */
function dayEdge(d: string): string {
  if (d.endsWith("-01")) return "border-l-2 border-l-foreground/40";
  if (isMonday(d)) return "border-l border-l-foreground/25";
  return "border-l border-l-border/40";
}

/** Zebra shading so a long row of numbers stays trackable. */
function dayBg(d: string, i: number): string {
  if (isWeekend(d)) return "bg-muted/60";
  return i % 2 === 1 ? "bg-foreground/[0.03]" : "";
}

/** Compact money for a 60px column; the exact figure lives in the tooltip. */
function priceLabel(v: number): string {
  if (Math.abs(v) >= 10000) {
    const k = v / 1000;
    return `${(Math.abs(k) >= 100 ? Math.round(k) : Math.round(k * 10) / 10).toString().replace(".", ",")}k`;
  }
  return eur(v);
}

/** Two or three characters that still identify a row in the collapsed rail. */
function railLabel(label: string): string {
  const words = label.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "—";
  if (words.length === 1) return words[0].slice(0, 3);
  return words.slice(0, 3).map((w) => w[0]).join("").toUpperCase();
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
  | { kind: "rate"; key: string; label: string; obk: string | null; occ: number; roomTypeName: string; displayName: string }
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
  created_at?: string | null;
  stay_date: string;

  room_type_name: string;
  occupancy: number;
  old_price: number | null;
  new_price: number;
  status?: string | null;
  confirmation_status?: string | null;
  actual_previo_price?: number | null;
  push_error?: string | null;
}


/**
 * Previo-style pricelist: room types down a FROZEN left column with one
 * sub-row per guest count, dates in a horizontally scrolling pane. Mobile
 * first — the left pane never moves, the month you are looking at stays
 * visible, and scrolling to the right end automatically extends the horizon.
 */
export default function RateStrategyGrid({
  loading, today, hotelId, organizationSlug, roomTypes, rates, metrics, nights = [],
  pickupWindowDays, onPickupWindowChange, thresholds = DEFAULT_THRESHOLDS, canEditRates = false,
  demandByDate, leftByTypeDate, onRatesUpdated,
}: Props) {
  const { language } = useTranslation();
  useRevenueCurrency(); // re-render when the Ft/€ switch flips
  const isMobile = useIsMobile();

  /**
   * Reading size of the calendar, saved on the user's profile so it follows
   * them from the office screen to a phone. Clamped so the grid can never be
   * zoomed into illegibility or down to a single visible week.
   */
  const lastZoomToast = useRef(0);
  const { value: zoom, setValue: setZoomPref } = useUiPreference<number>("revenueGridZoom", 1);
  const zoomPct = Math.round(zoom * 100);
  const setZoom = useCallback((next: number, viaGesture = false) => {
    const clamped = Math.min(GRID_ZOOM_MAX, Math.max(GRID_ZOOM_MIN, Math.round(next * 100) / 100));
    if (Math.abs(clamped - zoom) < 0.005) {
      // Say why nothing moved, in plain words, and only once per attempt.
      if (!viaGesture || Date.now() - lastZoomToast.current > 2500) {
        lastZoomToast.current = Date.now();
        toast.info(
          clamped >= GRID_ZOOM_MAX
            ? `Largest size reached (${Math.round(GRID_ZOOM_MAX * 100)}%)`
            : `Smallest size reached (${Math.round(GRID_ZOOM_MIN * 100)}%)`,
          {
            description: clamped >= GRID_ZOOM_MAX
              ? "Beyond this, too few dates stay on screen to compare a week at a glance."
              : "Beyond this, prices become too small to read reliably.",
          },
        );
      }
      return;
    }
    setZoomPref(clamped);
  }, [zoom, setZoomPref]);

  const CELL_W = Math.round(BASE_CELL_W * zoom);
  const ROW_H = Math.round(BASE_ROW_H * zoom);
  const GROUP_H = Math.round(BASE_GROUP_H * zoom);
  const MONTH_H = Math.round(BASE_MONTH_H * zoom);
  const DAY_H = Math.round(BASE_DAY_H * zoom);
  const rowH = (kind: string) => (kind === "group" ? GROUP_H : ROW_H);

  const DEFAULT_LEFT_W = Math.round((isMobile ? 124 : 200) * zoom);
  const RAIL_W = 46;

  const LEFT_STORAGE_KEY = `revenue-grid-left:${hotelId ?? "default"}`;
  /** Width of the frozen room-type column, and whether it is collapsed to a rail. */
  const [leftW, setLeftW] = useState<number>(DEFAULT_LEFT_W);
  const [railed, setRailed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);

  // Remember the reader's preferred left width per hotel.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LEFT_STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as { w?: number; railed?: boolean };
      if (typeof saved.w === "number") setLeftW(Math.min(360, Math.max(96, saved.w)));
      setRailed(!!saved.railed);
    } catch { /* first visit */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [LEFT_STORAGE_KEY]);

  useEffect(() => {
    try { localStorage.setItem(LEFT_STORAGE_KEY, JSON.stringify({ w: leftW, railed })); } catch { /* private mode */ }
  }, [LEFT_STORAGE_KEY, leftW, railed]);

  const LEFT_W = railed ? RAIL_W : leftW;

  /** Drag the divider to give the room-type names more or less room. */
  const startResize = useCallback((startX: number, startW: number) => {
    setDragging(true);
    const move = (clientX: number) => {
      const next = Math.min(360, Math.max(96, startW + (clientX - startX)));
      setRailed(false);
      setLeftW(next);
    };
    const onMove = (e: PointerEvent) => move(e.clientX);
    const onUp = () => {
      setDragging(false);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, []);

  // Desktop opens on the full 6-month horizon; a phone stays at a readable
  // month. Whatever the reader picks is remembered per device.
  const [days, setDaysState] = useState(() => rememberedRange("grid-range", 30, 180));
  const setDays = useCallback((next: number | ((d: number) => number)) => {
    setDaysState((current) => {
      const value = typeof next === "function" ? next(current) : next;
      writeNumberPref("grid-range", value);
      return value;
    });
  }, []);

  // Cell dots are off by default: the date row already says which days moved
  // and by whom. The user can switch the per-cell dots on and we remember it.
  const [showMarkers, setShowMarkers] = useState(() => {
    try { return localStorage.getItem("rate-grid-change-dots") === "1"; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem("rate-grid-change-dots", showMarkers ? "1" : "0"); } catch { /* private mode */ }
  }, [showMarkers]);
  // Dots show only what moved today (Budapest). This tick re-renders the grid
  // shortly after local midnight, so yesterday's dots clear by themselves
  // while their history stays readable in the hover card.
  const [dayStart, setDayStart] = useState(() => budapestDayStartMs());
  useEffect(() => {
    const id = window.setInterval(() => {
      const next = budapestDayStartMs();
      setDayStart((prev) => (prev === next ? prev : next));
    }, 60_000);
    return () => window.clearInterval(id);
  }, []);
  const [visibleMonth, setVisibleMonth] = useState<string>(formatMonth(today));
  const [edit, setEdit] = useState<DraftEdit | null>(null);
  /** Bulk options in the price editor. */
  const [applyDays, setApplyDays] = useState(1);
  const [applyWeekdays, setApplyWeekdays] = useState<"all" | "weekend" | "weekday">("all");
  const [applyAllOcc, setApplyAllOcc] = useState(false);
  const [editMode, setEditMode] = useState<"set" | "percent">("set");
  /** Whole-day price tool, opened by tapping (or dragging across) date headers. */
  const [dayTool, setDayTool] = useState<string | null>(null);
  /** Outcome of the last direct push from the day tool. */
  const [dayResult, setDayResult] = useState<{
    pushed: number;
    failed: number;
    errors: Array<{ stay_date: string; room_type_name: string; error: string }>;
    message?: string;
  } | null>(null);
  const [dayMode, setDayMode] = useState<"percent" | "amount" | "set" | "round">("amount");
  const [dayValue, setDayValue] = useState("2");
  const [dayRange, setDayRange] = useState(1);
  const [dayWeekdays, setDayWeekdays] = useState<"all" | "weekend" | "weekday">("all");
  const [dayTypes, setDayTypes] = useState<Set<string>>(new Set());
  const [dayRound, setDayRound] = useState(1);
  /** "Show all" for the change preview in the day tool. */
  const [dayShowAll, setDayShowAll] = useState(false);
  /** The full bulk price editor (date range, weekdays, room types). */
  const [bulkOpen, setBulkOpen] = useState(false);

  /** Drag a range of dates in the header to price several days at once. */
  const [selDates, setSelDates] = useState<Set<string>>(new Set());
  const [selecting, setSelecting] = useState(false);

  const [saving, setSaving] = useState(false);
  /** Live progress of the prices currently on their way to Previo. */
  const [pushRun, setPushRun] = useState<{
    total: number; done: number; failed: number;
    state: "sending" | "done" | "error"; message?: string;
  } | null>(null);

  /** Prices that have not left the app yet (real drafts and refused rows). */
  const [drafts, setDrafts] = useState<Map<string, number>>(new Map());
  /** Prices already sent to Previo and waiting for its read-back. */
  const [inFlight, setInFlight] = useState<Map<string, number>>(new Map());
  const [pending, setPending] = useState<PendingDraft[]>([]);
  const [pushOpen, setPushOpen] = useState(false);
  const [selectedDraftIds, setSelectedDraftIds] = useState<Set<string>>(new Set());
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false);
  const [clearAllMode, setClearAllMode] = useState(false);

  const [removingDrafts, setRemovingDrafts] = useState(false);
  /** Result of the harmless Previo rate-write capability check. */
  const [probing, setProbing] = useState(false);
  const [probe, setProbe] = useState<{ ok: boolean; message: string; support?: string | null } | null>(null);

  /** Price-change trail: cell history on hover, and the activity panel below. */
  const { rows: auditRows, manualRows: auditManualRows, byCell: auditByCell, originByCell: cellOriginByCell, names: auditNames, reload: reloadAudit } = useRateAudit(hotelId);
  const { rows: automationRows, byCell: automationByCell } = usePickupAutomationActions(hotelId);

  /** One-line summary of the last Previo-confirmed change on each date. */
  const auditByDate = useMemo(() => {
    const map = new Map<string, { last: (typeof auditRows)[number]; count: number; avgDelta: number }>();
    for (const r of auditRows) {
      if (r.source !== "previo_confirmed" && r.source !== "previo_different" && r.source !== "previo_external") continue;
      if (!r.stay_date) continue;
      const cur = map.get(r.stay_date);
      if (!cur) map.set(r.stay_date, { last: r, count: 1, avgDelta: r.delta_eur ?? 0 });
      else {
        cur.avgDelta = (cur.avgDelta * cur.count + (r.delta_eur ?? 0)) / (cur.count + 1);
        cur.count += 1;
      }
    }
    return map;
  }, [auditRows]);

  /**
   * The actual changes that landed on each stay date in the last week, newest
   * first, with enough detail to read the story: who or what moved the price,
   * from what to what, and when. The date row shows one dot for the newest of
   * these; the hover card lists the last three.
   */
  const dayChangesByDate = useMemo(() => {
    interface DayChange {
      at: string; origin: ChangeOrigin; old: number | null; next: number | null;
      who: string; room: string | null; occ: number | null;
    }
    const map = new Map<string, DayChange[]>();
    const push = (date: string, c: DayChange) => {
      const b = map.get(date); if (b) b.push(c); else map.set(date, [c]);
    };
    const cutoff = Date.now() - RECENT_WINDOW_MS;
    for (const r of auditManualRows) {
      if (!r.stay_date) continue;
      const origin = fromAuditSource(r.source, r.payload?.confirmation_status);
      if (!origin) continue;
      if (Date.parse(r.performed_at) < cutoff) continue;
      push(r.stay_date, {
        at: r.performed_at, origin,
        old: r.old_rate_eur, next: r.new_rate_eur,
        who: origin === "previo"
          ? "Changed directly in Previo"
          : ((r.performed_by && auditNames.get(r.performed_by)) || "Someone on your team"),
        room: r.payload?.room_type_name ?? null,
        occ: r.payload?.occupancy ?? null,
      });
    }
    for (const a of automationRows) {
      if (a.status === "failed") continue;
      if (Date.parse(a.created_at) < cutoff) continue;
      push(a.stay_date, {
        at: a.created_at, origin: "automation",
        old: a.old_price, next: a.new_price,
        who: "Pickup automation tool",
        room: a.room_type_name, occ: a.occupancy,
      });
    }
    for (const list of map.values()) list.sort((x, y) => y.at.localeCompare(x.at));
    return map;
  }, [auditManualRows, automationRows, auditNames]);






  /**
   * Ask Previo whether this property accepts rate writes at all, by writing a
   * future date's current price back to itself. Nothing changes either way.
   */
  async function checkWriteAccess() {
    if (!hotelId) return;
    setProbing(true);
    setProbe(null);
    try {
      const { data, error } = await supabase.functions.invoke("previo-rate-write-probe", { body: { hotelId } });
      if (error) throw error;
      const res = data as { ok?: boolean; method?: string | null; error?: string; supportRequest?: string | null; attempts?: Array<{ method: string; status: number; message: string }> };
      if (res.ok) {
        setProbe({ ok: true, message: `Previo accepts price writes (${res.method}). Pushes will go live.` });
      } else {
        const first = res.attempts?.[0];
        setProbe({
          ok: false,
          message: res.error ?? `Previo refused every rate-write call${first ? ` — ${first.method}: ${first.message}` : ""}. Send the text below to Previo support.`,
          support: res.supportRequest ?? null,
        });
      }
    } catch (e) {
      setProbe({ ok: false, message: e instanceof Error ? e.message : "Could not reach Previo" });
    } finally {
      setProbing(false);
    }
  }

  const scrollRef = useRef<HTMLDivElement>(null);


  const allDates = useMemo(() => dateRange(today, addDays(today, days - 1)), [today, days]);
  /** When on, the grid shows only the cells flagged by the safety net. */
  const [reviewOnly, setReviewOnly] = useState(false);
  const [pickupOnly, setPickupOnly] = useState(false);

  /* ---- Drag across the date header to price several days at once ---- */
  const selAnchor = useRef<string | null>(null);
  const selLatest = useRef<string[]>([]);

  /** Open the day tool for an explicit set of dates. */
  const openDayTool = useCallback((picked: string[]) => {
    if (picked.length === 0) return;
    setDayTypes(new Set());
    setDayRange(1);
    setDayResult(null);
    setSelDates(new Set(picked));
    setDayTool(picked[0]);
  }, []);

  /**
   * Dates currently drawn in the header (filters applied). Dragging must only
   * ever pick from these, otherwise a "dates with pickup" selection silently
   * swallows every hidden day in between.
   */
  const visibleDatesRef = useRef<string[]>([]);

  const extendDateSelect = useCallback((d: string) => {
    const anchor = selAnchor.current;
    if (!anchor) return;
    const list = visibleDatesRef.current.length ? visibleDatesRef.current : allDates;
    const a = list.indexOf(anchor);
    const b = list.indexOf(d);
    if (a < 0 || b < 0) return;
    const span = list.slice(Math.min(a, b), Math.max(a, b) + 1);
    selLatest.current = span;
    setSelDates(new Set(span));
  }, [allDates]);

  const beginDateSelect = useCallback((d: string) => {
    selAnchor.current = d;
    selLatest.current = [d];
    setSelDates(new Set([d]));
    setSelecting(true);
    const finish = () => {
      window.removeEventListener("pointerup", finish);
      setSelecting(false);
      selAnchor.current = null;
      openDayTool(selLatest.current);
    };
    window.addEventListener("pointerup", finish);
  }, [openDayTool]);

  /** Touch-friendly alternative to dragging: tap dates to build a selection. */
  const [multiMode, setMultiMode] = useState(false);
  const [pickedDates, setPickedDates] = useState<Set<string>>(new Set());
  const togglePicked = useCallback((d: string) => {
    setPickedDates((cur) => {
      const next = new Set(cur);
      if (next.has(d)) next.delete(d); else next.add(d);
      return next;
    });
  }, []);

  /**
   * Touch gesture: press and hold a date, then slide across the header to pick
   * a range. Native drag events never fire on a phone, so the whole thing is
   * driven by touch events with a non-passive move listener (the browser must
   * be told not to scroll the grid while a range is being drawn).
   */
  const headerRowRef = useRef<HTMLDivElement | null>(null);
  const lpTimer = useRef<number | null>(null);
  const lpActive = useRef(false);
  const lpAnchor = useRef<string | null>(null);
  const lpStartX = useRef(0);
  const lpStartY = useRef(0);
  /** Stops the click that follows a long-press from undoing the selection. */
  const suppressDayClick = useRef(false);


  const cancelLongPress = useCallback(() => {
    if (lpTimer.current !== null) { window.clearTimeout(lpTimer.current); lpTimer.current = null; }
  }, []);

  const beginTouchSelect = useCallback((d: string, x: number, y: number) => {
    if (!canEditRates) return;
    cancelLongPress();
    lpStartX.current = x;
    lpStartY.current = y;
    lpTimer.current = window.setTimeout(() => {
      lpTimer.current = null;
      lpActive.current = true;
      lpAnchor.current = d;
      try { navigator.vibrate?.(15); } catch { /* not supported */ }
      setMultiMode(true);
      setPickedDates(new Set([d]));
    }, 350);
  }, [canEditRates, cancelLongPress]);

  const endTouchSelect = useCallback(() => {
    cancelLongPress();
    lpActive.current = false;
    lpAnchor.current = null;
  }, [cancelLongPress]);

  useEffect(() => {
    const el = headerRowRef.current;
    if (!el) return;
    const onMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      if (!lpActive.current) {
        // Moved before the hold completed — that is an ordinary scroll.
        if (Math.abs(t.clientX - lpStartX.current) > 8 || Math.abs(t.clientY - lpStartY.current) > 8) cancelLongPress();
        return;
      }
      e.preventDefault();
      const target = document.elementFromPoint(t.clientX, t.clientY) as HTMLElement | null;
      const d = target?.closest<HTMLElement>("[data-date]")?.dataset.date;
      const anchor = lpAnchor.current;
      if (!d || !anchor) return;
      const list = visibleDatesRef.current.length ? visibleDatesRef.current : allDates;
      const a = list.indexOf(anchor);
      const b = list.indexOf(d);
      if (a < 0 || b < 0) return;
      setPickedDates(new Set(list.slice(Math.min(a, b), Math.max(a, b) + 1)));
    };
    el.addEventListener("touchmove", onMove, { passive: false });
    return () => el.removeEventListener("touchmove", onMove);
  }, [allDates, cancelLongPress]);

  /** Price-cell history on touch: tap a cell to read who changed it and when. */
  const [cellInfo, setCellInfo] = useState<{
    date: string; roomTypeName: string; occ: number; published: number | null; draft: number | null;
    obk?: string | null;
  } | null>(null);

  /** Full-screen pricing mode — the calendar and nothing else. */
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (!expanded) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [expanded]);






  /**
   * Prices the user just published, shown before Previo answers. Keyed
   * `obk|occ|date`. They are dropped as soon as the reloaded rates agree.
   */
  const [optimistic, setOptimistic] = useState<Map<string, number>>(new Map());

  /**
   * "Your team just changed this" markers, written the moment the user
   * publishes so the blue dot appears immediately instead of waiting for the
   * audit trail. Keyed `date|roomTypeName|occ`, value = ISO time.
   */
  const [optimisticOrigin, setOptimisticOrigin] = useState<Map<string, string>>(new Map());

  // As soon as the real audit row for a cell arrives, the local marker has
  // nothing left to add — same colour, so nothing visibly flips.
  useEffect(() => {
    if (optimisticOrigin.size === 0) return;
    let changed = false;
    const next = new Map(optimisticOrigin);
    for (const [key, at] of optimisticOrigin) {
      const rows = auditByCell.get(key) ?? [];
      const covered = rows.some((r) => Date.parse(r.performed_at) >= Date.parse(at) - 120_000);
      if (covered) { next.delete(key); changed = true; }
    }
    if (changed) setOptimisticOrigin(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auditByCell]);



  // obk_id -> occupancy -> stay_date -> price
  const priceMap = useMemo(() => {
    const m = new Map<string, Map<number, Map<string, number>>>();
    const put = (obk: string, occ: number, date: string, price: number) => {
      let byOcc = m.get(obk);
      if (!byOcc) { byOcc = new Map(); m.set(obk, byOcc); }
      let byDate = byOcc.get(occ);
      if (!byDate) { byDate = new Map(); byOcc.set(occ, byDate); }
      byDate.set(date, price);
    };
    for (const r of rates) put(r.obk_id, r.occupancy, r.stay_date, Number(r.price));
    for (const [key, price] of optimistic) {
      const [obk, occ, date] = key.split("|");
      if (obk && date) put(obk, Number(occ), date, price);
    }
    return m;
  }, [rates, optimistic]);

  // Once the reloaded Previo rates match what we showed optimistically, the
  // overlay has nothing left to say.
  useEffect(() => {
    if (optimistic.size === 0) return;
    const byCell = new Map(rates.map((r) => [`${r.obk_id}|${r.occupancy}|${r.stay_date}`, Number(r.price)]));
    let changed = false;
    const next = new Map(optimistic);
    for (const [key, price] of optimistic) {
      if (byCell.get(key) === price) { next.delete(key); changed = true; }
    }
    if (changed) setOptimistic(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rates]);


  const metricByDate = useMemo(() => {
    const m = new Map<string, DayMetrics>();
    for (const x of metrics) m.set(x.stay_date, x);
    return m;
  }, [metrics]);

  /**
   * Room types must never blink out of the grid while a reload is in flight —
   * an empty prop for a moment used to leave only ADR and RevPAR on screen.
   */
  const [stickyTypes, setStickyTypes] = useState<RevenueRoomType[]>(roomTypes);
  useEffect(() => {
    if (roomTypes.length > 0) setStickyTypes(roomTypes);
  }, [roomTypes]);

  const pricedTypes = useMemo(() => {
    const source = roomTypes.length > 0 ? roomTypes : stickyTypes;
    const priced = source.filter((rt) => rt.pms_room_id && priceMap.has(rt.pms_room_id));
    return priced.length ? priced : source;
  }, [roomTypes, stickyTypes, priceMap]);


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
          roomTypeName: rt.name,
          displayName: label,
        });
      }
    }
    out.push({ kind: "adr", key: "adr", label: "ADR" });
    out.push({ kind: "revpar", key: "revpar", label: "RevPAR" });
    return out;
  }, [pricedTypes, priceMap, language]);

  /** Load unsent, failed, awaiting-confirmation and divergent cells. */
  const refreshDrafts = useCallback(async () => {
    if (!hotelId) return;
    const { data } = await supabase
      .from("revenue_rate_drafts")
      .select("id, created_at, stay_date, room_type_name, occupancy, old_price, new_price, status, confirmation_status, actual_previo_price, push_error")
      .eq("hotel_id", hotelId)
      .or("status.in.(draft,failed),and(status.eq.pushed,confirmation_status.in.(sending,sent,checking,pending,different))")
      .order("stay_date");
    const all = (data ?? []) as PendingDraft[];
    // Only the newest request per cell still means anything. An older request
    // for the same cell was replaced on purpose, so it must not be reported as
    // "landed on a different price".
    const newestByCell = new Map<string, PendingDraft>();
    for (const d of all) {
      const key = `${d.stay_date}|${d.room_type_name}|${d.occupancy}`;
      const prev = newestByCell.get(key);
      if (!prev || String(d.created_at ?? "") > String(prev.created_at ?? "")) newestByCell.set(key, d);
    }
    const rows = all.filter((d) => newestByCell.get(`${d.stay_date}|${d.room_type_name}|${d.occupancy}`)?.id === d.id);
    setPending(rows);


    // A price that is still with us and a price Previo already took are two
    // different stories: only the first one is a draft.
    const unsentMap = new Map<string, number>();
    const inFlightMap = new Map<string, number>();
    for (const d of rows) {
      const key = `${d.stay_date}|${d.room_type_name}|${d.occupancy}`;
      const price = Number(d.new_price);
      if (d.status === "pushed" && d.confirmation_status !== "different") inFlightMap.set(key, price);
      else unsentMap.set(key, price);
    }
    setDrafts(unsentMap);
    setInFlight(inFlightMap);
  }, [hotelId]);

  useEffect(() => { void refreshDrafts(); }, [refreshDrafts]);

  const failedCount = useMemo(() => pending.filter((d) => d.status === "failed").length, [pending]);
  /** Cells Previo refused, so the grid can say so plainly. */
  const failedCells = useMemo(
    () => new Set(pending.filter((d) => d.status === "failed")
      .map((d) => cellKey(d.stay_date, d.room_type_name, d.occupancy))),
    [pending],
  );

  // Three very different states used to be counted as one "waiting" number:
  // a price nobody has sent yet, a price Previo already accepted, and a price
  // that landed on a different value. Keeping them apart is the difference
  // between "the push failed" and "the push is done".
  const awaitingDrafts = useMemo(
    () => pending.filter((d) => d.status === "pushed" && d.confirmation_status !== "different"),
    [pending],
  );
  const divergentDrafts = useMemo(
    () => pending.filter((d) => d.confirmation_status === "different"),
    [pending],
  );

  /**
   * Confirmation is nobody's chore. While prices are still waiting for Previo's
   * read-back, the app quietly re-checks on its own: a couple of cheap refreshes
   * first, then an authoritative Previo read if anything is still open.
   */
  const awaitingCount = awaitingDrafts.length;
  const confirmRefs = useRef({ refreshDrafts, reloadAudit, onRatesUpdated });
  confirmRefs.current = { refreshDrafts, reloadAudit, onRatesUpdated };
  useEffect(() => {
    if (!hotelId || awaitingCount === 0) return;
    let cancelled = false;
    const timers: number[] = [];
    const soft = async () => {
      if (cancelled) return;
      const r = confirmRefs.current;
      await Promise.all([r.refreshDrafts(), r.reloadAudit(), r.onRatesUpdated?.()]);
    };
    timers.push(window.setTimeout(() => void soft(), 5000));
    timers.push(window.setTimeout(() => void soft(), 15000));
    timers.push(window.setTimeout(() => void soft(), 60000));
    timers.push(window.setTimeout(() => void soft(), 150000));
    return () => { cancelled = true; timers.forEach((t) => window.clearTimeout(t)); };
  }, [hotelId, awaitingCount]);




  /** Fill the Previo pricelist mapping from Previo itself. */
  async function syncRatePlans() {
    if (!hotelId) return;
    setProbing(true);
    setProbe(null);
    try {
      const { data, error } = await supabase.functions.invoke("previo-sync-rate-plans", { body: { hotelId } });
      if (error) throw error;
      const res = data as { ok?: boolean; mapped?: number; error?: string | null };
      if (res?.ok) {
        setProbe({ ok: true, message: `Matched ${res.mapped} room type${res.mapped === 1 ? "" : "s"} to a Previo pricelist. You can push prices now.` });
      } else {
        setProbe({ ok: false, message: res?.error || "Previo did not return any pricelist." });
      }
    } catch (e) {
      setProbe({ ok: false, message: e instanceof Error ? e.message : "Could not reach Previo" });
    } finally {
      setProbing(false);
    }
  }

  async function discardDraft(id: string) {
    const { error } = await supabase.from("revenue_rate_drafts").delete().eq("id", id);
    if (error) { toast.error("Could not discard the draft"); return; }
    await refreshDrafts();
  }

  async function discardSelectedDrafts() {
    // "Clear all" wipes every waiting change; otherwise just the ticked rows.
    // Rows already accepted by Previo are cleared too — removing them only
    // stops Hotel Care waiting for a confirmation, it never changes Previo.
    const ids = clearAllMode ? pending.map((d) => d.id) : Array.from(selectedDraftIds);
    if (ids.length === 0) return;
    setRemovingDrafts(true);
    let failed = false;
    let removed = 0;
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await supabase
        .from("revenue_rate_drafts")
        .delete()
        .in("id", ids.slice(i, i + 200))
        .select("id");
      if (error) { failed = true; break; }
      removed += (data ?? []).length;
    }
    setRemovingDrafts(false);
    if (failed) { toast.error("Could not remove the drafts"); return; }
    setSelectedDraftIds(new Set());
    setRemoveConfirmOpen(false);
    setClearAllMode(false);
    await refreshDrafts();
    if (removed === 0) toast.error("Nothing was removed — you may not have permission to clear these rows.");
    else toast.success(`${removed} draft${removed === 1 ? "" : "s"} removed`);
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
   * Edge auto-scroll: a mouse user without a horizontal wheel can simply move
   * the pointer near the left/right (or top/bottom) edge of the calendar and
   * it glides that way. Speed ramps up the closer to the edge you get, and it
   * stops the moment the pointer leaves the zone, the window loses focus, or
   * a real wheel/touch scroll takes over.
   */
  const edgeVec = useRef({ x: 0, y: 0 });
  const edgeRaf = useRef<number | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (isMobile) return;

    const ZONE = 90;      // px from the edge where the pull starts
    const MAX = 26;       // px per frame at the very edge

    const stop = () => {
      edgeVec.current = { x: 0, y: 0 };
      if (edgeRaf.current !== null) { cancelAnimationFrame(edgeRaf.current); edgeRaf.current = null; }
    };

    const step = () => {
      const node = scrollRef.current;
      const { x, y } = edgeVec.current;
      if (!node || (x === 0 && y === 0)) { edgeRaf.current = null; return; }
      node.scrollLeft += x;
      node.scrollTop += y;
      edgeRaf.current = requestAnimationFrame(step);
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const r = el.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (!inside) { stop(); return; }

      const ramp = (d: number) => Math.round(MAX * Math.pow(Math.max(0, (ZONE - d) / ZONE), 2));
      let x = 0;
      const canRight = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      const canLeft = el.scrollLeft > 0;
      // The frozen room-type column owns the far left, so only pull left once
      // the pointer is past it.
      if (e.clientX > r.right - ZONE && canRight) x = ramp(r.right - e.clientX);
      else if (e.clientX < r.left + LEFT_W + ZONE && e.clientX > r.left + LEFT_W && canLeft) x = -ramp(e.clientX - (r.left + LEFT_W));

      let y = 0;
      const canDown = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
      const canUp = el.scrollTop > 0;
      if (e.clientY > r.bottom - ZONE && canDown) y = ramp(r.bottom - e.clientY);
      else if (e.clientY < r.top + ZONE && canUp) y = -ramp(e.clientY - r.top);

      edgeVec.current = { x, y };
      if ((x !== 0 || y !== 0) && edgeRaf.current === null) edgeRaf.current = requestAnimationFrame(step);
      if (x === 0 && y === 0) stop();
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("blur", stop);
    el.addEventListener("pointerleave", stop);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("blur", stop);
      el.removeEventListener("pointerleave", stop);
      stop();
    };
  }, [isMobile, LEFT_W]);


  /**
   * Send prices to Previo without making anyone wait. The grid shows the new
   * price and its change dot straight away; queueing, sending and verifying
   * all happen after the dialog has closed. Only a real failure interrupts.
   */
  const publishInBackground = useCallback((
    rowsToSave: any[],
    audit: { source: string; notes: string },
  ) => {
    if (!hotelId || rowsToSave.length === 0) return;
    // 1. Optimistic mirror — the calendar reads the new prices immediately.
    setOptimistic((prev) => {
      const next = new Map(prev);
      for (const r of rowsToSave) {
        if (r.obk_id) next.set(`${r.obk_id}|${r.occupancy}|${r.stay_date}`, Number(r.new_price));
      }
      return next;
    });
    // The change dot is part of the same promise: your colour, right away.
    const at = new Date().toISOString();
    setOptimisticOrigin((prev) => {
      const next = new Map(prev);
      for (const r of rowsToSave) next.set(cellKey(r.stay_date, r.room_type_name, r.occupancy), at);
      return next;
    });
    // The cells show the new price as "sending" straight away, without
    // waiting for the drafts table to come back.
    setInFlight((prev) => {
      const next = new Map(prev);
      for (const r of rowsToSave) next.set(`${r.stay_date}|${r.room_type_name}|${r.occupancy}`, Number(r.new_price));
      return next;
    });
    setPushRun({ total: rowsToSave.length, done: 0, failed: 0, state: "sending" });

    void (async () => {
      try {
        const { runId } = await publishRates({ hotelId, organizationSlug, source: "manual", changes: rowsToSave });

        // 2. The change dots come from the audit trail, so write it right away.
        void logRateChanges({
          hotelId,
          organizationSlug: organizationSlug ?? null,
          source: audit.source,
          action: "sent_to_previo",
          notes: audit.notes,
          changes: rowsToSave.map((r) => ({
            stay_date: r.stay_date, room_type_name: r.room_type_name, occupancy: r.occupancy,
            old_price: r.old_price, new_price: r.new_price,
          })),
        }).then(() => reloadAudit());

        // 3. Follow the run quietly and only speak up if something failed.
        for (let attempt = 0; attempt < 400; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, attempt < 5 ? 1200 : 3000));
          const { data } = await supabase.from("revenue_rate_push_runs")
            .select("status, requested_count, processed_count, accepted_count, failed_count, last_error")
            .eq("id", runId).maybeSingle();
          if (!data) continue;
          const total = Number(data.requested_count ?? rowsToSave.length);
          const done = Number(data.processed_count ?? 0);
          const failed = Number(data.failed_count ?? 0);
          const finished = data.status === "completed" || data.status === "failed" || (done > 0 && done >= total);
          setPushRun({
            total, done, failed,
            state: finished ? (failed > 0 || data.status === "failed" ? "error" : "done") : "sending",
            message: data.last_error ?? undefined,
          });
          if (finished) {
            await Promise.all([refreshDrafts(), reloadAudit(), onRatesUpdated?.()]);
            if (failed > 0 || data.status === "failed") {
              toast.error(`${failed || total} price${(failed || total) === 1 ? "" : "s"} did not reach Previo`);
            } else {
              window.setTimeout(() => setPushRun(null), 4000);
            }
            return;
          }
        }
        setPushRun(null);
      } catch (e) {
        setPushRun({
          total: rowsToSave.length, done: 0, failed: rowsToSave.length, state: "error",
          message: e instanceof Error ? e.message : String(e),
        });
        toast.error(e instanceof Error ? e.message : "Could not send the prices to Previo");
      }
    })();
  }, [hotelId, organizationSlug, refreshDrafts, reloadAudit, onRatesUpdated]);

  /** Publish one or many absolute target prices without blocking on Previo. */
  async function saveDraft() {
    if (!edit || !hotelId) return;
    const input = Number(edit.value);
    if (!Number.isFinite(input) || (editMode === "set" && input <= 0)) {
      toast.error("Enter a valid number"); return;
    }
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

    setEdit(null);
    publishInBackground(rowsToSave, {
      source: "cell-edit",
      notes: editMode === "percent" ? `${input}%` : `set ${input}`,
    });
  }



  /** Rate rows the day tool can act on (room type × guest count). */
  const rateRows = useMemo(
    () => allRows.filter((r): r is Extract<Row, { kind: "rate" }> => r.kind === "rate" && !!r.obk),
    [allRows],
  );

  /**
   * Dates the day tool will touch. Only ever the days the user actually
   * picked — a filtered selection (e.g. "dates with pickup") never expands
   * into the whole span between the first and last day.
   */
  const dayToolDates = useMemo(() => {
    if (!dayTool) return [] as string[];
    const visible = visibleDatesRef.current.length ? visibleDatesRef.current : allDates;
    const span = selDates.size > 1
      ? visible.filter((d) => selDates.has(d))
      : (() => {
        const start = visible.indexOf(dayTool);
        return start >= 0 ? visible.slice(start, start + dayRange) : [dayTool];
      })();
    return span.filter((d) =>
      dayWeekdays === "all" ? true : dayWeekdays === "weekend" ? isWeekend(d) : !isWeekend(d));
  }, [dayTool, dayRange, dayWeekdays, allDates, selDates]);


  /** Compute the new price for one cell under the current day-tool settings. */
  const dayToolNext = useCallback((current: number | null): number | null => {
    const input = Number(dayValue);
    if (dayMode !== "round" && !Number.isFinite(input)) return null;
    let next: number | null = null;
    if (dayMode === "set") next = input;
    else if (current === null) return null;
    else if (dayMode === "percent") next = current * (1 + input / 100);
    else if (dayMode === "amount") next = current + input;
    else next = current;
    if (next === null || !Number.isFinite(next) || next <= 0) return null;
    const step = Math.max(1, dayRound);
    return Math.max(step, Math.round(next / step) * step);
  }, [dayMode, dayValue, dayRound]);

  /** Everything the day tool would change, ready to preview or save. */
  const dayToolChanges = useMemo(() => {
    if (!dayTool) return [] as Array<{ date: string; row: Extract<Row, { kind: "rate" }>; from: number | null; to: number }>;
    const out: Array<{ date: string; row: Extract<Row, { kind: "rate" }>; from: number | null; to: number }> = [];
    for (const row of rateRows) {
      if (dayTypes.size > 0 && !dayTypes.has(row.roomTypeName)) continue;
      for (const d of dayToolDates) {
        const current = row.obk ? priceMap.get(row.obk)?.get(row.occ)?.get(d) ?? null : null;
        const next = dayToolNext(current);
        if (next === null || (current !== null && Math.round(next) === Math.round(current))) continue;
        out.push({ date: d, row, from: current, to: next });
      }
    }
    return out;
  }, [dayTool, rateRows, dayTypes, dayToolDates, priceMap, dayToolNext]);

  /** Publish every change the day tool previews. */
  async function applyDayTool(_mode: "draft" | "push" = "push") {
    if (!hotelId || dayToolChanges.length === 0) return;
    setDayResult(null);
    const { data: auth } = await supabase.auth.getUser();
    const rowsToSave = dayToolChanges.map((c) => ({
      hotel_id: hotelId,
      organization_slug: organizationSlug ?? null,
      stay_date: c.date,
      obk_id: c.row.obk,
      room_type_name: c.row.roomTypeName,
      occupancy: c.row.occ,
      old_price: c.from,
      new_price: c.to,
      status: "draft",
      push_error: null,
      created_by: auth.user?.id ?? null,
    }));

    // The day tool is hand-made pricing, so the audit trail (and the blue
    // "your team" dot) is written from the same background publisher.
    setDayTool(null);
    setSelDates(new Set());
    publishInBackground(rowsToSave, {
      source: "day-tool",
      notes: dayMode === "percent" ? `${dayValue}%` : dayMode === "amount" ? `${dayValue} ${getRevenueCurrency().code}` : dayMode,
    });
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

  const latestPickupByDate = useMemo(() => {
    const map = new Map<string, string>();
    for (const night of nights) {
      if (!night.created_at_pms) continue;
      const current = map.get(night.stay_date);
      if (!current || Date.parse(night.created_at_pms) > Date.parse(current)) map.set(night.stay_date, night.created_at_pms);
    }
    return map;
  }, [nights]);
  const dates = allDates.filter((d) => {
    if (reviewOnly && flagged.dateKeys.size && !flagged.dateKeys.has(d)) return false;
    if (pickupOnly && (metricByDate.get(d)?.netPickup ?? 0) === 0) return false;
    return true;
  });
  // Selection helpers read this so a drag only ever covers what is on screen.
  visibleDatesRef.current = dates;
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
    <Card
      data-training="revenue-grid"
      className={expanded ? "fixed inset-0 z-50 flex flex-col rounded-none border-0 overflow-auto" : undefined}
    >
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
            <Sheet>
              <SheetTrigger asChild>
                <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs">
                  <History className="h-3.5 w-3.5" />
                  Price activity
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-full sm:max-w-lg flex flex-col p-4">
                <SheetHeader className="pb-2">
                  <SheetTitle className="text-base">Price activity</SheetTitle>
                </SheetHeader>
                <div className="flex-1 min-h-0 overflow-y-auto">
                  <RateActivityPanel hotelId={hotelId ?? null} embedded />
                </div>
              </SheetContent>
            </Sheet>
            {canEditRates && (
              <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => setBulkOpen(true)}>
                <SlidersHorizontal className="h-3.5 w-3.5" />
                Bulk edit prices
              </Button>
            )}
            {canEditRates && <PickupAutomationRules hotelId={hotelId ?? null} organizationSlug={organizationSlug ?? null} />}
            {canEditRates && (
              <Button
                size="sm"
                variant={multiMode ? "default" : "outline"}
                className="h-8 gap-1.5 text-xs"
                onClick={() => { setMultiMode((v) => !v); setPickedDates(new Set()); }}
              >
                <CalendarRange className="h-3.5 w-3.5" />
                {multiMode ? "Done selecting" : "Select days"}
              </Button>
            )}
            <Button
              size="sm"
              variant="default"
              className="h-8 gap-1.5 text-xs shadow-sm"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
              {expanded ? "Close" : "Expand"}
            </Button>

            <Button
              size="sm"
              variant={pickupOnly ? "default" : "outline"}
              className="h-8 text-xs"
              onClick={() => setPickupOnly((value) => !value)}
            >
              {pickupOnly ? "All dates" : "Dates with pickup"}
            </Button>


            <Select value={String(pickupWindowDays)} onValueChange={(v) => onPickupWindowChange(Number(v))}>
              <SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PICKUP_WINDOWS.map((p) => (
                  <SelectItem key={p.value} value={String(p.value)}>Pickup: {p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* Reading size — saved to the user's profile, not just this device. */}
            <div className="flex items-center rounded-md border overflow-hidden">
              <Button
                size="sm" variant="ghost" className="h-8 w-8 rounded-none p-0"
                aria-label="Make the calendar smaller"
                title="Smaller (Ctrl + scroll)"
                onClick={() => setZoom(zoom - GRID_ZOOM_STEP)}
              >
                <ZoomOut className="h-3.5 w-3.5" />
              </Button>
              <button
                type="button"
                onClick={() => setZoom(1)}
                title="Reset to 100%"
                className="h-8 min-w-[46px] px-1 text-[11px] tabular-nums text-muted-foreground hover:text-foreground"
              >
                {zoomPct}%
              </button>
              <Button
                size="sm" variant="ghost" className="h-8 w-8 rounded-none p-0"
                aria-label="Make the calendar bigger"
                title="Bigger (Ctrl + scroll)"
                onClick={() => setZoom(zoom + GRID_ZOOM_STEP)}
              >
                <ZoomIn className="h-3.5 w-3.5" />
              </Button>
            </div>
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
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="font-medium text-foreground">Demand:</span>
            <span className="flex items-center gap-1"><i className="h-3 w-3 rounded-sm bg-emerald-400 border inline-block" />strong</span>
            <span className="flex items-center gap-1"><i className="h-3 w-3 rounded-sm bg-amber-200 dark:bg-amber-800 border inline-block" />below target</span>
            <span className="flex items-center gap-1"><i className="h-3 w-3 rounded-sm bg-destructive/40 border inline-block" />needs attention</span>
            <span className="flex items-center gap-1"><i className="h-3 w-3 rounded-sm bg-sky-200 dark:bg-sky-900 border inline-block" />cancellations</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="font-medium text-foreground">Changed today:</span>
            <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-primary inline-block" />by your team</span>
            <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-purple-500 inline-block" />by the automation tool</span>
            <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-amber-500 inline-block" />in Previo</span>
            <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-destructive inline-block" />did not land</span>
            <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full border border-primary inline-block" />sending now</span>
            <span className="underline decoration-dotted underline-offset-2">not sent yet</span>
          </span>
          <button
            type="button"
            onClick={() => setShowMarkers((v) => !v)}
            className="underline underline-offset-2 hover:text-foreground"
          >
            {showMarkers ? "Hide change dots" : "Show change dots"}
          </button>
        </div>

        {/* Quiet, self-clearing publishing pill — never blocks the calendar. */}
        {pushRun && (
          <div
            className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] animate-fade-in
              ${pushRun.state === "error"
                ? "border-destructive/40 bg-destructive/10 text-destructive"
                : pushRun.state === "done"
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700"
                  : "border-primary/30 bg-primary/5 text-foreground"}`}
            role="status"
          >
            {pushRun.state === "sending" && (
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
              </span>
            )}
            <span className="font-medium">
              {pushRun.state === "error"
                ? `${pushRun.failed || pushRun.total} price${(pushRun.failed || pushRun.total) === 1 ? "" : "s"} need attention`
                : pushRun.state === "done"
                  ? `${pushRun.total} price${pushRun.total === 1 ? "" : "s"} live in Previo`
                  : `Sending ${pushRun.total} price${pushRun.total === 1 ? "" : "s"} to Previo — your prices are already up to date here`}
            </span>
            {pushRun.state === "sending" && pushRun.total > 0 && (
              <>
                {/* Plain counts, so it is obvious what is done and what is left. */}
                <span className="tabular-nums text-muted-foreground">
                  {Math.max(0, pushRun.done - pushRun.failed)} sent
                  {" · "}{Math.max(0, pushRun.total - pushRun.done)} waiting
                  {pushRun.failed > 0 ? <span className="text-destructive"> · {pushRun.failed} failed</span> : null}
                </span>
                <span className="hidden sm:flex h-1 w-24 overflow-hidden rounded-full bg-primary/15">
                  <span
                    className="h-full rounded-full bg-primary transition-all duration-500"
                    style={{ width: `${Math.max(6, Math.min(100, Math.round((pushRun.done / pushRun.total) * 100)))}%` }}
                  />
                </span>
              </>
            )}
          </div>
        )}



        <p className="text-[11px] text-muted-foreground">
          Live Previo prices.
          {canEditRates ? " Tap a price, or a date to change a whole day." : ""}
          <MetricInfo
            title="Where these numbers come from"
            body="Prices come straight from the Previo pricelist — one row per room type and guest count. Pickup and occupancy come from Previo reservations; ADR and RevPAR are calculated in Hotel Care."
          />
        </p>
        {canEditRates && (failedCount > 0 || divergentDrafts.length > 0) && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-primary/40 bg-primary/5 px-3 py-2">
            <span className="text-xs space-x-2">
              {failedCount > 0 && (
                <span className="text-destructive">{failedCount} refused by Previo.</span>
              )}
              {divergentDrafts.length > 0 && (
                <span className="text-destructive">
                  {divergentDrafts.length} landed on a different price.
                </span>
              )}
            </span>

            <span className="flex items-center gap-2">
              <Button size="sm" className="h-8 text-xs" onClick={() => setPushOpen(true)}>
                <Send className="h-3.5 w-3.5 mr-1" />
                Review errors
              </Button>
            </span>
          </div>
        )}



      </CardHeader>
      <CardContent className="p-0">
        {loading && rows.length === 0 ? (
          <div className="p-6 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading calendar…
          </div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">
            No room types yet — run a sync to pull them from Previo.
          </div>
        ) : (
          <div
            ref={scrollRef}
            onScroll={onScroll}
            className={`relative overflow-auto overscroll-x-contain text-[11px] sm:text-xs ${dragging ? "select-none" : ""}`}
            style={{ maxHeight: expanded ? "calc(100vh - 190px)" : isMobile ? "68vh" : "72vh", WebkitOverflowScrolling: "touch" } as React.CSSProperties}
          >
            <div ref={gridRef} style={{ width: LEFT_W + dates.length * CELL_W }}>
              {/* ---- Sticky header: month, dates and the day metrics ---- */}
              <div className="sticky top-0 z-30">
                {/* Month band + the corner control for the frozen column */}
                <div className="flex bg-muted/70 backdrop-blur" style={{ height: MONTH_H }}>
                  <div
                    className="sticky left-0 z-40 flex items-center gap-1 border-r bg-card px-1 font-semibold"
                    style={{ width: LEFT_W }}
                  >
                    <button
                      type="button"
                      onClick={() => setRailed((v) => !v)}
                      aria-label={railed ? "Expand room type column" : "Collapse room type column"}
                      title={railed ? "Expand room type column" : "Collapse room type column"}
                      className="shrink-0 rounded px-1 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      {railed ? "»" : "«"}
                    </button>
                    <span className="min-w-0 flex-1 truncate text-[10px]" title={visibleMonth}>
                      {railed ? visibleMonth.slice(0, 3) : visibleMonth}
                    </span>
                  </div>
                  {monthBands(dates).map((b) => (
                    <div
                      key={b.key}
                      className="shrink-0 flex items-center border-l-2 border-l-foreground/40 px-2 text-[11px] font-semibold"
                      style={{ width: b.span * CELL_W }}
                    >
                      <span className="sticky left-1 truncate">{b.label}</span>
                    </div>
                  ))}
                </div>

                {/* Date header */}
                <div ref={headerRowRef} className="flex border-b bg-card" style={{ height: DAY_H }}>

                  <div className="sticky left-0 z-40 border-r bg-card" style={{ width: LEFT_W }}>
                    <div
                      role="separator"
                      aria-orientation="vertical"
                      aria-label="Drag to resize the room type column"
                      title="Drag to resize · double-click to reset"
                      onPointerDown={(e) => { e.preventDefault(); startResize(e.clientX, LEFT_W); }}
                      onDoubleClick={() => { setRailed(false); setLeftW(DEFAULT_LEFT_W); }}
                      className="ml-auto hidden h-full w-2 cursor-col-resize items-center justify-center sm:flex"
                    >
                      <span className="h-5 w-[3px] rounded-full bg-border hover:bg-primary" />
                    </div>
                  </div>

                  {dates.map((d, i) => {
                    const picked = multiMode ? pickedDates.has(d) : selecting && selDates.has(d);
                    const trail = auditByDate.get(d);
                    const dayChanges = dayChangesByDate.get(d) ?? [];
                    const dayLatest = dayChanges.find((c) => Date.parse(c.at) >= dayStart);
                    const dayButton = (
                      <button
                        key={d}
                        type="button"
                        data-date={d}
                        disabled={!canEditRates}
                        onPointerDown={(e) => {
                          if (e.pointerType === "touch") return;
                          if (!canEditRates || multiMode) return;
                          e.preventDefault();
                          beginDateSelect(d);
                        }}
                        onTouchStart={(e) => {
                          if (multiMode) return;
                          const t = e.touches[0];
                          beginTouchSelect(d, t?.clientX ?? 0, t?.clientY ?? 0);
                        }}
                        onTouchEnd={() => {
                          const wasSelecting = lpActive.current;
                          endTouchSelect();
                          if (wasSelecting) suppressDayClick.current = true;
                        }}
                        onTouchCancel={endTouchSelect}
                        onClick={() => {
                          if (suppressDayClick.current) { suppressDayClick.current = false; return; }
                          if (!canEditRates) return;
                          if (multiMode) { togglePicked(d); return; }
                          if (isMobile) openDayTool([d]);
                        }}
                        onPointerEnter={(e) => { if (e.pointerType !== "touch" && !multiMode) extendDateSelect(d); }}
                        onKeyDown={(e) => {
                          if (!canEditRates || multiMode) return;
                          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDayTool([d]); }
                        }}
                        title={canEditRates ? (multiMode ? `Tap to add ${d} to the selection` : `Change every price on ${d}`) : d}
                        className={`group relative flex flex-col items-center justify-center shrink-0 select-none ${multiMode || isMobile ? "" : "touch-none"} ${picked ? "bg-primary/25 ring-1 ring-inset ring-primary" : dayBg(d, i)} ${dayEdge(d)} ${d === today ? "ring-1 ring-inset ring-primary/60" : ""} ${canEditRates ? "hover:bg-primary/10 cursor-pointer" : ""}`}
                        style={{ width: CELL_W, height: DAY_H }}
                      >

                        <span className="text-[10px] text-muted-foreground">{formatWeekday(d)}</span>
                        <span className="font-medium">{formatDay(d)}</span>
                        {dayLatest && (
                          <span className="pointer-events-none absolute bottom-0.5 left-0 right-0 flex justify-center" aria-hidden>
                            <i className={`h-1.5 w-1.5 rounded-full ${ORIGIN_DOT_CLASS[dayLatest.origin]}`} />
                          </span>
                        )}


                        {canEditRates && (
                          <ChevronDown
                            className="pointer-events-none absolute bottom-0.5 right-1 h-3 w-3 text-primary opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                            aria-hidden
                          />
                        )}
                      </button>
                    );

                    if (!trail && dayChanges.length === 0) return dayButton;
                    const up = (trail?.avgDelta ?? 0) >= 0;
                    return (
                      <HoverCard key={d} openDelay={150} closeDelay={60}>
                        <HoverCardTrigger asChild>{dayButton}</HoverCardTrigger>
                        <HoverCardContent align="center" className="w-72 p-3 text-xs space-y-2">
                          <p className="font-medium">{formatWeekday(d)} {formatDay(d)} · last price changes</p>
                          {trail && (
                            <p className="tabular-nums text-muted-foreground">
                              {trail.count} price{trail.count === 1 ? "" : "s"} changed on this date
                              {trail.avgDelta !== 0 && (
                                <span className={up ? " text-emerald-600 dark:text-emerald-400" : " text-sky-600 dark:text-sky-400"}>
                                  {" "}· avg {up ? "+" : "−"}{moneyBase(Math.abs(trail.avgDelta))}
                                </span>
                              )}
                            </p>
                          )}
                          {dayChanges.slice(0, 3).map((c, idx) => (
                            <div key={`${c.at}-${idx}`} className="space-y-0.5">
                              <p className="tabular-nums">
                                <i className={`mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle ${ORIGIN_DOT_CLASS[c.origin]}`} />
                                {moneyBase(c.old)} → <strong>{moneyBase(c.next)}</strong>
                                {c.old != null && c.next != null && c.next !== c.old && (
                                  <span className={c.next > c.old ? " text-emerald-600 dark:text-emerald-400" : " text-sky-600 dark:text-sky-400"}>
                                    {" "}{c.next > c.old ? "+" : "−"}{moneyBase(Math.abs(c.next - c.old))}
                                  </span>
                                )}
                              </p>
                              <p className="text-[11px] text-muted-foreground">
                                {c.who} · {formatWhen(c.at)}
                                {c.room ? ` · ${c.room}${c.occ ? ` · ${c.occ}g` : ""}` : ""}
                              </p>
                            </div>
                          ))}
                          {dayChanges.length > 3 && (
                            <p className="text-[11px] text-muted-foreground">
                              +{dayChanges.length - 3} more change{dayChanges.length - 3 === 1 ? "" : "s"} — open a price cell for its full history
                            </p>
                          )}
                        </HoverCardContent>
                      </HoverCard>
                    );
                  })}




                </div>

                {/* Pickup */}
                <div className="flex border-b bg-card" style={{ height: ROW_H }}>
                  <div className="sticky left-0 z-40 flex items-center border-r bg-card px-2 font-medium" style={{ width: LEFT_W }}>
                    {railed ? <span title="Net pickup">PU</span> : (
                      <>
                        Pickup
                        <MetricInfo
                          title="Net pickup"
                          body="New room-nights booked in the selected window minus room-nights cancelled in the same window. Negative means the date lost rooms. Source: Previo reservations."
                        />
                      </>
                    )}
                  </div>
                  {dates.map((d, i) => {
                    const m = metricByDate.get(d);
                    const pickup = m?.netPickup ?? null;
                    const tone = pickupTone(pickup, thresholds);
                    const latestPickup = latestPickupByDate.get(d);
                    const latestLabel = latestPickup ? new Intl.DateTimeFormat("en-GB", {
                      timeZone: "Europe/Budapest", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit",
                    }).format(new Date(latestPickup)) : null;
                    return (
                      <div
                        key={d}
                        title={pickup === null
                          ? `${d} · pickup not available yet`
                          : `${d} · ${pickup > 0 ? "+" : ""}${pickup} (${tone.label}) — ${m?.newBookings ?? 0} new, ${m?.cancelledBookings ?? 0} cancelled${latestLabel ? ` · last pickup ${latestLabel}` : ""}`}
                        className={`flex flex-col items-center justify-center shrink-0 font-semibold tabular-nums ${tone.className || dayBg(d, i)} ${dayEdge(d)}`}
                        style={{ width: CELL_W }}
                      >
                        <span>{pickup === null || pickup === 0 ? "·" : `${pickup > 0 ? "+" : ""}${pickup}`}</span>
                        {latestLabel && pickup !== 0 && <span className="max-w-[56px] truncate text-[8px] font-normal opacity-80">{latestLabel}</span>}
                      </div>
                    );
                  })}
                </div>

                {/* Occupancy */}
                <div className="flex border-b bg-card" style={{ height: ROW_H }}>
                  <div className="sticky left-0 z-40 flex items-center border-r bg-card px-2 font-medium" style={{ width: LEFT_W }}>
                    {railed ? <span title="Occupancy">Occ</span> : (
                      <>
                        Occupancy
                        <MetricInfo
                          title="Occupancy"
                          body="Rooms sold ÷ sellable rooms for that night. Rooms sold come from Previo; the sellable-room count comes from your room types (non-sellable products excluded)."
                        />
                      </>
                    )}
                  </div>
                  {dates.map((d, i) => {
                    const m = metricByDate.get(d);
                    const pct = m?.occupancyPct ?? 0;
                    const tone = occupancyTone2(pct, thresholds);
                    return (
                      <div
                        key={d}
                        title={`${m?.roomsSold ?? 0} / ${m?.roomsAvailable ?? 0} rooms · ${tone.label}`}
                        className={`flex items-center justify-center shrink-0 tabular-nums ${tone.className || dayBg(d, i)} ${dayEdge(d)}`}
                        style={{ width: CELL_W }}
                      >
                        {pct ? `${Math.round(pct)}%` : "—"}
                      </div>
                    );
                  })}
                </div>

                {/* Left to sell — house level */}
                <div className="flex border-b bg-card" style={{ height: ROW_H }}>
                  <div className="sticky left-0 z-40 flex items-center border-r bg-card px-2 font-medium" style={{ width: LEFT_W }}>
                    {railed ? <span title="Rooms left to sell">Left</span> : (
                      <>
                        Left to sell
                        <MetricInfo
                          title="Rooms left to sell"
                          body="Sellable rooms minus rooms sold for that night, for the whole house. The room-type rows show the same figure per room type."
                        />
                      </>
                    )}
                  </div>
                  {dates.map((d, i) => {
                    const m = metricByDate.get(d);
                    const units = m?.roomsAvailable ?? 0;
                    const left = m?.roomsLeft ?? 0;
                    return (
                      <div
                        key={d}
                        title={`${left} of ${units} rooms left to sell on ${d}`}
                        className={`flex flex-col items-center justify-center shrink-0 tabular-nums ${leftTone(left, units)} ${dayBg(d, i)} ${dayEdge(d)}`}
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
                <div className="flex border-b-2 border-b-foreground/20 bg-card" style={{ height: ROW_H }}>
                  <div className="sticky left-0 z-40 flex items-center border-r bg-card px-2 font-medium" style={{ width: LEFT_W }}>
                    {railed ? <span title="Demand grade">Dem</span> : (
                      <>
                        Demand
                        <MetricInfo
                          title="Demand grade"
                          body="Hotel Care's own 0–100 demand grade for that date, built from booking pace against comparable weekdays, recent pickup, how much inventory is left this close to arrival, recorded events and any manual manager override. Low / Med / High / V.High."
                        />
                      </>
                    )}
                  </div>
                  {dates.map((d, i) => {
                    const dem = demandByDate?.get(d);
                    return (
                      <div
                        key={d}
                        title={dem
                          ? `${d} · demand ${BAND_LABEL[dem.band]} (${dem.score}/100)\n${dem.drivers.slice(0, 4).join("\n")}`
                          : `${d} · demand not available yet`}
                        className={`flex items-center justify-center shrink-0 text-[10px] font-semibold ${dem ? demandTone(dem.band) : `text-muted-foreground ${dayBg(d, i)}`} ${dayEdge(d)}`}
                        style={{ width: CELL_W }}
                      >
                        {dem ? DEMAND_SHORT[dem.band] : "·"}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* ---- Room-type / metric rows ---- */}
              {rows.map((row) => (
                <div
                  key={row.key}
                  className={`flex ${row.kind === "group" ? "border-b border-b-foreground/25 bg-muted/50" : row.kind === "rate" ? "border-b" : "border-b border-t-2 border-t-foreground/20 bg-primary/10 font-semibold"}`}
                  style={{ height: rowH(row.kind) }}
                >
                  {/* Frozen label cell — must stay fully opaque, otherwise the
                      scrolling date cells read through it. */}
                  <div
                    className={`sticky left-0 z-20 flex items-center border-r px-2 ${row.kind === "group" ? "bg-muted font-semibold" : row.kind === "rate" ? "bg-card text-muted-foreground" : "bg-muted border-l-2 border-l-primary font-semibold text-foreground"}`}
                    style={{ width: LEFT_W }}

                  >
                    {railed ? (
                      <span className="w-full truncate text-center text-[10px]" title={row.label}>
                        {row.kind === "rate" ? `${row.occ}g` : railLabel(row.label)}
                      </span>
                    ) : row.kind === "group" ? (
                      <span className="leading-tight line-clamp-2 break-words" title={row.label}>
                        {row.label}
                        <span className="ml-1 text-[10px] font-normal text-muted-foreground">{row.note}</span>
                      </span>
                    ) : (
                      <span className="truncate" title={row.label}>{row.label}</span>
                    )}
                    {!railed && row.kind === "adr" && (
                      <MetricInfo
                        title="ADR = Average Daily Rate"
                        body="Room revenue ÷ rooms sold. The average price of the rooms you actually sold that night. Calculated in Hotel Care from Previo booking data."
                      />
                    )}
                    {!railed && row.kind === "revpar" && (
                      <MetricInfo
                        title="RevPAR = ADR × Occupancy"
                        body="Revenue per available room: room revenue ÷ all sellable rooms. What every room in the hotel earns on average, sold or not."
                      />
                    )}
                  </div>

                  {dates.map((d, i) => {
                    if (row.kind === "group") {
                      const units = row.units;
                      const left = leftByTypeDate?.get(`${row.rawName}|${d}`);
                      return (
                        <div
                          key={d}
                          title={left === undefined
                            ? `${row.typeName} · availability not synced for ${d}`
                            : `${row.typeName} · ${left} of ${units} left on ${d}`}
                          className={`flex items-center justify-center shrink-0 text-[10px] tabular-nums ${left === undefined ? "text-muted-foreground" : leftTone(left, units)} ${dayEdge(d)}`}
                          style={{ width: CELL_W }}
                        >
                          {left === undefined ? "" : left === 0 ? "Sold out" : `${left} left`}
                        </div>
                      );
                    }
                    if (row.kind !== "rate") {
                      const value = row.kind === "adr"
                        ? metricByDate.get(d)?.adrEur ?? null
                        : metricByDate.get(d)?.revparEur ?? null;
                      return (
                        <div
                          key={d}
                          title={value === null ? `${d} · no data` : `${d} · ${eur(value)}`}
                          className={`flex items-center justify-center shrink-0 tabular-nums ${dayEdge(d)}`}
                          style={{ width: CELL_W }}
                        >
                          {value === null ? eur(null) : priceLabel(value)}
                        </div>
                      );
                    }
                    const published = row.obk ? priceMap.get(row.obk)?.get(row.occ)?.get(d) : undefined;
                    const draft = drafts.get(`${d}|${row.roomTypeName}|${row.occ}`);
                    // Already with Previo, waiting for its read-back. This is
                    // not a draft: the price is live, we are only confirming.
                    const sending = inFlight.get(`${d}|${row.roomTypeName}|${row.occ}`);
                    const shown = draft ?? sending ?? published;
                    const tone = rateTone(shown, thresholds);
                    const history = auditByCell.get(cellKey(d, row.roomTypeName, row.occ));
                    // The colour follows the most recent change, never a
                    // ranking: a price you set by hand this morning reads blue
                    // even if automation moved the same cell last week.
                    const cellAutomation = automationByCell.get(cellKey(d, row.roomTypeName, row.occ));
                    const cellOrigin = cellOriginByCell.get(cellKey(d, row.roomTypeName, row.occ));
                    const justPublishedAt = optimisticOrigin.get(cellKey(d, row.roomTypeName, row.occ));
                    const cellEvents = [
                      ...(justPublishedAt ? [{ origin: "team" as ChangeOrigin, at: justPublishedAt }] : []),
                      ...cellOriginEvents(history, cellAutomation),
                    ];
                    // One dot only — the most recent change. The full story
                    // lives in the cell's hover card / tap sheet.
                    const latestToday = cellEvents.find((e) => Date.parse(e.at) >= dayStart);
                    const cellOrigin1: ChangeOrigin | null = showMarkers ? (latestToday?.origin ?? null) : null;
                    
                    const originLabel = (() => {
                      if (draft !== undefined) {
                        return failedCells.has(cellKey(d, row.roomTypeName, row.occ))
                          ? "Did not reach Previo — send it again"
                          : "Waiting to be sent to Previo";
                      }
                      if (sending !== undefined) return "Sending to Previo now — this price is already applied here";
                      const latest = cellEvents[0];
                      if (!latest) return "No price change recorded";
                      const when = formatWhen(latest.at);
                      if (latest.origin === "automation") return `Changed by the pickup automation tool, live in Previo (${when})`;
                      if (latest.origin === "previo") return `Changed directly in Previo (${when})`;
                      if (latest.origin === "failed") {
                        return cellOrigin
                          ? `Did not land: we asked for ${eur(cellOrigin.requested ?? null)}, Previo shows ${eur(cellOrigin.price)} (${when})`
                          : `Did not land (${when})`;
                      }
                      const who = cellOrigin?.by ? auditNames.get(cellOrigin.by) ?? "someone" : null;
                      return `Changed by your team${who ? ` (${who})` : ""}, live in Previo (${when})`;
                    })();





                    const cellButton = (
                      <button
                        key={d}
                        type="button"
                        disabled={!canEditRates}
                        onClick={() => {
                          if (!canEditRates) return;
                          // On a phone there is no hover, so a tap tells the
                          // cell's story first and offers editing from there.
                          if (isMobile) {
                            setCellInfo({
                              date: d,
                              roomTypeName: row.roomTypeName,
                              occ: row.occ,
                              published: published ?? null,
                              draft: draft ?? null,
                              obk: row.obk,
                            });
                            return;
                          }
                          setApplyDays(1); setApplyWeekdays("all"); setApplyAllOcc(false); setEditMode("set");
                          setEdit({
                            stay_date: d,
                            obk_id: row.obk,
                            room_type_name: row.roomTypeName,
                            occupancy: row.occ,
                            old_price: published ?? null,
                            value: String(shown ?? ""),
                          });
                        }}

                        title={`${d} · ${row.roomTypeName} · ${row.occ} guests · ${shown === undefined ? "no price" : eur(shown)} · ${tone.label} · ${originLabel}`}
                        className={`relative flex items-center justify-center shrink-0 tabular-nums ${tone.className || dayBg(d, i)} ${dayEdge(d)} ${canEditRates ? "hover:ring-1 hover:ring-inset hover:ring-primary/50" : "cursor-default"} ${draft !== undefined ? "underline decoration-dotted underline-offset-2" : ""} ${cellOrigin?.origin === "different" ? "ring-1 ring-inset ring-destructive/70" : ""}`}
                        style={{ width: CELL_W }}
                      >
                        {shown === undefined ? <span className="text-muted-foreground">—</span> : priceLabel(shown)}
                        {sending !== undefined && draft === undefined ? (
                          <i
                            aria-hidden
                            title="Sending to Previo"
                            className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full border border-primary bg-transparent animate-pulse"
                          />
                        ) : cellOrigin1 ? (
                          <i
                            aria-hidden
                            className={`absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full ${ORIGIN_DOT_CLASS[cellOrigin1]}`}
                          />
                        ) : null}






                      </button>
                    );
                    if ((!history && !cellAutomation?.length) || isMobile) return cellButton;
                    return (
                      <HoverCard key={d} openDelay={120} closeDelay={60}>
                        <HoverCardTrigger asChild>{cellButton}</HoverCardTrigger>
                        <HoverCardContent align="center" className="w-72 p-3 text-xs">
                          <p className="font-medium">{row.roomTypeName} · {row.occ}g · {d}</p>
                          <p className="text-[11px] text-muted-foreground">{originLabel}</p>
                          <p className="mt-1 mb-2 flex justify-between">
                            <span className="text-muted-foreground">Current price</span>
                            <span className="tabular-nums font-semibold">{moneyBase(published ?? null)}</span>
                          </p>

                          <RateCellHistory
                            history={history ?? []}
                            automation={cellAutomation ?? []}
                            names={auditNames}
                            draftPrice={draft ?? null}
                            sendingPrice={sending ?? null}
                          />

                        </HoverCardContent>

                      </HoverCard>
                    );

                  })}
                </div>
              ))}

            </div>
          </div>

        )}
      </CardContent>

      {multiMode && pickedDates.size > 0 && (
        <div className="fixed inset-x-3 bottom-4 z-[60] flex items-center justify-between gap-2 rounded-full border bg-card px-4 py-2 shadow-lg sm:left-auto sm:right-6 sm:w-auto">
          <span className="text-xs font-medium">
            {pickedDates.size} day{pickedDates.size === 1 ? "" : "s"} selected
          </span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setPickedDates(new Set())}>
              Clear
            </Button>
            <Button
              size="sm"
              className="h-8 text-xs"
              onClick={() => openDayTool(dates.filter((d) => pickedDates.has(d)))}
            >
              Change prices
            </Button>
          </div>
        </div>
      )}

      {/* Tap a price on a phone: who changed it, when, and by how much. */}
      <Sheet open={!!cellInfo} onOpenChange={(o) => !o && setCellInfo(null)}>
        <SheetContent side="bottom" className="max-h-[75vh] overflow-y-auto">
          {cellInfo && (
            <>
              <SheetHeader className="text-left">
                <SheetTitle className="text-sm">
                  {cellInfo.roomTypeName} · {cellInfo.occ} guest{cellInfo.occ === 1 ? "" : "s"} · {cellInfo.date}
                </SheetTitle>
              </SheetHeader>
              <div className="mt-3 space-y-3">
                <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                  <span className="text-muted-foreground">Current price</span>
                  <span className="tabular-nums font-semibold">{moneyBase(cellInfo.published)}</span>
                </div>
                <RateCellHistory
                  history={auditByCell.get(cellKey(cellInfo.date, cellInfo.roomTypeName, cellInfo.occ)) ?? []}
                  automation={automationByCell.get(cellKey(cellInfo.date, cellInfo.roomTypeName, cellInfo.occ)) ?? []}
                  names={auditNames}
                  draftPrice={cellInfo.draft}
                  sendingPrice={inFlight.get(`${cellInfo.date}|${cellInfo.roomTypeName}|${cellInfo.occ}`) ?? null}
                />

                {canEditRates && (
                  <Button
                    className="w-full"
                    onClick={() => {
                      setApplyDays(1); setApplyWeekdays("all"); setApplyAllOcc(false); setEditMode("set");
                      setEdit({
                        stay_date: cellInfo.date,
                        obk_id: cellInfo.obk ?? null,
                        room_type_name: cellInfo.roomTypeName,
                        occupancy: cellInfo.occ,
                        old_price: cellInfo.published,
                        value: String(cellInfo.draft ?? cellInfo.published ?? ""),
                      });
                      setCellInfo(null);
                    }}
                  >
                    Edit price
                  </Button>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>



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

              <p className="text-xs text-muted-foreground">The calendar updates immediately while Previo publishing continues in the background.</p>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setEdit(null)}>Cancel</Button>
            <Button onClick={() => void saveDraft()} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-1" />}Publish price
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- Whole-day price tool: tap a date in the header ---- */}
      <BulkPriceEditor
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        hotelId={hotelId ?? null}
        organizationSlug={organizationSlug ?? null}
        rates={rates}
        today={today}
        canPush={!!canEditRates}
        onPublish={(changes, note) => publishInBackground(
          changes.map((c) => ({ ...c, hotel_id: hotelId, organization_slug: organizationSlug ?? null, status: "draft" })),
          { source: "bulk-editor", notes: note },
        )}
        onSaved={async () => {
          await Promise.all([refreshDrafts(), reloadAudit()]);
          await onRatesUpdated?.();
        }}

      />

      <Dialog open={!!dayTool} onOpenChange={(o) => !o && setDayTool(null)}>

        <DialogContent className="flex max-h-[92dvh] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-2xl p-4 sm:w-full sm:max-w-lg sm:p-6">
          <DialogHeader>
            <DialogTitle className="text-base">
              {selDates.size > 1
                ? `Change prices for ${dayToolDates.length} selected date${dayToolDates.length === 1 ? "" : "s"}${
                    dayToolDates.length > 1 ? ` (${dayToolDates[0]} … ${dayToolDates[dayToolDates.length - 1]})` : ""
                  }`
                : `Change prices for ${dayTool}`}
            </DialogTitle>

          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1 text-sm">

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">What to do</label>
                <Select value={dayMode} onValueChange={(v) => setDayMode(v as typeof dayMode)}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percent">Change by %</SelectItem>
                    <SelectItem value="amount">Change by amount</SelectItem>
                    <SelectItem value="set">Set a fixed price</SelectItem>
                    <SelectItem value="round">Only round the prices</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">
                  {dayMode === "percent" ? "Percent (− to lower)" : dayMode === "round" ? "Not used" : `Amount in ${getRevenueCurrency().code}`}
                </label>
                <Input
                  type="number"
                  inputMode="decimal"
                  value={dayValue}
                  disabled={dayMode === "round"}
                  onChange={(e) => setDayValue(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex flex-wrap gap-1.5">
                {[1, 2, 8, 11, 18, 22].map((n) => (
                  <Button
                    key={`up-${n}`}
                    size="sm"
                    variant={dayMode === "amount" && dayValue === String(n) ? "default" : "outline"}
                    className="h-8 min-w-[62px] text-[11px]"
                    onClick={() => { setDayMode("amount"); setDayValue(String(n)); }}
                  >
                    +{n} {getRevenueCurrency().code}
                  </Button>
                ))}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {[-1, -2, -5].map((n) => (
                  <Button
                    key={`down-${n}`}
                    size="sm"
                    variant={dayMode === "amount" && dayValue === String(n) ? "default" : "outline"}
                    className="h-8 min-w-[62px] text-[11px]"
                    onClick={() => { setDayMode("amount"); setDayValue(String(n)); }}
                  >
                    {n} {getRevenueCurrency().code}
                  </Button>
                ))}
                {[
                  { label: "Peak +10%", value: "10" },
                  { label: "Event +20%", value: "20" },
                  { label: "Soft −5%", value: "-5" },
                ].map((p) => (
                  <Button
                    key={p.label}
                    size="sm"
                    variant={dayMode === "percent" && dayValue === p.value ? "default" : "outline"}
                    className="h-8 text-[11px]"
                    onClick={() => { setDayMode("percent"); setDayValue(p.value); }}
                  >
                    {p.label}
                  </Button>
                ))}
              </div>
            </div>


            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">
                  {selDates.size > 1 ? `${selDates.size} dates selected` : "Days from here"}
                </label>
                <Select
                  value={String(dayRange)}
                  disabled={selDates.size > 1}
                  onValueChange={(v) => setDayRange(Number(v))}
                >
                  <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[1, 3, 7, 14, 30, 60, 90].map((n) => (
                      <SelectItem key={n} value={String(n)}>{n === 1 ? "This day" : `${n} days`}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Which days</label>
                <Select value={dayWeekdays} onValueChange={(v) => setDayWeekdays(v as typeof dayWeekdays)}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All days</SelectItem>
                    <SelectItem value="weekend">Weekends only</SelectItem>
                    <SelectItem value="weekday">Weekdays only</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Round to</label>
                <Select value={String(dayRound)} onValueChange={(v) => setDayRound(Number(v))}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[1, 5, 10, 100, 500, 1000].map((n) => (
                      <SelectItem key={n} value={String(n)}>{n === 1 ? "Whole number" : n}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Room types (none selected = all)</label>
              <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                {Array.from(new Set(rateRows.map((r) => r.roomTypeName))).map((name) => {
                  const on = dayTypes.has(name);
                  return (
                    <Button
                      key={name}
                      size="sm"
                      variant={on ? "default" : "outline"}
                      className="h-7 text-[11px]"
                      onClick={() => setDayTypes((prev) => {
                        const next = new Set(prev);
                        if (on) next.delete(name); else next.add(name);
                        return next;
                      })}
                    >
                      {name}
                    </Button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-md border bg-muted/30 p-2 text-xs">
              <p className="font-medium mb-1">
                {dayToolChanges.length} price{dayToolChanges.length === 1 ? "" : "s"} will change
                {dayToolDates.length > 1 ? ` across ${dayToolDates.length} days` : ""}
              </p>
              <div className="max-h-52 overflow-y-auto space-y-1.5">
                {(() => {
                  const groups = new Map<string, typeof dayToolChanges>();
                  for (const c of dayToolChanges) {
                    const list = groups.get(c.date) ?? [];
                    list.push(c);
                    groups.set(c.date, list);
                  }
                  const entries = Array.from(groups.entries());
                  const shown = dayShowAll ? entries : entries.slice(0, 3);
                  return (
                    <>
                      {shown.map(([date, list]) => (
                        <div key={date}>
                          <p className="font-medium">{formatDay(date)}</p>
                          {list.map((c) => (
                            <div key={`${c.date}-${c.row.key}`} className="flex justify-between gap-2 tabular-nums text-muted-foreground">
                              <span className="truncate">{c.row.roomTypeName} · {c.row.occ}g</span>
                              <span>{moneyBase(c.from)} → <strong className="text-foreground">{moneyBase(c.to)}</strong></span>
                            </div>
                          ))}
                        </div>
                      ))}
                      {entries.length > 3 && (
                        <button
                          type="button"
                          className="text-primary underline underline-offset-2"
                          onClick={() => setDayShowAll((v) => !v)}
                        >
                          {dayShowAll ? "Show less" : `Show all ${dayToolChanges.length} prices (${entries.length} days)`}
                        </button>
                      )}
                    </>
                  );
                })()}
              </div>
            </div>
            {dayResult && (dayResult.failed > 0 || dayResult.message) && (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs space-y-1">
                <p className="font-medium text-destructive">
                  {dayResult.pushed > 0 ? `${dayResult.pushed} updated · ` : ""}
                  {dayResult.failed} not accepted by Previo
                </p>
                {dayResult.message && <p className="text-muted-foreground">{dayResult.message}</p>}
                {dayResult.errors.slice(0, 6).map((e, i) => (
                  <p key={`${e.stay_date}-${i}`} className="text-muted-foreground">
                    {e.stay_date} · {e.room_type_name}: {e.error}
                  </p>
                ))}
                {dayResult.errors.length > 6 && (
                  <p className="text-muted-foreground">+{dayResult.errors.length - 6} more</p>
                )}
              </div>
            )}
          </div>

          <DialogFooter className="sticky bottom-0 -mx-4 -mb-4 gap-2 border-t bg-background p-4 sm:static sm:m-0 sm:border-0 sm:p-0">
            <Button variant="ghost" onClick={() => setDayTool(null)}>Cancel</Button>
            <Button onClick={() => void applyDayTool("push")} disabled={saving || dayToolChanges.length === 0}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Send className="h-4 w-4 mr-1" />}
              {dayResult?.failed ? "Retry" : "Update"} {dayToolChanges.length} price{dayToolChanges.length === 1 ? "" : "s"}
            </Button>
          </DialogFooter>

        </DialogContent>
      </Dialog>

      <Dialog open={pushOpen} onOpenChange={(o) => {
        if (!o) {
          setPushOpen(false);
          setSelectedDraftIds(new Set());
        }
      }}>

        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-base">Price changes waiting to go live</DialogTitle>
          </DialogHeader>
          <div className="max-h-[50vh] overflow-y-auto -mx-2 px-2">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr className="border-b">
                  <th className="w-8 py-1.5">
                    <Checkbox
                      aria-label="Select all price changes"
                      checked={pending.length > 0 && selectedDraftIds.size === pending.length}
                      onCheckedChange={(checked) => setSelectedDraftIds(checked === true ? new Set(pending.map((d) => d.id)) : new Set())}
                    />
                  </th>
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
                    <td className="py-1.5">
                      <Checkbox
                        aria-label={`Select ${d.room_type_name} on ${d.stay_date}`}
                        checked={selectedDraftIds.has(d.id)}
                        onCheckedChange={(checked) => setSelectedDraftIds((current) => {
                          const next = new Set(current);
                          if (checked === true) next.add(d.id); else next.delete(d.id);
                          return next;
                        })}
                      />
                    </td>
                    <td className="py-1.5 whitespace-nowrap">{d.stay_date}</td>
                    <td className="py-1.5">
                      {d.room_type_name} · {d.occupancy}g
                      {d.status === "failed" && (
                        <span className="block text-[10px] text-destructive">
                          Failed: {d.push_error || "Previo rejected this price"} — will retry on next push
                        </span>
                      )}
                      {d.status === "pushed" && d.confirmation_status !== "different" && (
                        <span className="block text-[10px] text-muted-foreground">Accepted — awaiting confirmation from Previo sync</span>
                      )}
                      {d.confirmation_status === "different" && (
                        <span className="block text-[10px] text-destructive">
                          Requested {moneyBase(d.new_price)} · Previo has {moneyBase(d.actual_previo_price)}
                        </span>
                      )}
                    </td>

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
            <p className="text-xs text-muted-foreground">Only persistent Previo errors appear here. Successful publishing and verification stay in the background.</p>

            {failedCount > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm" variant="outline" className="h-7 text-[11px]"
                  disabled={probing}
                  onClick={() => void checkWriteAccess()}
                >
                  {probing && <Loader2 className="h-3 w-3 animate-spin mr-1" />}Check Previo access
                </Button>
                <Button
                  size="sm" variant="outline" className="h-7 text-[11px]"
                  disabled={probing}
                  onClick={() => void syncRatePlans()}
                >
                  Refresh room mapping
                </Button>
                {probe && (
                  <span className={`text-[11px] ${probe.ok ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}>
                    {probe.message}
                  </span>
                )}
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <div className="mr-auto flex flex-wrap gap-2">
              {selectedDraftIds.size > 0 && (
                <Button variant="destructive" onClick={() => { setClearAllMode(false); setRemoveConfirmOpen(true); }}>
                  <Trash2 className="mr-1 h-4 w-4" />Remove ({selectedDraftIds.size})
                </Button>
              )}
              {pending.length > 0 && (
                <Button variant="outline" onClick={() => { setClearAllMode(true); setRemoveConfirmOpen(true); }}>
                  <Trash2 className="mr-1 h-4 w-4" />Clear all ({pending.length})
                </Button>
              )}
            </div>
            <Button variant="ghost" onClick={() => setPushOpen(false)}>Close</Button>

          </DialogFooter>


        </DialogContent>
      </Dialog>
      <Dialog open={removeConfirmOpen} onOpenChange={(o) => { setRemoveConfirmOpen(o); if (!o) setClearAllMode(false); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">
              {clearAllMode ? "Clear every waiting change?" : "Remove selected drafts?"}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This removes {clearAllMode ? pending.length : selectedDraftIds.size} unsent price change
            {(clearAllMode ? pending.length : selectedDraftIds.size) === 1 ? "" : "s"} from Hotel Care. Live Previo prices are not changed.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRemoveConfirmOpen(false); setClearAllMode(false); }}>Keep drafts</Button>
            <Button variant="destructive" onClick={() => void discardSelectedDrafts()} disabled={removingDrafts}>
              {removingDrafts && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              {clearAllMode ? "Clear all" : "Remove drafts"}
            </Button>
          </DialogFooter>

        </DialogContent>
      </Dialog>
    </Card>
  );
}
