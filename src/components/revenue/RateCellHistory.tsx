import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatWhen } from "@/lib/rateAudit";
import type { RateAuditRow } from "@/lib/rateAudit";
import { groupCellChanges, type LogicalChange } from "@/lib/rateChangeGroups";
import { moneyBase } from "@/lib/revenueCurrency";
import type { AutomationAction } from "@/hooks/usePickupAutomationActions";

function automationDetail(a: AutomationAction): string {
  if (a.reason_detail) {
    return [a.reason_detail, a.reservation_id ? `booking #${a.reservation_id}` : null, a.pickup_at ? `picked up ${formatWhen(a.pickup_at)}` : null].filter(Boolean).join(" · ");
  }
  return [
    a.reservation_id ? `Triggered by booking #${a.reservation_id}` : "Triggered by a new booking",
    a.pickup_at ? `picked up ${formatWhen(a.pickup_at)}` : null,
    a.pickup_sequence && a.pickup_sequence > 1 ? `${a.pickup_sequence}${a.pickup_sequence === 2 ? "nd" : a.pickup_sequence === 3 ? "rd" : "th"} booking in the window` : null,
    a.increase_amount != null ? `rule raised it by ${moneyBase(a.increase_amount)}` : null,
  ].filter(Boolean).join(" · ");
}

function dayBucket(at: string): string {
  const d = new Date(at);
  const today = new Date();
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return "Today";
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (same(d, yesterday)) return "Yesterday";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function statusLine(entries: LogicalChange[], draftPrice?: number | null, sendingPrice?: number | null): { text: string; tone: string } {
  const latest = entries[0];
  const live = latest?.next ?? null;
  const now = live != null ? `${moneyBase(live)} now` : "No price recorded yet";
  if (draftPrice != null) return { text: `${now} · ${moneyBase(draftPrice)} waiting to be sent`, tone: "text-amber-600 dark:text-amber-400" };
  if (sendingPrice != null) return { text: `${now} · ${moneyBase(sendingPrice)} sent to Previo — confirming`, tone: "text-primary" };
  if (!latest) return { text: now, tone: "text-muted-foreground" };
  const who = latest.automation ? "automation" : latest.who;
  switch (latest.phase) {
    case "failed": return { text: `${now} · last change ${latest.statusLabel}`, tone: "text-destructive" };
    case "sending": return { text: `${now} · ${who} sent it — confirming in Previo`, tone: "text-primary" };
    case "confirmed": return { text: `${now} · confirmed in Previo · ${who}, ${formatWhen(latest.at)}`, tone: "text-muted-foreground" };
    default: return { text: `${now} · ${who} · ${latest.statusLabel}`, tone: "text-muted-foreground" };
  }
}

/**
 * PMS room names are identifiers elsewhere in the revenue grid, so we keep the
 * raw value for lookups and only clean it at the presentation edge. Previo can
 * occasionally send Czech fallback names even while HotelCare is in English.
 */
export function englishRoomTypeName(name: string): string {
  const exact: Record<string, string> = {
    "Deluxe Čtyřlůžkový Pokoj": "Deluxe Quadruple Room",
  };
  if (exact[name]) return exact[name];
  return name
    .replace(/Čtyřlůžkový Pokoj/gi, "Quadruple Room")
    .replace(/Třílůžkový Pokoj/gi, "Triple Room")
    .replace(/Dvoulůžkový Pokoj/gi, "Double Room")
    .replace(/Jednolůžkový Pokoj/gi, "Single Room");
}

type BookingNightHistoryRow = {
  res_id: string;
  room_key?: string | null;
  stay_date: string;
  room_type_name: string | null;
  guests: number | null;
  nightly_price_eur: number | null;
  total_price_eur: number | null;
  stay_from: string | null;
  stay_to: string | null;
  source_name: string | null;
  created_at_pms: string | null;
  status_id?: number | null;
  cancelled_at?: string | null;
};

type BookingHistoryItem = {
  key: string;
  resId: string;
  createdAt: string | null;
  cancelledAt: string | null;
  stayFrom: string;
  stayTo: string;
  guests: number;
  nightlyPrice: number | null;
  totalPrice: number | null;
  source: string | null;
  status: "confirmed" | "option" | "cancelled" | "no_show";
};

function bookingStatus(statusId: number | null | undefined, cancelled: boolean): BookingHistoryItem["status"] {
  if (statusId === 8) return "no_show";
  if (cancelled || statusId === 7) return "cancelled";
  if (statusId === 1) return "option";
  return "confirmed";
}

function bookingStatusLabel(status: BookingHistoryItem["status"]): string {
  if (status === "no_show") return "No-show";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function bookingStatusTone(status: BookingHistoryItem["status"]): string {
  if (status === "cancelled" || status === "no_show") return "bg-destructive/10 text-destructive";
  if (status === "option") return "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300";
  return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300";
}

function sourceLabel(source: string | null): string {
  if (!source) return "Unknown source";
  return source
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function bookingWhen(iso: string | null): string {
  if (!iso) return "time unavailable";
  return new Date(iso).toLocaleString(undefined, {
    timeZone: "Europe/Budapest",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildBookingItems(liveRows: BookingNightHistoryRow[], cancelledRows: BookingNightHistoryRow[]): BookingHistoryItem[] {
  const seen = new Map<string, BookingHistoryItem>();
  const add = (row: BookingNightHistoryRow, cancelled: boolean) => {
    const key = `${row.res_id}|${row.room_key ?? ""}`;
    const item: BookingHistoryItem = {
      key,
      resId: row.res_id,
      createdAt: row.created_at_pms,
      cancelledAt: cancelled ? row.cancelled_at ?? null : null,
      stayFrom: row.stay_from ?? row.stay_date,
      stayTo: row.stay_to ?? row.stay_date,
      guests: row.guests ?? 1,
      nightlyPrice: row.nightly_price_eur == null ? null : Number(row.nightly_price_eur),
      totalPrice: row.total_price_eur == null ? null : Number(row.total_price_eur),
      source: row.source_name,
      status: bookingStatus(row.status_id, cancelled),
    };
    const existing = seen.get(key);
    // A cancellation is the latest truth when both mirrors temporarily contain
    // the same reservation-room during a PMS sync.
    if (!existing || cancelled) seen.set(key, item);
  };
  liveRows.forEach((r) => add(r, false));
  cancelledRows.forEach((r) => add(r, true));
  return Array.from(seen.values()).sort((a, b) => {
    const aAt = a.createdAt ?? a.cancelledAt ?? "";
    const bAt = b.createdAt ?? b.cancelledAt ?? "";
    return bAt.localeCompare(aAt);
  });
}

function BookingHistory({ history, automation }: { history: RateAuditRow[]; automation: AutomationAction[] }) {
  const [items, setItems] = useState<BookingHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const context = useMemo(() => {
    const audit = history.find((r) => !!r.stay_date && !!r.payload?.room_type_name);
    if (audit?.stay_date && audit.payload?.room_type_name) {
      return {
        date: audit.stay_date,
        roomTypeName: audit.payload.room_type_name,
        auditId: audit.id,
        automationId: null as string | null,
      };
    }
    const action = automation.find((a) => !!a.stay_date && !!a.room_type_name);
    return action?.room_type_name ? {
      date: action.stay_date,
      roomTypeName: action.room_type_name,
      auditId: null as string | null,
      automationId: action.id,
    } : null;
  }, [history, automation]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!context) {
        setItems([]);
        setLoading(false);
        setError("Booking history could not be matched to this rate cell yet.");
        return;
      }
      setLoading(true);
      setError(null);
      try {
        let hotelId: string | null = null;
        if (context.auditId) {
          const { data, error: idError } = await supabase
            .from("rate_change_audit")
            .select("hotel_id")
            .eq("id", context.auditId)
            .maybeSingle();
          if (idError) throw idError;
          hotelId = (data as { hotel_id?: string | null } | null)?.hotel_id ?? null;
        } else if (context.automationId) {
          const { data, error: idError } = await supabase
            .from("revenue_pickup_automation_actions")
            .select("hotel_id")
            .eq("id", context.automationId)
            .maybeSingle();
          if (idError) throw idError;
          hotelId = (data as { hotel_id?: string | null } | null)?.hotel_id ?? null;
        }
        if (!hotelId) throw new Error("Hotel could not be resolved for this rate cell.");

        const select = "res_id, room_key, stay_date, room_type_name, guests, nightly_price_eur, total_price_eur, stay_from, stay_to, source_name, created_at_pms, status_id";
        const [live, gone] = await Promise.all([
          supabase
            .from("revenue_booking_nights")
            .select(select)
            .eq("hotel_id", hotelId)
            .eq("stay_date", context.date)
            .eq("room_type_name", context.roomTypeName)
            .order("created_at_pms", { ascending: false })
            .limit(100),
          supabase
            .from("revenue_cancelled_nights")
            .select(`${select}, cancelled_at`)
            .eq("hotel_id", hotelId)
            .eq("stay_date", context.date)
            .eq("room_type_name", context.roomTypeName)
            .order("cancelled_at", { ascending: false })
            .limit(100),
        ]);
        if (live.error) throw live.error;
        if (gone.error) throw gone.error;
        if (cancelled) return;
        setItems(buildBookingItems(
          (live.data ?? []) as unknown as BookingNightHistoryRow[],
          (gone.data ?? []) as unknown as BookingNightHistoryRow[],
        ));
      } catch (e) {
        if (cancelled) return;
        setItems([]);
        setError((e as Error).message || "Booking history could not be loaded.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => { cancelled = true; };
  }, [context, reloadKey]);

  if (loading) {
    return <div className="rounded-md border px-3 py-4 text-xs text-muted-foreground">Loading bookings for this room type and stay date…</div>;
  }
  if (error) {
    return (
      <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-3 text-xs">
        <p className="text-destructive">{error}</p>
        <button type="button" className="text-primary underline underline-offset-2" onClick={() => setReloadKey((v) => v + 1)}>Try again</button>
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="rounded-md border px-3 py-4 text-xs text-muted-foreground">
        No bookings were recorded for this room type on this stay date.
      </div>
    );
  }

  const active = items.filter((b) => b.status !== "cancelled" && b.status !== "no_show").length;
  return (
    <div className="space-y-2">
      <div className="rounded-md border bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
        <strong className="text-foreground">{items.length}</strong> booking record{items.length === 1 ? "" : "s"} touched this room type on this date · {active} currently active.
      </div>
      {items.map((b) => (
        <div key={b.key} className="space-y-1 rounded-md border px-3 py-2.5 text-xs">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-semibold">Booking #{b.resId}</p>
              <p className="text-[11px] text-muted-foreground">Booked {bookingWhen(b.createdAt)} · {sourceLabel(b.source)}</p>
            </div>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${bookingStatusTone(b.status)}`}>{bookingStatusLabel(b.status)}</span>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Stay {b.stayFrom} → {b.stayTo} · {b.guests} guest{b.guests === 1 ? "" : "s"}
          </p>
          <p className="text-[11px]">
            Sold at <strong className="tabular-nums">{moneyBase(b.nightlyPrice)}</strong> / night
            {b.totalPrice != null ? <span className="text-muted-foreground"> · booking total {moneyBase(b.totalPrice)}</span> : null}
          </p>
          {b.cancelledAt ? <p className="text-[11px] text-destructive">Cancelled {bookingWhen(b.cancelledAt)}</p> : null}
        </div>
      ))}
    </div>
  );
}

export default function RateCellHistory({ history, names, draftPrice, sendingPrice, automation = [], hold = null, expanded = false }: {
  history: RateAuditRow[];
  names: Map<string, string>;
  draftPrice?: number | null;
  sendingPrice?: number | null;
  automation?: AutomationAction[];
  hold?: AutomationAction | null;
  expanded?: boolean;
}) {
  const [showAll, setShowAll] = useState(expanded);
  const [tab, setTab] = useState<"price" | "bookings">("price");
  const rootRef = useRef<HTMLDivElement>(null);
  const entries = groupCellChanges(history, automation, names, { automationDetail });
  const status = statusLine(entries, draftPrice, sendingPrice);

  const cellRoomType = history.find((r) => r.payload?.room_type_name)?.payload?.room_type_name
    ?? automation.find((a) => a.room_type_name)?.room_type_name
    ?? null;

  // The parent grid deliberately keeps the raw PMS room name for price keys.
  // Its mobile sheet title used that identifier as display text as well. Correct
  // only the visible heading here so lookups remain untouched.
  useEffect(() => {
    if (!expanded || !cellRoomType) return;
    const english = englishRoomTypeName(cellRoomType);
    if (english === cellRoomType) return;
    const dialog = rootRef.current?.closest('[role="dialog"]');
    if (!dialog) return;
    const title = Array.from(dialog.querySelectorAll<HTMLElement>("h1,h2,h3,[role='heading']"))
      .find((node) => node.textContent?.includes(cellRoomType));
    if (!title?.textContent) return;
    const original = title.textContent;
    title.textContent = original.replace(cellRoomType, english);
    return () => {
      if (title.isConnected && title.textContent?.includes(english)) title.textContent = original;
    };
  }, [expanded, cellRoomType]);

  // Previo is the authoritative live source. A successful read-back that differs
  // from HotelCare's request is synchronization history, not an alarm. The live
  // price is adopted by reconciliation; the next automation run can then repair
  // a bad ladder/floor/ceiling from that real PMS baseline.
  const latestPrevioDifference = [...(history ?? [])]
    .filter((row) => row.source === "previo_different")
    .sort((a, b) => b.performed_at.localeCompare(a.performed_at))[0] ?? null;
  const latestConfirmed = entries.find((entry) => entry.phase === "confirmed") ?? null;
  const differenceAlreadySuperseded = !!latestPrevioDifference && !!latestConfirmed
    && Date.parse(latestConfirmed.at) > Date.parse(latestPrevioDifference.performed_at);
  const authoritativeSyncNote = latestPrevioDifference && !latestPrevioDifference.payload?.resolved_at && !differenceAlreadySuperseded ? (
    <div className="rounded-md border border-sky-200 bg-sky-50/60 px-2.5 py-2 text-[11px] text-slate-700 dark:border-sky-500/20 dark:bg-sky-500/5 dark:text-slate-300">
      <span className="font-medium">Synced from Previo.</span>{" "}
      Previo returned the live rate, so HotelCare is adopting it as the current price. Automation will evaluate this confirmed PMS price on its next run and auto-heal the pricing ladder if required.
    </div>
  ) : null;

  const holdNote = hold && hold.hold_until && Date.parse(hold.hold_until) > Date.now() ? (
    <div className="rounded-md border border-amber-300/60 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300">
      <span className="font-medium">Waiting after a cancellation.</span>{" "}{hold.reason_detail ?? "The rule waits before lowering the price in case the room sells again."}{" "}
      Automation can lower this price from <span className="tabular-nums font-medium">{formatWhen(hold.hold_until)}</span>.
    </div>
  ) : null;

  const block = (e: LogicalChange) => {
    const delta = e.old != null && e.next != null ? Math.round((e.next - e.old) * 100) / 100 : null;
    const pct = e.old && e.next != null && e.old !== 0 ? Math.round(((e.next - e.old) / e.old) * 1000) / 10 : null;
    const up = (delta ?? 0) >= 0;
    const failed = e.phase === "failed";
    return <div key={e.id} className="space-y-0.5 border-l-2 pl-2 border-border">
      <div className="flex flex-wrap items-baseline gap-x-1.5 text-xs tabular-nums"><span>{moneyBase(e.old)} → <strong>{moneyBase(e.next)}</strong></span>{delta != null && delta !== 0 && <span className={up ? "text-emerald-600 dark:text-emerald-400" : "text-sky-600 dark:text-sky-400"}>{up ? "+" : "−"}{moneyBase(Math.abs(delta))}{pct != null ? ` (${pct > 0 ? "+" : ""}${pct}%)` : ""}</span>}</div>
      <p className="text-[11px] text-muted-foreground"><span className={e.automation ? "text-purple-600 dark:text-purple-400 font-medium" : "text-sky-600 dark:text-sky-400 font-medium"}>{e.who}</span>{" · "}{formatWhen(e.at)} · <span className={failed ? "text-destructive" : ""}>{e.statusLabel}</span></p>
      {e.detail && <p className="text-[11px] text-muted-foreground">{e.detail}</p>}
      {e.extra && <p className="text-[11px] text-muted-foreground">Requested {moneyBase(e.extra.requested)} · Previo live {moneyBase(e.extra.actual)}{e.extra.requested !== e.extra.actual ? " · adopted as authoritative PMS price" : ""}</p>}
    </div>;
  };

  const limit = expanded ? entries.length : (showAll ? entries.length : 3);
  const shown = entries.slice(0, limit);
  const rest = entries.length - shown.length;
  let lastBucket: string | null = null;

  const priceHistory = entries.length === 0 ? (
    <div className="space-y-1">
      <p className={`text-[11px] ${status.tone}`}>{status.text}</p>
      {authoritativeSyncNote}{holdNote}
      <p className="text-[11px] text-muted-foreground">No price changes recorded for this room type and date yet.</p>
    </div>
  ) : (
    <div className="space-y-2">
      <p className={`text-xs font-medium ${status.tone}`}>{status.text}</p>
      {authoritativeSyncNote}{holdNote}
      <div className="space-y-2">{shown.map((e) => { const bucket = dayBucket(e.at); const heading = bucket !== lastBucket ? bucket : null; lastBucket = bucket; return <div key={e.id} className="space-y-1">{heading && <p className="text-[10px] uppercase tracking-wide text-muted-foreground/70">{heading}</p>}{block(e)}</div>; })}</div>
      {!expanded && rest > 0 && <button type="button" className="text-[11px] text-primary underline underline-offset-2" onClick={(ev) => { ev.stopPropagation(); setShowAll((v) => !v); }}>{showAll ? "Show less" : `${rest} more change${rest === 1 ? "" : "s"}`}</button>}
    </div>
  );

  if (!expanded) return <div ref={rootRef}>{priceHistory}</div>;

  return (
    <div ref={rootRef} className="space-y-3">
      <div className="grid grid-cols-2 rounded-md border bg-muted/20 p-1">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setTab("price"); }}
          className={`rounded px-2 py-1.5 text-xs font-medium transition-colors ${tab === "price" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}
        >
          Price history
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setTab("bookings"); }}
          className={`rounded px-2 py-1.5 text-xs font-medium transition-colors ${tab === "bookings" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}
        >
          Booking history
        </button>
      </div>
      {tab === "price"
        ? priceHistory
        : <BookingHistory history={history} automation={automation} />}
    </div>
  );
}
