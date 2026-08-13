import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Area, Bar, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer,
  Tooltip as RTooltip, XAxis, YAxis,
} from "recharts";
import {
  ChevronDown, Gauge, Lightbulb, Loader2, Target, TrendingUp,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { addDays, budapestDayOf, eur } from "@/lib/revenueAnalytics";
import { currencySymbol } from "@/lib/revenueCurrency";
import { useIsMobile } from "@/hooks/use-mobile";

/* ------------------------------------------------------------------ types */

interface NightRow {
  res_id: string;
  room_key: string | null;
  stay_date: string;
  room_type_name: string | null;
  guests: number | null;
  nightly_price_eur: number | null;
  total_price_eur: number | null;
  stay_from: string | null;
  stay_to: string | null;
  source_name: string | null;
  created_at_pms: string | null;
  status_id: number | null;
  cancelled_at?: string | null;
}

/** One reservation-room created in the period, rebuilt from its room-nights. */
interface SaleBooking {
  key: string;
  res_id: string;
  created: string | null;
  createdDay: string;
  createdMinutes: number;
  stayFrom: string;
  stayTo: string;
  roomNights: number;
  revenue: number;
  adr: number | null;
  roomType: string;
  channel: string;
  direct: boolean;
  guests: number;
  cancelled: boolean;
}

export interface SalesGoals {
  targetAdr: number;
  targetRoomNights: number;
  targetValue: number;
  promoBudget: number;
}

const DEFAULT_GOALS: SalesGoals = {
  targetAdr: 120,
  targetRoomNights: 10,
  targetValue: 1200,
  promoBudget: 0,
};

type PresetKey = "today" | "yesterday" | "last7" | "month" | "custom";
type CompareKey = "goal" | "yesterday" | "lastweek";
type BookingFilter = "all" | "below" | "above" | "direct" | "ota";
type SortKey = "created" | "adr_asc" | "adr_desc" | "value" | "arrival";

const OTA_HINTS = ["booking", "expedia", "agoda", "airbnb", "hotelbeds", "hrs", "trivago", "ota", "hostelworld", "despegar", "tripadvisor"];

function isDirect(source: string | null): boolean {
  if (!source) return true;
  const s = source.toLowerCase();
  return !OTA_HINTS.some((h) => s.includes(h));
}

/** Minutes since Budapest midnight for an ISO timestamp. */
function budapestMinutes(iso: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Budapest", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(iso));
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h * 60 + m;
}

function fmtTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    timeZone: "Europe/Budapest", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

function fmtDay(d: string) {
  return new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, {
    timeZone: "UTC", weekday: "short", day: "numeric", month: "short",
  });
}

function pct(n: number) {
  return `${Math.round(n * 10) / 10}%`;
}

interface AiSignal {
  key: string;
  title: string;
  why: string;
  action?: string | null;
  tone?: "good" | "warn" | "bad";
  priority?: number;
  confidence?: "high" | "medium" | "low" | null;
}

interface SignalAction {
  decision: "done" | "dismissed";
  note: string | null;
}

interface DisplaySignal {
  key: string;
  title: string;
  why: string;
  action: string | null;
  tone: "good" | "warn" | "bad";
  confidence: "high" | "medium" | "low" | null;
  ai: boolean;
}

function slugify(v: string): string {
  return v.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}

/* -------------------------------------------------------------- component */

interface Props {
  hotelId: string | null;
  /** Budapest "today" from the revenue data hook. */
  today: string;
  lastSyncAt?: string | null;
}

/**
 * "Today's Sales & ADR Goal" — a mobile-first cockpit answering: what did we
 * sell today, at what ADR, how far is that from the manager's target, what is
 * dragging ADR down and what should be done before the day ends.
 * Every figure comes from Previo reservation data (Budapest calendar days).
 */
export default function TodaysSalesAdrGoal({ hotelId, today, lastSyncAt }: Props) {
  /* ------------------------------------------------------------- filters */
  const [preset, setPreset] = useState<PresetKey>("today");
  const [customFrom, setCustomFrom] = useState(today);
  const [customTo, setCustomTo] = useState(today);
  // Stay-date narrowing is OFF by default. It used to default to today + 90
  // days, which silently dropped every booking that arrives further out — the
  // panel then showed fewer bookings and a different ADR than Previo.
  const [stayFilterOn, setStayFilterOn] = useState(false);
  const [stayFrom, setStayFrom] = useState(today);
  const [stayTo, setStayTo] = useState(addDays(today, 365));
  const [showCancelled, setShowCancelled] = useState(false);
  const isMobile = useIsMobile();
  const [compare, setCompare] = useState<CompareKey>("goal");
  const [filter, setFilter] = useState<BookingFilter>("all");
  const [sort, setSort] = useState<SortKey>("created");
  const [futureNights, setFutureNights] = useState(3);

  const [bookedFrom, bookedTo] = useMemo<[string, string]>(() => {
    switch (preset) {
      case "yesterday": return [addDays(today, -1), addDays(today, -1)];
      case "last7": return [addDays(today, -6), today];
      case "month": return [`${today.slice(0, 7)}-01`, today];
      case "custom": return [customFrom, customTo];
      default: return [today, today];
    }
  }, [preset, today, customFrom, customTo]);

  /* --------------------------------------------------------------- goals */
  // Goals live in the database per property, in that property's own currency
  // (SLNT publishes forints), so every manager sees the same target instead of
  // a euro default saved on one laptop.
  const storageKey = `hc.revenue.salesGoals.${hotelId ?? "default"}`;
  const [goals, setGoals] = useState<SalesGoals>(DEFAULT_GOALS);
  const [goalsOpen, setGoalsOpen] = useState(false);
  const [goalsSeeded, setGoalsSeeded] = useState(false);

  useEffect(() => {
    if (!hotelId) return;
    let cancelled = false;
    setGoalsSeeded(false);
    void (async () => {
      const { data } = await (supabase.from("hotel_revenue_settings") as any)
        .select("target_adr, target_room_nights, target_booking_value, promo_budget")
        .eq("hotel_id", hotelId)
        .maybeSingle();
      if (cancelled) return;
      const row = (data ?? {}) as Record<string, number | null>;
      if (row.target_adr != null) {
        setGoals({
          targetAdr: Number(row.target_adr) || 0,
          targetRoomNights: Number(row.target_room_nights ?? DEFAULT_GOALS.targetRoomNights),
          targetValue: Number(row.target_booking_value ?? 0),
          promoBudget: Number(row.promo_budget ?? 0),
        });
        setGoalsSeeded(true);
        return;
      }
      // No shared goal yet — fall back to this device's old saved goals, if any.
      try {
        const raw = localStorage.getItem(storageKey);
        if (raw) { setGoals({ ...DEFAULT_GOALS, ...JSON.parse(raw) }); setGoalsSeeded(true); return; }
      } catch { /* ignore unreadable storage */ }
      setGoals(DEFAULT_GOALS);
    })();
    return () => { cancelled = true; };
  }, [hotelId, storageKey]);

  const saveGoals = useCallback((next: SalesGoals) => {
    setGoals(next);
    setGoalsSeeded(true);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* ignore */ }
    if (!hotelId) return;
    void (supabase.from("hotel_revenue_settings") as any).upsert({
      hotel_id: hotelId,
      target_adr: next.targetAdr,
      target_room_nights: next.targetRoomNights,
      target_booking_value: next.targetValue,
      promo_budget: next.promoBudget,
    } as any, { onConflict: "hotel_id" });
  }, [storageKey, hotelId]);


  /* ---------------------------------------------------------------- data */
  const [rows, setRows] = useState<NightRow[]>([]);
  const [cancelledRows, setCancelledRows] = useState<NightRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!hotelId) { setLoading(false); return; }
    setLoading(true);
    // Reach back far enough to also cover the comparison periods (yesterday and
    // the same weekday last week), and one extra day either side for timezone.
    const wideFrom = `${addDays(bookedFrom, -8)}T00:00:00Z`;
    const wideTo = `${addDays(bookedTo, 1)}T23:59:59Z`;
    const cols = "res_id, room_key, stay_date, room_type_name, guests, nightly_price_eur, total_price_eur, stay_from, stay_to, source_name, created_at_pms, status_id";
    const [live, cancelled, cancelledInPeriod] = await Promise.all([
      supabase.from("revenue_booking_nights").select(cols)
        .eq("hotel_id", hotelId)
        .gte("created_at_pms", wideFrom).lte("created_at_pms", wideTo)
        .order("created_at_pms", { ascending: false }).limit(5000),
      supabase.from("revenue_cancelled_nights").select(`${cols}, cancelled_at`)
        .eq("hotel_id", hotelId)
        .gte("created_at_pms", wideFrom).lte("created_at_pms", wideTo)
        .order("created_at_pms", { ascending: false }).limit(5000),
      // A booking made weeks ago but cancelled inside the period is today's
      // negative pickup, so it has to be pulled by its cancellation time too.
      supabase.from("revenue_cancelled_nights").select(`${cols}, cancelled_at`)
        .eq("hotel_id", hotelId)
        .gte("cancelled_at", wideFrom).lte("cancelled_at", wideTo)
        .order("cancelled_at", { ascending: false }).limit(5000),
    ]);
    setRows((live.data ?? []) as unknown as NightRow[]);
    const merged = new Map<string, NightRow>();
    for (const r of [...(cancelled.data ?? []), ...(cancelledInPeriod.data ?? [])] as unknown as NightRow[]) {
      merged.set(`${r.res_id}|${r.room_key ?? ""}|${r.stay_date}`, r);
    }
    setCancelledRows(Array.from(merged.values()));
    setLoading(false);
  }, [hotelId, bookedFrom, bookedTo]);

  useEffect(() => { void load(); }, [load]);

  // Refresh whenever the sync writes new reservation data.
  useEffect(() => { if (lastSyncAt) void load(); }, [lastSyncAt, load]);

  /* --------------------------------------------------- booking assembly */
  const allBookings = useMemo<SaleBooking[]>(() => {
    const build = (list: NightRow[], cancelledFeed: boolean): SaleBooking[] => {
      const byRes = new Map<string, NightRow[]>();
      for (const r of list) {
        if (!r.created_at_pms) continue;
        if (stayFilterOn && (r.stay_date < stayFrom || r.stay_date > stayTo)) continue;
        const k = `${r.res_id}|${r.room_key ?? ""}`;
        const bucket = byRes.get(k);
        if (bucket) bucket.push(r); else byRes.set(k, [r]);
      }
      const out: SaleBooking[] = [];
      for (const [key, group] of byRes) {
        const first = group[0];
        const created = first.created_at_pms as string;
        const dates = group.map((n) => n.stay_date).sort();
        const revenue = group.reduce((s, n) => s + (Number(n.nightly_price_eur) || 0), 0);
        out.push({
          key: cancelledFeed ? `x-${key}` : key,
          res_id: first.res_id,
          created,
          // A cancellation belongs to the day it was cancelled — that is when
          // it moved the pickup — not to the day the booking was made.
          createdDay: budapestDayOf(cancelledFeed ? (first.cancelled_at ?? created) : created),
          createdMinutes: budapestMinutes(cancelledFeed ? (first.cancelled_at ?? created) : created),
          stayFrom: first.stay_from ?? dates[0],
          stayTo: first.stay_to ?? addDays(dates[dates.length - 1], 1),
          roomNights: group.length,
          revenue,
          adr: group.length ? revenue / group.length : null,
          roomType: first.room_type_name ?? "Unknown room type",
          channel: first.source_name ?? "Direct / unknown",
          direct: isDirect(first.source_name),
          guests: first.guests ?? 1,
          cancelled: cancelledFeed || first.status_id === 7,
        });
      }
      return out;
    };
    return [...build(rows, false), ...build(cancelledRows, true)];
  }, [rows, cancelledRows, stayFilterOn, stayFrom, stayTo]);

  /** Bookings created inside the selected period (cancellations optional). */
  const periodBookings = useMemo(
    () => allBookings.filter((b) =>
      b.createdDay >= bookedFrom && b.createdDay <= bookedTo && (showCancelled || !b.cancelled)),
    [allBookings, bookedFrom, bookedTo, showCancelled],
  );

  /** Only the live ones drive every KPI. */
  const liveBookings = useMemo(() => periodBookings.filter((b) => !b.cancelled), [periodBookings]);

  // First visit for a property: seed the target from what it actually sells,
  // in its own currency. A euro default of 120 is meaningless for a forint
  // property and made the ADR target read as nothing at all.
  useEffect(() => {
    if (goalsSeeded || loading || !hotelId) return;
    const recent = allBookings.filter((b) => !b.cancelled && b.adr !== null);
    if (recent.length < 3) return;
    const adrs = recent.map((b) => b.adr as number).sort((a, b) => a - b);
    const median = adrs[Math.floor(adrs.length / 2)];
    if (!median || !Number.isFinite(median)) return;
    const nights = Math.max(1, Math.round(recent.reduce((s, b) => s + b.roomNights, 0) / 30));
    saveGoals({
      targetAdr: Math.round(median),
      targetRoomNights: nights,
      targetValue: Math.round(median) * nights,
      promoBudget: 0,
    });
  }, [goalsSeeded, loading, hotelId, allBookings, saveGoals]);


  const kpi = useMemo(() => {
    const roomNights = liveBookings.reduce((s, b) => s + b.roomNights, 0);
    const revenue = liveBookings.reduce((s, b) => s + b.revenue, 0);
    const reservationIds = new Set(liveBookings.map((b) => b.res_id));
    // Cancellations are counted from the full period feed, so the negative
    // pickup is visible even while the list hides cancelled rows.
    const cancelledInPeriod = allBookings.filter(
      (b) => b.cancelled && b.createdDay >= bookedFrom && b.createdDay <= bookedTo,
    );
    const cancelledReservationIds = new Set(cancelledInPeriod.map((b) => b.res_id));
    const cancelledNights = cancelledInPeriod.reduce((s, b) => s + b.roomNights, 0);
    const cancelledRevenue = cancelledInPeriod.reduce((s, b) => s + b.revenue, 0);
    const adr = roomNights ? revenue / roomNights : null;
    const variance = adr === null ? null : adr - goals.targetAdr;
    return {
      bookings: reservationIds.size,
      roomGroups: liveBookings.length,
      cancelled: cancelledReservationIds.size,
      cancelledNights,
      cancelledRevenue,
      netNights: roomNights - cancelledNights,
      roomNights,
      revenue,
      adr,
      variance,
      variancePct: adr === null || !goals.targetAdr ? null : ((adr - goals.targetAdr) / goals.targetAdr) * 100,
      adrGoalPct: adr === null || !goals.targetAdr ? 0 : (adr / goals.targetAdr) * 100,
      valueGoalPct: goals.targetValue ? (revenue / goals.targetValue) * 100 : 0,
      nightsGoalPct: goals.targetRoomNights ? (roomNights / goals.targetRoomNights) * 100 : 0,
      los: reservationIds.size ? roomNights / reservationIds.size : 0,
    };
  }, [liveBookings, allBookings, bookedFrom, bookedTo, goals]);

  /** green / amber / red against the ADR target. */
  const adrTone = useMemo(() => {
    if (kpi.adr === null) return "neutral" as const;
    if (kpi.adr >= goals.targetAdr) return "good" as const;
    if (kpi.adr >= goals.targetAdr * 0.9) return "warn" as const;
    return "bad" as const;
  }, [kpi.adr, goals.targetAdr]);

  const toneClass = {
    good: "text-emerald-600 dark:text-emerald-400",
    warn: "text-amber-600 dark:text-amber-400",
    bad: "text-red-600 dark:text-red-400",
    neutral: "text-muted-foreground",
  }[adrTone];

  /* --------------------------------------------------------------- chart */
  const nowMinutes = budapestMinutes(new Date().toISOString());
  const isTodayPeriod = bookedFrom === today && bookedTo === today;

  const chart = useMemo(() => {
    const cutoff = isTodayPeriod ? nowMinutes : 24 * 60 - 1;
    const buckets: number[] = [];
    for (let m = 0; m <= cutoff; m += 120) buckets.push(m);
    if (buckets[buckets.length - 1] < cutoff) buckets.push(cutoff);

    const seriesFor = (list: SaleBooking[]) => {
      let value = 0, nights = 0;
      return buckets.map((m) => {
        let windowValue = 0;
        const windowRes = new Set<string>();
        for (const b of list) {
          if (b.createdMinutes <= m && b.createdMinutes > m - 120) {
            value += b.revenue; nights += b.roomNights;
            windowValue += b.revenue; windowRes.add(b.res_id);
          }
        }
        return { value: Math.round(value), nights, windowValue: Math.round(windowValue), windowBookings: windowRes.size };
      });
    };

    const base = seriesFor(liveBookings.slice().sort((a, b) => a.createdMinutes - b.createdMinutes));

    const compareDay = compare === "yesterday" ? addDays(today, -1)
      : compare === "lastweek" ? addDays(today, -7) : null;
    const compareList = compareDay
      ? allBookings.filter((b) => !b.cancelled && b.createdDay === compareDay)
        .sort((a, b) => a.createdMinutes - b.createdMinutes)
      : [];
    const cmp = compareDay ? seriesFor(compareList) : null;

    return buckets.map((m, i) => ({
      label: `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`,
      value: base[i].value,
      nights: base[i].nights,
      // Non-cumulative: what actually got booked inside this two-hour window.
      windowValue: base[i].windowValue,
      windowBookings: base[i].windowBookings,
      adr: base[i].nights ? Math.round(base[i].value / base[i].nights) : null,
      compare: cmp ? cmp[i].value : goals.targetValue ? Math.round((goals.targetValue * (m + 1)) / (24 * 60)) : null,
    }));
  }, [liveBookings, allBookings, compare, today, goals.targetValue, isTodayPeriod, nowMinutes]);

  /** Busiest booking window and the individual booking times behind it. */
  const bookingTiming = useMemo(() => {
    const withTime = liveBookings.filter((b) => b.created);
    if (withTime.length === 0) return null;
    let peak = chart[0];
    for (const c of chart) if (c.windowValue > (peak?.windowValue ?? 0)) peak = c;
    const times = withTime
      .slice()
      .sort((a, b) => b.createdMinutes - a.createdMinutes)
      .map((b) => ({
        key: b.key,
        res: b.res_id,
        time: `${String(Math.floor(b.createdMinutes / 60)).padStart(2, "0")}:${String(b.createdMinutes % 60).padStart(2, "0")}`,
        revenue: b.revenue,
        nights: b.roomNights,
        channel: b.channel,
      }));
    const first = times[times.length - 1];
    const last = times[0];
    return { peak, times, first, last };
  }, [liveBookings, chart]);

  const compareLabel = compare === "yesterday" ? "Yesterday" : compare === "lastweek" ? "Same weekday last week" : "Daily goal pace";

  /* -------------------------------------------------------- ADR recovery */
  const recovery = useMemo(() => {
    if (kpi.adr === null || kpi.adr >= goals.targetAdr) return null;
    const gap = goals.targetAdr * kpi.roomNights - kpi.revenue;
    const options = [1, 2, 3, 5, 10].map((n) => ({
      n,
      required: (goals.targetAdr * (kpi.roomNights + n) - kpi.revenue) / n,
    }));
    const chosen = options.find((o) => o.n === futureNights) ?? options[2];
    return { gap, options, chosen, unrealistic: chosen.required > goals.targetAdr * 2.5 };
  }, [kpi, goals.targetAdr, futureNights]);

  /* ------------------------------------------------------------- leakage */
  interface LeakRow {
    label: string; bookings: number; roomNights: number; revenue: number;
    adr: number; diff: number; impact: number;
  }

  const leakage = useMemo(() => {
    const group = (keyOf: (b: SaleBooking) => string): LeakRow[] => {
      const map = new Map<string, { bookings: number; nights: number; revenue: number }>();
      for (const b of liveBookings) {
        const k = keyOf(b);
        const cur = map.get(k) ?? { bookings: 0, nights: 0, revenue: 0 };
        cur.bookings += 1; cur.nights += b.roomNights; cur.revenue += b.revenue;
        map.set(k, cur);
      }
      return Array.from(map.entries()).map(([label, v]) => {
        const adr = v.nights ? v.revenue / v.nights : 0;
        const diff = adr - goals.targetAdr;
        return {
          label, bookings: v.bookings, roomNights: v.nights, revenue: v.revenue,
          adr, diff,
          // How many euros of ADR this group drags the whole day by.
          impact: kpi.roomNights ? (diff * v.nights) / kpi.roomNights : 0,
        };
      }).sort((a, b) => a.impact - b.impact);
    };

    return {
      channel: group((b) => b.channel),
      roomType: group((b) => b.roomType),
      stayDate: group((b) => b.stayFrom),
      los: group((b) => (b.roomNights === 1 ? "1 night" : b.roomNights <= 3 ? "2–3 nights" : "4+ nights")),
      directOta: group((b) => (b.direct ? "Direct" : "OTA")),
    };
  }, [liveBookings, goals.targetAdr, kpi.roomNights]);

  /** Stay dates that already sell well vs. those that need the discount. */
  const nightsByStayDate = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of liveBookings) m.set(b.stayFrom, (m.get(b.stayFrom) ?? 0) + b.roomNights);
    return m;
  }, [liveBookings]);

  /* ----------------------------------------------------- recommendations */
  const recommendations = useMemo(() => {
    const out: { title: string; why: string; tone: "good" | "warn" | "bad" }[] = [];
    if (!liveBookings.length) return out;

    const worstChannel = leakage.channel[0];
    if (worstChannel && worstChannel.diff < 0 && worstChannel.roomNights >= 2) {
      out.push({
        tone: "bad",
        title: `Review pricing on ${worstChannel.label}`,
        why: `${worstChannel.roomNights} room-nights at ${eur(worstChannel.adr)} ADR — ${eur(Math.abs(worstChannel.diff))} below the ${eur(goals.targetAdr)} target, dragging today's ADR by ${eur(Math.abs(worstChannel.impact))}.`,
      });
    }
    const bestChannel = leakage.channel[leakage.channel.length - 1];
    if (bestChannel && bestChannel !== worstChannel && bestChannel.diff > 0) {
      out.push({
        tone: "good",
        title: `Push more volume through ${bestChannel.label}`,
        why: `It produced ${eur(bestChannel.adr)} ADR today (${eur(bestChannel.diff)} above target) on ${bestChannel.roomNights} room-nights — the healthiest mix to grow.`,
      });
    }
    const worstRoom = leakage.roomType[0];
    if (worstRoom && worstRoom.diff < -10) {
      out.push({
        tone: "warn",
        title: `${worstRoom.label} is selling too cheaply`,
        why: `${eur(worstRoom.adr)} average nightly rate against a ${eur(goals.targetAdr)} target. Consider raising its minimum rate or upselling to a superior room.`,
      });
    }
    const hotDates = Array.from(nightsByStayDate.entries()).filter(([, n]) => n >= 3);
    for (const [d, n] of hotDates.slice(0, 2)) {
      out.push({
        tone: "good",
        title: `Raise rates for ${fmtDay(d)}`,
        why: `${n} room-nights picked up today for that arrival date — demand is building, so the current rate is likely below what the market will pay.`,
      });
    }
    const softDates = leakage.stayDate.filter((r) => r.diff < 0 && r.roomNights === 1);
    if (softDates.length) {
      out.push({
        tone: "warn",
        title: "Keep discounts running on soft dates",
        why: `${softDates.slice(0, 3).map((r) => fmtDay(r.label)).join(", ")} sold below target but only one room-night each — those stays still fill otherwise weak nights, so do not cut the offer yet.`,
      });
    }
    const direct = leakage.directOta.find((r) => r.label === "Direct");
    const ota = leakage.directOta.find((r) => r.label === "OTA");
    if (direct && ota && direct.adr > ota.adr) {
      out.push({
        tone: "good",
        title: "Shift promotion budget toward direct booking",
        why: `Direct produced ${eur(direct.adr)} ADR versus ${eur(ota.adr)} on OTA today — the same demand is worth more when it comes direct.`,
      });
    }
    if (kpi.adr !== null && kpi.adr < goals.targetAdr) {
      out.push({
        tone: "warn",
        title: "Upsell superior rooms and add-ons on today's arrivals",
        why: `Today's ADR is ${eur(kpi.adr)}, ${eur(goals.targetAdr - kpi.adr)} short of target. Upgrades and add-ons lift value without touching public rates.`,
      });
    }
    return out;
  }, [liveBookings, leakage, goals.targetAdr, kpi.adr, nightsByStayDate]);

  /* ------------------------------------------- signal actions + AI review */
  const [aiSignals, setAiSignals] = useState<AiSignal[]>([]);
  const [aiHeadline, setAiHeadline] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [actions, setActions] = useState<Record<string, SignalAction>>({});
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");

  const loadActions = useCallback(async () => {
    if (!hotelId) return;
    const { data } = await supabase
      .from("revenue_signal_actions")
      .select("signal_key, decision, note")
      .eq("hotel_id", hotelId)
      .eq("business_date", today);
    const map: Record<string, SignalAction> = {};
    for (const r of data ?? []) {
      map[String(r.signal_key)] = { decision: String(r.decision) as SignalAction["decision"], note: r.note ?? null };
    }
    setActions(map);
  }, [hotelId, today]);

  useEffect(() => { void loadActions(); }, [loadActions]);

  const displayedSignals = useMemo<DisplaySignal[]>(() => {
    if (aiSignals.length) {
      return aiSignals
        .slice()
        .sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9))
        .map((s) => ({
          key: s.key || slugify(s.title),
          title: s.title,
          why: s.why,
          action: s.action ?? null,
          tone: s.tone ?? "warn",
          confidence: s.confidence ?? null,
          ai: true,
        }));
    }
    return recommendations.map((r) => ({
      key: slugify(r.title), title: r.title, why: r.why, action: null, tone: r.tone, confidence: null, ai: false,
    }));
  }, [aiSignals, recommendations]);

  const recordAction = useCallback(async (
    signal: DisplaySignal,
    decision: SignalAction["decision"],
    note?: string | null,
  ) => {
    if (!hotelId) return;
    const previous = actions[signal.key];
    setActions((prev) => ({ ...prev, [signal.key]: { decision, note: note ?? null } }));
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) return;
    const { error } = await supabase
      .from("revenue_signal_actions")
      .upsert([{
        hotel_id: hotelId,
        business_date: today,
        signal_key: signal.key,
        signal_snapshot: JSON.parse(JSON.stringify(signal)),
        decision,
        note: note ?? null,
        acted_by: uid,
      }], { onConflict: "hotel_id,business_date,signal_key" });
    if (error) {
      setActions((prev) => {
        const next = { ...prev };
        if (previous) next[signal.key] = previous; else delete next[signal.key];
        return next;
      });
    }
  }, [hotelId, today, actions]);

  const clearAction = useCallback(async (signal: DisplaySignal) => {
    if (!hotelId) return;
    setActions((prev) => { const n = { ...prev }; delete n[signal.key]; return n; });
    await supabase
      .from("revenue_signal_actions")
      .delete()
      .eq("hotel_id", hotelId)
      .eq("business_date", today)
      .eq("signal_key", signal.key);
  }, [hotelId, today]);

  const sharpenWithAi = useCallback(async () => {
    if (!hotelId) return;
    setAiLoading(true);
    setAiError(null);
    try {
      const evidence = {
        goals,
        kpi: { adr: kpi.adr, roomNights: kpi.roomNights, revenue: kpi.revenue },
        heuristics: recommendations,
        leakage: {
          channel: leakage.channel, roomType: leakage.roomType,
          directOta: leakage.directOta, los: leakage.los, stayDate: leakage.stayDate.slice(0, 20),
        },
        bookings: liveBookings.slice(0, 80).map((b) => ({
          created: b.created, stayFrom: b.stayFrom, nights: b.roomNights,
          adr: b.adr, channel: b.channel, roomType: b.roomType, direct: b.direct,
        })),
      };
      const { data, error } = await supabase.functions.invoke("revenue-signals", {
        body: { hotelId, businessDate: today, evidence },
      });
      if (error) throw error;
      if (data?.error) throw new Error(String(data.error));
      setAiSignals(Array.isArray(data?.signals) ? data.signals : []);
      setAiHeadline(data?.headline ?? null);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "Could not reach the analysis service.");
    } finally {
      setAiLoading(false);
    }
  }, [hotelId, today, goals, kpi, recommendations, leakage, liveBookings]);


  /* -------------------------------------------------------- booking list */
  const listed = useMemo(() => {
    let list = periodBookings.slice();
    if (filter === "below") list = list.filter((b) => (b.adr ?? 0) < goals.targetAdr);
    if (filter === "above") list = list.filter((b) => (b.adr ?? 0) >= goals.targetAdr);
    if (filter === "direct") list = list.filter((b) => b.direct);
    if (filter === "ota") list = list.filter((b) => !b.direct);
    list.sort((a, b) => {
      if (sort === "adr_asc") return (a.adr ?? 0) - (b.adr ?? 0);
      if (sort === "adr_desc") return (b.adr ?? 0) - (a.adr ?? 0);
      if (sort === "value") return b.revenue - a.revenue;
      if (sort === "arrival") return a.stayFrom.localeCompare(b.stayFrom);
      return (b.created ?? "").localeCompare(a.created ?? "");
    });
    return list;
  }, [periodBookings, filter, sort, goals.targetAdr]);

  /* ------------------------------------------------------------ headline */
  const periodWord = preset === "today" ? "Today" : preset === "yesterday" ? "Yesterday" : "In this period";
  const headline = useMemo(() => {
    if (!kpi.bookings) return "No bookings have been created today yet.";
    const worst = leakage.channel[0] ?? leakage.roomType[0];
    const base = `${periodWord} you created ${kpi.bookings} booking${kpi.bookings === 1 ? "" : "s"}, ${kpi.roomNights} room night${kpi.roomNights === 1 ? "" : "s"} and ${eur(Math.round(kpi.revenue))} in room revenue at an ADR of ${eur(kpi.adr)}`;
    if (kpi.variance === null) return `${base}.`;
    if (kpi.variance >= 0) return `${base}, which is ${eur(Math.round(kpi.variance))} above your ${eur(goals.targetAdr)} target.`;
    const cause = worst && worst.diff < 0 ? ` The largest negative impact comes from ${worst.label}.` : "";
    return `${base}, which is ${eur(Math.round(Math.abs(kpi.variance)))} below your ${eur(goals.targetAdr)} target.${cause}`;
  }, [kpi, goals.targetAdr, leakage, periodWord]);

  /* ----------------------------------------------------------------- UI */
  return (
    <Card>
      <CardHeader className="pb-3 gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            Today’s Sales &amp; ADR Goal
            <Badge variant="outline" className="font-normal">Budapest time · Live</Badge>
          </CardTitle>
          {/* No manual refresh: the panel follows the page's shared sync. */}
          <span className="text-[11px] text-muted-foreground">
            {lastSyncAt ? `As of ${fmtTime(lastSyncAt)} · updates with the page sync` : "Waiting for the first page sync"}
          </span>
        </div>

        {/* One-sentence answer, always first on mobile. */}
        <p className="text-sm leading-snug">{headline}</p>

        {/* Booking-creation period presets. */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-md border overflow-hidden">
            {([["today", "Today"], ["yesterday", "Yesterday"], ["last7", "Last 7 days"], ["month", "This month"]] as const).map(([k, l]) => (
              <Button key={k} size="sm" variant={preset === k ? "default" : "ghost"} className="h-9 rounded-none px-3 text-xs"
                onClick={() => setPreset(k)}>{l}</Button>
            ))}
            <Button size="sm" variant={preset === "custom" ? "default" : "ghost"} className="h-9 rounded-none px-3 text-xs"
              onClick={() => setPreset("custom")}>Custom</Button>
          </div>
          <Button size="sm" variant={showCancelled ? "secondary" : "outline"} className="h-9 px-3 text-xs"
            onClick={() => setShowCancelled((v) => !v)}>
            {showCancelled ? "Cancellations in list" : "List: live bookings only"}
          </Button>
          <Button size="sm" variant={stayFilterOn ? "secondary" : "outline"} className="h-9 px-3 text-xs"
            onClick={() => setStayFilterOn((v) => !v)}>
            {stayFilterOn ? "Stay-date filter on" : "All stay dates"}
          </Button>
        </div>

        {preset === "custom" && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-[11px] text-muted-foreground">Booking created from</Label>
              <Input type="date" className="h-9" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
            </div>
            <div>
              <Label className="text-[11px] text-muted-foreground">Booking created to</Label>
              <Input type="date" className="h-9" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
            </div>
          </div>
        )}

        {stayFilterOn && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-[11px] text-muted-foreground">Guest stay dates from</Label>
              <Input type="date" className="h-9" value={stayFrom} onChange={(e) => setStayFrom(e.target.value)} />
            </div>
            <div>
              <Label className="text-[11px] text-muted-foreground">Guest stay dates to</Label>
              <Input type="date" className="h-9" value={stayTo} onChange={(e) => setStayTo(e.target.value)} />
            </div>
          </div>
        )}
        <p className="text-[11px] text-muted-foreground">
          The period filters when the <strong>booking was created</strong>. Every booking counts
          whatever its arrival date{stayFilterOn ? ", unless you narrow the guest stay dates above." : "."}
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* ------------------------------------------------------- goals */}
        <Collapsible open={goalsOpen} onOpenChange={setGoalsOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="outline" className="w-full h-10 justify-between text-sm">
              <span className="flex items-center gap-2"><Target className="h-4 w-4 text-primary" /> Goals · ADR {eur(goals.targetAdr)}</span>
              <ChevronDown className={`h-4 w-4 transition-transform ${goalsOpen ? "rotate-180" : ""}`} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2 grid grid-cols-2 gap-2">
            <GoalInput label={`Target ADR (${currencySymbol()})`} value={goals.targetAdr} onChange={(v) => saveGoals({ ...goals, targetAdr: v })} />
            <GoalInput label="Room-night target" value={goals.targetRoomNights} onChange={(v) => saveGoals({ ...goals, targetRoomNights: v })} />
            <GoalInput label={`Booking value target (${currencySymbol()})`} value={goals.targetValue} onChange={(v) => saveGoals({ ...goals, targetValue: v })} />
            <GoalInput label={`Max promotion budget (${currencySymbol()})`} value={goals.promoBudget} onChange={(v) => saveGoals({ ...goals, promoBudget: v })} />
            <p className="col-span-2 text-[11px] text-muted-foreground">Saved for this property in {currencySymbol()} — everyone on the team sees the same targets.</p>
          </CollapsibleContent>
        </Collapsible>

        {loading ? (
          <div className="py-8 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading today’s sales…
          </div>
        ) : (
          <>
            {/* --------------------------------------------------- KPIs */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
               <Kpi
                 label="Bookings created"
                 value={String(kpi.bookings)}
                 sub={kpi.roomGroups > kpi.bookings ? `${kpi.roomGroups} rooms across these reservations` : undefined}
               />
              <Kpi label="Room nights sold" value={String(kpi.roomNights)} />
              <Kpi label="Booking value" value={eur(Math.round(kpi.revenue))} />
              <Kpi label="Actual ADR" value={kpi.adr === null ? "—" : eur(Math.round(kpi.adr))} tone={toneClass} />
              <Kpi label="ADR target" value={eur(goals.targetAdr)} />
              <Kpi
                label="ADR variance"
                tone={toneClass}
                value={kpi.variance === null ? "—" : `${kpi.variance >= 0 ? "+" : "−"}${eur(Math.round(Math.abs(kpi.variance)))}`}
                sub={kpi.variancePct === null ? undefined : `${kpi.variancePct >= 0 ? "+" : "−"}${pct(Math.abs(kpi.variancePct))}`}
              />
              <Kpi label="Revenue goal" value={pct(kpi.valueGoalPct)} sub={`of ${eur(goals.targetValue)}`} />
              <Kpi label="Avg length of stay" value={kpi.los ? `${kpi.los.toFixed(1)} n` : "—"} />
            </div>

            {/* --------------------------------------------- ADR status */}
            <div className="rounded-lg border p-3 space-y-2">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="flex items-center gap-2"><Gauge className="h-4 w-4 text-primary" /> ADR against goal</span>
                <span className={`font-semibold ${toneClass}`}>
                  {kpi.adr === null
                    ? "No bookings yet today"
                    : `${eur(Math.round(kpi.adr))} ADR · ${eur(Math.round(Math.abs(kpi.variance ?? 0)))} ${((kpi.variance ?? 0) >= 0) ? "above" : "below"} target`}
                </span>
              </div>
              <Progress
                value={Math.min(100, kpi.adrGoalPct)}
                aria-label="Share of the ADR goal achieved"
                className={adrTone === "good" ? "[&>div]:bg-emerald-500" : adrTone === "warn" ? "[&>div]:bg-amber-500" : "[&>div]:bg-red-500"}
              />
              <div className="flex justify-between text-[11px] text-muted-foreground">
                <span>{eur(0)}</span>
                <span>{kpi.adr === null ? "—" : `${pct(kpi.adrGoalPct)} of ADR goal achieved`}</span>
                <span>{eur(goals.targetAdr)}{kpi.adrGoalPct > 100 ? "+" : ""}</span>
              </div>
              {kpi.cancelled > 0 && (
                <p className="text-[11px] text-muted-foreground">
                  {kpi.cancelled} cancelled booking{kpi.cancelled === 1 ? "" : "s"} in this period are excluded from every figure above.
                </p>
              )}
            </div>

            {/* ------------------------------------------------- chart */}
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-medium">Today’s sales performance</h3>
                <Select value={compare} onValueChange={(v) => setCompare(v as CompareKey)}>
                  <SelectTrigger className="h-9 w-[210px] text-xs" aria-label="Comparison"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="goal">Versus daily goal</SelectItem>
                    <SelectItem value="yesterday">Versus yesterday</SelectItem>
                    <SelectItem value="lastweek">Versus same weekday last week</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chart} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-muted" />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                    {/* Compact labels (12k) so large euro totals are never clipped. */}
                    <YAxis yAxisId="v" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={40}
                      tickFormatter={(v: number) => (Math.abs(v) >= 1000 ? `${Math.round(v / 100) / 10}k` : String(Math.round(v)))} />
                    <YAxis yAxisId="adr" orientation="right" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={38}
                      domain={[0, (max: number) => Math.max(goals.targetAdr * 1.4, max * 1.15)]} />
                    <RTooltip
                      contentStyle={{ fontSize: 11, padding: "4px 8px" }}
                      formatter={(value: unknown, name: string, item: any) => {
                        if (name === "Booked in this window") {
                          const n = item?.payload?.windowBookings ?? 0;
                          return [`${eur(Number(value))} · ${n} booking${n === 1 ? "" : "s"}`, name];
                        }
                        return [eur(Number(value)), name];
                      }}
                      labelFormatter={(l) => `${l} Budapest · booked in the 2h up to this point`}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <ReferenceLine yAxisId="adr" y={goals.targetAdr} stroke="hsl(var(--primary))" strokeDasharray="5 3"
                      label={{ value: `ADR target ${eur(goals.targetAdr)}`, position: "right", fontSize: 10, fill: "hsl(var(--primary))" }} />
                    {/* Bars show WHEN the bookings actually landed, not the running total. */}
                    <Bar yAxisId="v" dataKey="windowValue" name="Booked in this window"
                      fill="hsl(199 89% 48% / 0.35)" barSize={14} radius={[3, 3, 0, 0]} />
                    <Area yAxisId="v" type="monotone" dataKey="value" name="Booking value" stroke="hsl(199 89% 48%)"
                      fill="hsl(199 89% 48% / 0.15)" strokeWidth={2} />
                    {/* The pace/compare line is desktop-only: on a phone it just
                        adds a fifth overlapping series. */}
                    {!isMobile && (
                      <Line yAxisId="v" type="monotone" dataKey="compare" name={compareLabel} stroke="hsl(var(--muted-foreground))"
                        strokeDasharray="4 3" strokeWidth={1.5} dot={false} connectNulls />
                    )}
                    <Line yAxisId="adr" type="monotone" dataKey="adr" name="ADR" stroke="hsl(160 84% 39%)" strokeWidth={2} dot={false} connectNulls />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Bars show what was actually booked in each two-hour window (left axis, {currencySymbol()});
                the filled line is the running total since 00:00 Budapest and the green line is ADR on the
                right axis{isMobile ? "" : `, against ${compareLabel.toLowerCase()}`}.
                Today so far: {kpi.roomNights} room night{kpi.roomNights === 1 ? "" : "s"}.
                End-of-day goal: {eur(goals.targetValue)} value · {goals.targetRoomNights} room nights.
              </p>

              {bookingTiming && (
                <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    <Mini label="First booking" value={bookingTiming.first?.time ?? "—"} />
                    <Mini label="Latest booking" value={bookingTiming.last?.time ?? "—"} />
                    <Mini label="Busiest window" value={bookingTiming.peak ? `${bookingTiming.peak.label}` : "—"} />
                    <Mini label="Booked in that window" value={eur(bookingTiming.peak?.windowValue ?? 0)} />
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {bookingTiming.times.slice(0, 24).map((t) => (
                      <span key={t.key}
                        className="rounded-md border bg-background px-2 py-1 text-[11px] tabular-nums"
                        title={`${t.res} · ${t.channel} · ${t.nights} night${t.nights === 1 ? "" : "s"}`}>
                        <span className="font-medium">{t.time}</span>
                        <span className="text-muted-foreground"> · {eur(Math.round(t.revenue))}</span>
                      </span>
                    ))}
                    {bookingTiming.times.length > 24 && (
                      <span className="px-2 py-1 text-[11px] text-muted-foreground">
                        +{bookingTiming.times.length - 24} more
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Booking times are Budapest time, taken from when each reservation was created in Previo.
                  </p>
                </div>
              )}
            </div>

            {/* ---------------------------------------------- recovery */}
            {recovery && (
              <div className="rounded-lg border border-amber-300/70 dark:border-amber-700/60 bg-amber-50/60 dark:bg-amber-950/20 p-3 space-y-2">
                <h3 className="text-sm font-medium flex items-center gap-2"><Target className="h-4 w-4" /> ADR recovery needed</h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <Mini label="Current ADR" value={eur(Math.round(kpi.adr ?? 0))} />
                  <Mini label="Target ADR" value={eur(goals.targetAdr)} />
                  <Mini label="Room nights" value={String(kpi.roomNights)} />
                  <Mini label="Revenue gap" value={eur(Math.round(recovery.gap))} />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground">Expected extra room nights:</span>
                  <div className="flex rounded-md border overflow-hidden">
                    {recovery.options.map((o) => (
                      <Button key={o.n} size="sm" variant={futureNights === o.n ? "default" : "ghost"}
                        className="h-9 w-10 rounded-none p-0 text-xs" onClick={() => setFutureNights(o.n)}>{o.n}</Button>
                    ))}
                  </div>
                </div>
                <p className="text-sm">
                  {recovery.unrealistic
                    ? "Reaching today’s ADR target through additional bookings may require an unusually high rate. Review low-rated bookings and focus on higher-value stay dates or room types."
                    : `To finish today at ${eur(goals.targetAdr)} ADR, the next ${recovery.chosen.n} room night${recovery.chosen.n === 1 ? "" : "s"} must average ${eur(Math.round(recovery.chosen.required))}.`}
                </p>
              </div>
            )}

            {/* ----------------------------------------------- leakage */}
            <Section title="What is lowering today’s ADR?" defaultOpen={false}>
              {liveBookings.length === 0 ? (
                <p className="text-sm text-muted-foreground">No bookings to analyse yet.</p>
              ) : (
                <div className="space-y-3">
                  <LeakTable title="Booking channel" rows={leakage.channel} target={goals.targetAdr} />
                  <LeakTable title="Room type" rows={leakage.roomType} target={goals.targetAdr} />
                  <LeakTable title="Direct vs OTA" rows={leakage.directOta} target={goals.targetAdr} />
                  <LeakTable title="Length of stay" rows={leakage.los} target={goals.targetAdr} />
                  <LeakTable title="Arrival (stay) date" rows={leakage.stayDate} target={goals.targetAdr} formatLabel={fmtDay} />
                  <p className="text-[11px] text-muted-foreground">
                    Estimated ADR impact = how many euros each group moves today’s overall ADR.
                    A rate below {eur(goals.targetAdr)} is not automatically bad: single room-nights on
                    otherwise empty stay dates still add revenue. Rate plans and promotions are not
                    exposed by the Previo reservation feed, so the channel is used as the closest proxy.
                  </p>
                </div>
              )}
            </Section>

            {/* --------------------------------------- recommendations */}
            <Section title="Quick signals from today’s sales" defaultOpen icon={<Lightbulb className="h-4 w-4 text-primary" />}>
              <div className="flex flex-wrap items-center gap-2 pb-2">
                <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => void sharpenWithAi()} disabled={aiLoading || !hotelId}>
                  {aiLoading ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Lightbulb className="h-3.5 w-3.5 mr-1" />}
                  {aiSignals.length ? "Re-run AI review" : "Sharpen with AI"}
                </Button>
                {aiSignals.length > 0 && (
                  <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => { setAiSignals([]); setAiHeadline(null); }}>
                    Show rule-based signals
                  </Button>
                )}
                <span className="text-[11px] text-muted-foreground">
                  {Object.values(actions).filter((a) => a.decision === "done").length} marked done today
                </span>
              </div>
              {aiError && <p className="text-xs text-red-600 dark:text-red-400 pb-2">{aiError}</p>}
              {aiHeadline && <p className="text-sm font-medium pb-2">{aiHeadline}</p>}

              {displayedSignals.length === 0 ? (
                <p className="text-sm text-muted-foreground">Signals appear once bookings are created today.</p>
              ) : (
                <ul className="space-y-2">
                  {displayedSignals.map((r) => {
                    const act = actions[r.key];
                    return (
                      <li key={r.key} className={`rounded-md border p-2 ${act?.decision === "dismissed" ? "opacity-55" : ""} ${act?.decision === "done" ? "border-emerald-400/70 bg-emerald-50/50 dark:bg-emerald-950/20" : ""}`}>
                        <div className="flex items-start justify-between gap-2">
                          <p className={`text-sm font-medium ${r.tone === "bad" ? "text-red-600 dark:text-red-400" : r.tone === "warn" ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                            {r.title}
                          </p>
                          {r.confidence && (
                            <Badge variant="outline" className="text-[10px] shrink-0">{r.confidence} confidence</Badge>
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground">{r.why}</p>
                        {r.action && <p className="text-[11px] mt-1"><span className="font-medium">Do now:</span> {r.action}</p>}
                        {act?.note && <p className="text-[11px] mt-1 italic text-muted-foreground">Note: {act.note}</p>}

                        <div className="flex flex-wrap items-center gap-1.5 pt-2">
                          {act ? (
                            <>
                              <Badge variant={act.decision === "done" ? "default" : "secondary"} className="text-[10px]">
                                {act.decision === "done" ? "Done" : "Dismissed"}
                              </Badge>
                              <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => void clearAction(r)}>Undo</Button>
                            </>
                          ) : (
                            <>
                              <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => void recordAction(r, "done")}>Mark done</Button>
                              <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => void recordAction(r, "dismissed")}>Dismiss</Button>
                              <Button size="sm" variant="ghost" className="h-7 text-[11px]"
                                onClick={() => { setNoteFor(noteFor === r.key ? null : r.key); setNoteText(""); }}>
                                Add note
                              </Button>
                            </>
                          )}
                        </div>

                        {noteFor === r.key && !act && (
                          <div className="flex items-center gap-1.5 pt-2">
                            <Input value={noteText} onChange={(e) => setNoteText(e.target.value)}
                              placeholder="What did you do?" className="h-8 text-xs" />
                            <Button size="sm" className="h-8 text-[11px]"
                              onClick={() => { void recordAction(r, "done", noteText.trim() || null); setNoteFor(null); }}>
                              Save
                            </Button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              <p className="text-[11px] text-muted-foreground pt-2">
                Marked actions are stored per day, so the system learns which signals the team acts on.
                Prioritised, evidence-backed actions for the next 90 arrival dates are in the
                Revenue Intelligence section above.
              </p>
            </Section>



            {/* ------------------------------------------ booking list */}
            <Section title={`Bookings created ${preset === "today" ? "today" : "in this period"}`} defaultOpen>
              <div className="flex flex-wrap items-center gap-2 pb-2">
                <Select value={filter} onValueChange={(v) => setFilter(v as BookingFilter)}>
                  <SelectTrigger className="h-9 w-[170px] text-xs" aria-label="Filter bookings"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All bookings</SelectItem>
                    <SelectItem value="below">Below ADR goal</SelectItem>
                    <SelectItem value="above">Above ADR goal</SelectItem>
                    <SelectItem value="direct">Direct only</SelectItem>
                    <SelectItem value="ota">OTA only</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
                  <SelectTrigger className="h-9 w-[160px] text-xs" aria-label="Sort bookings"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="created">Newest first</SelectItem>
                    <SelectItem value="adr_asc">Lowest ADR</SelectItem>
                    <SelectItem value="adr_desc">Highest ADR</SelectItem>
                    <SelectItem value="value">Highest value</SelectItem>
                    <SelectItem value="arrival">Arrival date</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {listed.length === 0 ? (
                <p className="text-sm text-muted-foreground">No bookings have been created today yet.</p>
              ) : (
                <ul className="divide-y rounded-md border">
                  {listed.map((b) => {
                    const below = (b.adr ?? 0) < goals.targetAdr;
                    return (
                      <li key={b.key} className={`p-2 space-y-1 ${b.cancelled ? "opacity-60" : ""}`}>
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="text-muted-foreground">{fmtTime(b.created)}</span>
                          <span className={`font-semibold ${below ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                            {eur(Math.round(b.adr ?? 0))} ADR
                          </span>
                        </div>
                        <div className={`text-sm ${b.cancelled ? "line-through" : ""}`}>
                          {fmtDay(b.stayFrom)} → {fmtDay(b.stayTo)} · {b.roomNights} night{b.roomNights === 1 ? "" : "s"}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                          <Badge variant="secondary" className="font-normal">{b.roomType}</Badge>
                          <Badge variant="outline" className="font-normal">{b.channel}</Badge>
                          <Badge variant="outline" className="font-normal">{b.direct ? "Direct" : "OTA"}</Badge>
                          <Badge variant="secondary" className="font-normal">{eur(Math.round(b.revenue))}</Badge>
                          {b.cancelled && <Badge variant="destructive" className="font-normal">Cancelled</Badge>}
                          <Badge variant={below ? "destructive" : "secondary"} className="font-normal">
                            {below ? `${eur(Math.round(goals.targetAdr - (b.adr ?? 0)))} below goal` : "At or above goal"}
                          </Badge>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Section>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------ small parts */

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="rounded-md border bg-muted/30 p-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-lg font-bold leading-tight ${tone ?? ""}`}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}

function GoalInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      <Input type="number" inputMode="decimal" min={0} className="h-9" value={value}
        onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))} />
    </div>
  );
}

function Section({ title, children, defaultOpen = false, icon }: {
  title: string; children: React.ReactNode; defaultOpen?: boolean; icon?: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" className="w-full h-10 justify-between px-2 text-sm font-medium">
          <span className="flex items-center gap-2">{icon}{title}</span>
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2">{children}</CollapsibleContent>
    </Collapsible>
  );
}

function LeakTable({ title, rows, target, formatLabel }: {
  title: string;
  rows: { label: string; bookings: number; roomNights: number; revenue: number; adr: number; diff: number; impact: number }[];
  target: number;
  formatLabel?: (s: string) => string;
}) {
  if (!rows.length) return null;
  return (
    <div className="rounded-md border overflow-hidden">
      <div className="px-2 py-1 text-[11px] uppercase tracking-wide text-muted-foreground bg-muted">{title}</div>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px] min-w-[420px]">
          <thead className="text-muted-foreground">
            <tr>
              <th className="text-left font-medium px-2 py-1">Group</th>
              <th className="text-right font-medium px-2 py-1">Bk</th>
              <th className="text-right font-medium px-2 py-1">Nights</th>
              <th className="text-right font-medium px-2 py-1">Revenue</th>
              <th className="text-right font-medium px-2 py-1">ADR</th>
              <th className="text-right font-medium px-2 py-1">vs goal</th>
              <th className="text-right font-medium px-2 py-1">Impact</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className={`border-t ${r.adr < target ? "bg-red-50/60 dark:bg-red-950/20" : ""}`}>
                <td className="px-2 py-1 max-w-[140px] truncate">{formatLabel ? formatLabel(r.label) : r.label}</td>
                <td className="px-2 py-1 text-right tabular-nums">{r.bookings}</td>
                <td className="px-2 py-1 text-right tabular-nums">{r.roomNights}</td>
                <td className="px-2 py-1 text-right tabular-nums">{eur(Math.round(r.revenue))}</td>
                <td className="px-2 py-1 text-right tabular-nums font-medium">{eur(Math.round(r.adr))}</td>
                <td className={`px-2 py-1 text-right tabular-nums ${r.diff < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                  {r.diff >= 0 ? "+" : "−"}{eur(Math.round(Math.abs(r.diff)))}
                </td>
                <td className={`px-2 py-1 text-right tabular-nums ${r.impact < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                  {r.impact >= 0 ? "+" : "−"}{eur(Math.round(Math.abs(r.impact)))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
