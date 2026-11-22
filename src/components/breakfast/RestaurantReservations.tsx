import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw, Users, Clock, Phone, Gift, MessageSquare, Check, UserX, CloudOff, CloudUpload, BellRing, BellOff } from "lucide-react";
import { toast } from "sonner";
import { bbT } from "@/lib/breakfast-translations";
import { serviceWorkerManager } from "@/lib/serviceWorkerManager";
import CreateBrunchReservation from "./CreateBrunchReservation";

interface Props {
  hotelId: string;
  date: string;
  language: string;
  onDateChange?: (date: string) => void;
}

interface Reservation {
  id: string;
  guest_name: string;
  guest_phone: string | null;
  created_at: string;
  booked_at?: string | null;
  first_seen_at?: string | null;
  source_project?: string | null;
  booking_mode?: string | null;
  party_size: number;
  starts_at: string;
  ends_at: string | null;
  status: string;
  occasion: string | null;
  special_requests: string | null;
  notes: string | null;
  dashboard_sync_state?: string | null;
  status_marked_at?: string | null;
  status_marked_by?: string | null;
}

type FeedStatus = "dashboard" | "webhook" | "unavailable" | "unconfigured" | "unknown";

interface LoadResult {
  ok: boolean;
  feedStatus: FeedStatus;
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { timeZone: "Europe/Budapest", hour: "2-digit", minute: "2-digit" });
}


function bookingLink(hotelId: string, date: string, id: string): string {
  const url = new URL(window.location.href);
  url.searchParams.set("bbTab", "reservations");
  url.searchParams.set("bbDate", date);
  url.searchParams.set("bbHotel", hotelId);
  url.searchParams.set("bbReservation", id);
  return url.toString();
}
function bookedLabel(iso: string, language: string): string {
  return new Date(iso).toLocaleString(language === "hu" ? "hu-HU" : "en-GB", {
    timeZone: "Europe/Budapest", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}
function alertKey(id: string) { return "bb_reservation_alerts_" + id; }

export default function RestaurantReservations({ hotelId, date, language, onDateChange }: Props) {
  const tt = (k: string, vars?: Record<string, string | number>) => bbT(language, k, vars);
  const [rows, setRows] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(false);
  const [covers, setCovers] = useState(0);
  const [count, setCount] = useState(0);
  const [saving, setSaving] = useState<string | null>(null);
  const [feedStatus, setFeedStatus] = useState<FeedStatus>("unknown");
  const [accessError, setAccessError] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [alertsEnabled, setAlertsEnabled] = useState(() => {
    try { return localStorage.getItem(alertKey(hotelId)) === "on"; } catch { return false; }
  });
  const alertsRef = useRef(alertsEnabled);
  const knownRef = useRef<Set<string> | null>(null);
  const notifiedRef = useRef(new Set<string>());
  const focusedRef = useRef<string | null>(null);
  const audioRef = useRef<AudioContext | null>(null);

  useEffect(() => { alertsRef.current = alertsEnabled; }, [alertsEnabled]);
  useEffect(() => {
    knownRef.current = null;
    focusedRef.current = null;
    setHighlighted(null);
    try { setAlertsEnabled(localStorage.getItem(alertKey(hotelId)) === "on"); } catch { setAlertsEnabled(false); }
  }, [hotelId, date]);

  // Persisted alert preferences survive a reload, but mobile Safari requires
  // audio to be unlocked again by a fresh interaction on that page.
  useEffect(() => {
    const unlock = () => {
      if (!alertsRef.current) return;
      try {
        if (!audioRef.current && window.AudioContext) audioRef.current = new AudioContext();
        if (audioRef.current?.state === "suspended") void audioRef.current.resume();
      } catch {}
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  const notifyNew = useCallback((r: Reservation) => {
    if (!alertsRef.current || notifiedRef.current.has(r.id)) return;
    notifiedRef.current.add(r.id);
    try {
      const ctx = audioRef.current;
      if (ctx) {
        if (ctx.state === "suspended") void ctx.resume();
        [660, 880].forEach((hz, i) => {
          const osc = ctx.createOscillator(); const gain = ctx.createGain();
          const t = ctx.currentTime + i * 0.16;
          osc.frequency.value = hz;
          gain.gain.setValueAtTime(0.0001, t);
          gain.gain.exponentialRampToValueAtTime(0.13, t + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
          osc.connect(gain).connect(ctx.destination);
          osc.start(t); osc.stop(t + 0.15);
        });
      }
    } catch { /* Some devices block audio. */ }
    const url = bookingLink(hotelId, date, r.id);
    const title = bbT(language, "resNewAlert");
    // Keep guest names inside the signed-in app, not on shared-device lock screens.
    const publicBody = r.party_size + " " + bbT(language, "resGuests") + " · " + timeLabel(r.starts_at);
    toast.info(title, {
      description: r.guest_name + " · " + publicBody, duration: 12000,
      action: { label: bbT(language, "resView"), onClick: () => window.location.assign(url) },
    });
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      void serviceWorkerManager.register().then(reg => {
        if (reg) return reg.showNotification(title, { body: publicBody, tag: "bb-" + r.id, icon: "/favicon.ico", data: { url } });
        const n = new Notification(title, { body: publicBody, tag: "bb-" + r.id });
        n.onclick = () => { window.focus(); window.location.assign(url); };
      }).catch(error => console.warn("BB browser alert unavailable", error));
    }
  }, [hotelId, date, language]);

  const enableAlerts = async () => {
    if (alertsEnabled) {
      setAlertsEnabled(false);
      try { localStorage.setItem(alertKey(hotelId), "off"); } catch {}
      toast.info(tt("resAlertsOff"));
      return;
    }
    // A direct click unlocks the sound on browsers requiring a user gesture.
    try {
      if (!audioRef.current && window.AudioContext) audioRef.current = new AudioContext();
      if (audioRef.current?.state === "suspended") void audioRef.current.resume();
    } catch {}
    setAlertsEnabled(true);
    try { localStorage.setItem(alertKey(hotelId), "on"); } catch {}
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      try { await Notification.requestPermission(); } catch {}
    }
    toast.success(tt("resAlertsOn"));
  };

  const markSeen = useCallback(async (r: Reservation) => {
    if (r.first_seen_at) return;
    setRows(current => current.map(item => item.id === r.id ? { ...item, first_seen_at: new Date().toISOString() } : item));
    const { data, error } = await supabase.functions.invoke("restaurant-reservation-seen", {
      body: { reservation_id: r.id },
    });
    if (error || data?.error) {
      setRows(current => current.map(item => item.id === r.id ? { ...item, first_seen_at: null } : item));
      toast.error(bbT(language, "resSeenFailed"));
    } else if (data?.first_seen_at) {
      setRows(current => current.map(item => item.id === r.id ? { ...item, first_seen_at: data.first_seen_at } : item));
    }
  }, [language]);


  const load = useCallback(async (force = false): Promise<LoadResult> => {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("restaurant-reservations-list", {
      body: { hotel_id: hotelId, date, force },
    });
    setLoading(false);

    if (error || !data || data?.error) {
      const status = (error as any)?.context?.status;
      setAccessError(status === 401
        ? "Your staff sign-in has expired. Sign out and sign in again."
        : status === 403
          ? "You are not assigned to this hotel's restaurant reservations."
          : null);
      setRows([]);
      setCovers(0);
      setCount(0);
      setFeedStatus("unavailable");
      return { ok: false, feedStatus: "unavailable" };
    }

    setAccessError(null);
    const nextFeedStatus = (["dashboard", "webhook", "unavailable", "unconfigured"] as const)
      .includes(data.feed_status)
      ? data.feed_status as FeedStatus
      : data.sync_error
        ? "unavailable"
        : "unknown";

    const incoming = (data.reservations ?? []) as Reservation[];
    const previouslyKnown = knownRef.current;
    if (previouslyKnown) {
      for (const r of incoming) {
        const recent = Date.now() - new Date(r.created_at).getTime() < 10 * 60_000;
        if (!previouslyKnown.has(r.id) && !r.first_seen_at && r.status === "booked" && recent) notifyNew(r);
      }
    }
    knownRef.current = new Set(incoming.map(r => r.id));
    setRows(incoming);
    setCovers(data.total_covers ?? 0);
    setCount(data.total_reservations ?? 0);
    setFeedStatus(nextFeedStatus);
    return { ok: true, feedStatus: nextFeedStatus };
  }, [hotelId, date, notifyNew]);

  useEffect(() => { void load(); }, [load]);

  // Bookings arrive during service — keep the list fresh without a reload.
  useEffect(() => {
    const id = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 15_000);
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVisible); };
  }, [load]);

  const refresh = async () => {
    const result = await load(true);
    if (!result.ok || result.feedStatus === "unavailable" || result.feedStatus === "unconfigured") {
      toast.warning(tt("resSyncPending"));
    } else {
      toast.success(tt("resSynced"));
    }
  };

  const mark = async (reservation: Reservation, next: "seated" | "no_show") => {
    // Tapping the active status again clears it back to booked.
    const target = reservation.status === next ? "booked" : next;
    const correction = reservation.status !== "booked";
    if (correction || target === "no_show") {
      const message = language === "hu"
        ? `Megerősíti a foglalás állapotának módosítását? (${reservation.guest_name}: ${reservation.status} → ${target})`
        : `Confirm reservation status change for ${reservation.guest_name}: ${reservation.status} → ${target}?`;
      if (!window.confirm(message)) return;
    }
    const previous = rows;
    setSaving(reservation.id);
    setRows((rs) => rs.map((r) => (r.id === reservation.id ? { ...r, status: target, dashboard_sync_state: "pending" } : r)));

    const { data, error } = await supabase.functions.invoke("restaurant-reservation-status", {
      body: { reservation_id: reservation.id, status: target, confirm_correction: correction },
    });
    setSaving(null);

    if (error || data?.error) {
      setRows(previous);
      toast.error(tt("resStatusFailed"));
      // A concurrent staff edit may have won. Never leave the optimistic
      // status visible as if it were confirmed by the server.
      void load(true);
      return;
    }
    setRows((rs) => rs.map((r) => (r.id === reservation.id
      ? { ...r, status: data.status, status_marked_by: data.status_marked_by ?? r.status_marked_by, dashboard_sync_state: data.dashboard_sync_state }
      : r)));
    void markSeen(reservation);
    toast.success(tt("resStatusSaved"));
  };

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("bbReservation");
    if (!id || focusedRef.current === id) return;
    const match = rows.find(r => r.id === id);
    if (!match) return;
    focusedRef.current = id;
    setHighlighted(id);
    const raf = requestAnimationFrame(() => document.getElementById("bb-res-" + id)?.scrollIntoView({ behavior: "smooth", block: "center" }));
    void markSeen(match);
    const timer = setTimeout(() => setHighlighted(current => current === id ? null : current), 7000);
    return () => { cancelAnimationFrame(raf); clearTimeout(timer); };
  }, [rows, markSeen]);

  const created = (id: string, bookingDate: string) => {
    window.history.replaceState(window.history.state, "", bookingLink(hotelId, bookingDate, id));
    focusedRef.current = null;
    if (bookingDate !== date) onDateChange?.(bookingDate);
    else void load(true);
  };

  const active = rows.filter((r) => r.status !== "cancelled");
  const cancelled = rows.filter((r) => r.status === "cancelled");
  const arrivedCount = active.filter((r) => r.status === "seated").length;
  const noShowCount = active.filter((r) => r.status === "no_show").length;
  const feedUnavailable = feedStatus === "unavailable" || feedStatus === "unconfigured";
  const unseenCount = active.filter(r => !r.first_seen_at).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2"><div className="font-semibold text-sm">{tt("resTitle")}</div>{unseenCount > 0 && <Badge variant="secondary" className="text-[10px]">{unseenCount} {tt("resNew")}</Badge>}</div>
          <div className="text-[11px] text-muted-foreground">
            {tt("resSummary", { n: count, covers })}
            {(arrivedCount > 0 || noShowCount > 0) && (
              <> · {tt("resSummaryStatus", { arrived: arrivedCount, noshow: noShowCount })}</>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5"><Button type="button" variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => void enableAlerts()} title={tt(alertsEnabled ? "resAlertsOn" : "resEnableAlerts")}>
          {alertsEnabled ? <BellRing className="h-4 w-4 text-emerald-600" /> : <BellOff className="h-4 w-4" />}
          <span className="hidden sm:inline">{tt(alertsEnabled ? "resAlertsEnabled" : "resEnableAlerts")}</span>
        </Button>{!accessError && <CreateBrunchReservation hotelId={hotelId} date={date} language={language} onCreated={created} />}<Button variant="ghost" size="sm" className="h-9 w-9 p-0" onClick={() => void refresh()} disabled={loading} aria-label={tt("syncNow")}>
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
        </Button></div>
      </div>

      {accessError && !loading && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
          <AlertTriangle className="mr-2 inline h-4 w-4" />{accessError}
        </div>
      )}

      {feedUnavailable && !loading && !accessError && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/80 p-3 text-amber-950">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              <div className="text-sm font-semibold">{tt("resSyncPending")}</div>
              <div className="text-xs mt-0.5 text-amber-900/80">{tt("notFoundHint")}</div>
            </div>
          </div>
        </div>
      )}

      {active.length === 0 && !loading && !feedUnavailable && !accessError && (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          {tt("resEmpty")}
        </div>
      )}

      <div className="space-y-2">
        {active.map((r) => {
          const dim = r.status === "no_show";
          const unseen = !r.first_seen_at;
          return (
            <div
              key={r.id}
              id={"bb-res-" + r.id}
              style={{ scrollMarginTop: "96px" }}
              className={`rounded-lg border p-3 transition-all duration-300 ${highlighted === r.id ? "ring-4 ring-sky-400 ring-offset-2 border-sky-400 bg-sky-50" : unseen ? "border-sky-300 bg-sky-50/50" : r.status === "seated" ? "border-emerald-300 bg-emerald-50/60" : "bg-card"} ${dim ? "opacity-60" : ""}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {timeLabel(r.starts_at)}{r.ends_at ? ` – ${timeLabel(r.ends_at)}` : ""}
                    {unseen && <Badge className="ml-1 bg-sky-600 text-[10px]">{tt("resNew")}</Badge>}
                  </div>
                  <button type="button" className="block text-left text-lg font-bold leading-tight break-words hover:underline" onClick={() => { setHighlighted(r.id); void markSeen(r); }}>{r.guest_name}</button>
                  {r.guest_phone && (
                    <a href={`tel:${r.guest_phone}`} className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                      <Phone className="h-3 w-3" /> {r.guest_phone}
                    </a>
                  )}
                  <div className="text-[10px] text-muted-foreground mt-1">{tt(r.booked_at ? "resBookedAt" : "resReceivedAt")} {bookedLabel(r.booked_at || r.created_at, language)}{r.source_project === "manual" ? " · " + tt("resManual") : ""}</div>
                  {r.booking_mode && (
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {tt("resBookingMode")}: {({
                        phone: tt("resModePhone"), walk_in: tt("resModeWalkIn"),
                        hotel_guest: tt("resModeHotelGuest"), other: tt("resModeOther"),
                      } as Record<string, string>)[r.booking_mode] || tt("resModeOther")}
                    </div>
                  )}
                </div>
                <div className="shrink-0 flex flex-col items-end gap-1">
                  <div className="flex items-center gap-1 rounded-md bg-primary/10 text-primary px-2.5 py-1.5">
                    <Users className="h-4 w-4" />
                    <span className="text-xl font-bold leading-none">{r.party_size}</span>
                  </div>
                  <span className="text-[10px] text-muted-foreground">{tt("resGuests")}</span>
                  {r.status === "seated" && <Badge className="bg-emerald-600 text-[10px]">{tt("resSeated")}</Badge>}
                  {r.status === "no_show" && <Badge variant="secondary" className="text-[10px]">{tt("resNoShow")}</Badge>}
                  {r.status_marked_by && r.status !== "booked" && <span className="max-w-[140px] truncate text-[10px] text-muted-foreground" title={r.status_marked_by}>{r.status_marked_by}</span>}
                </div>
              </div>
              {(r.occasion || r.special_requests || r.notes) && (
                <div className="mt-2 pt-2 border-t space-y-1 text-xs">
                  {r.occasion && (
                    <div className="flex items-start gap-1.5"><Gift className="h-3 w-3 mt-0.5 shrink-0" />{r.occasion}</div>
                  )}
                  {(r.special_requests || r.notes) && (
                    <div className="flex items-start gap-1.5">
                      <MessageSquare className="h-3 w-3 mt-0.5 shrink-0" />
                      <span className="whitespace-pre-wrap">{[r.special_requests, r.notes].filter(Boolean).join(" · ")}</span>
                    </div>
                  )}
                </div>
              )}

              {unseen && <button type="button" className="mt-2 text-xs text-sky-700 font-medium hover:underline" onClick={() => { setHighlighted(r.id); void markSeen(r); }}>{tt("resMarkSeen")}</button>}
              <div className="mt-2 pt-2 border-t flex items-center gap-2">
                <Button
                  size="sm"
                  variant={r.status === "seated" ? "default" : "outline"}
                  className={`h-9 flex-1 gap-1.5 ${r.status === "seated" ? "bg-emerald-600 hover:bg-emerald-700" : ""}`}
                  disabled={saving === r.id || !["booked", "seated", "no_show"].includes(r.status)}
                  onClick={() => void mark(r, "seated")}
                >
                  <Check className="h-4 w-4" />
                  {r.status === "seated" ? tt("resUndo") : tt("resArrived")}
                </Button>
                <Button
                  size="sm"
                  variant={r.status === "no_show" ? "destructive" : "outline"}
                  className="h-9 flex-1 gap-1.5"
                  disabled={saving === r.id || !["booked", "seated", "no_show"].includes(r.status)}
                  onClick={() => void mark(r, "no_show")}
                >
                  <UserX className="h-4 w-4" />
                  {r.status === "no_show" ? tt("resUndo") : tt("resMarkNoShow")}
                </Button>
              </div>

              {r.status !== "booked" && r.dashboard_sync_state !== "local" && (
                <div className="mt-1.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                  {r.dashboard_sync_state === "synced" ? (
                    <><CloudUpload className="h-3 w-3" /> {tt("resSynced")}</>
                  ) : (
                    <><CloudOff className="h-3 w-3" /> {tt("resSyncPending")}</>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {cancelled.length > 0 && (
        <div className="pt-2 border-t space-y-1">
          <div className="text-[11px] text-muted-foreground">{tt("resCancelled")}</div>
          {cancelled.map((r) => (
            <div key={r.id} className="text-xs text-muted-foreground line-through flex items-center gap-2">
              <span>{timeLabel(r.starts_at)}</span>
              <span className="font-medium">{r.guest_name}</span>
              <span>· {r.party_size}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
