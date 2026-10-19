// LiveSync — silently pulls live PMS / Revenue data from Previo whenever an
// eligible user (manager / admin / top_management) is logged in. Other roles
// (housekeeping, maintenance, reception) are completely opted out.
//
// Each task tracks its own status and is exposed to the rest of the app via
// the LiveSyncIndicator pill in the header and per-feature banners.

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import type { PmsSyncStatus } from "@/lib/pmsRefresh";
import { runQueuedPmsRefresh, summarizeQueuedPmsJobs } from "@/lib/pmsRefreshQueue";
import { selectActivePmsQueueGroup, type PmsQueueRow } from "@/lib/pmsQueueMonitor";
import { PmsChangesDrawer } from "@/components/pms/PmsChangesDrawer";
import { resolveHotelKeys } from "@/lib/hotelKeys";
import { startOfBudapestDayUtc, todayBudapest } from "@/lib/budapestTime";
import {
  canReceiveHousekeepingOperationalNotifications,
  isExecutiveRole,
} from "@/lib/notificationAudience";

export type TaskName = "pms" | "revenue" | "checkouts" | "pms_changes";

export interface TaskState {
  status: PmsSyncStatus | "syncing" | "queued";
  lastAt: Date | null;
  message?: string;
  meta?: Record<string, any>;
}

export interface RefreshOutcome {
  ran: boolean;
  status: PmsSyncStatus | "syncing" | "skipped" | "error" | "queued";
  message?: string;
  meta?: Record<string, any>;
}

interface LiveSyncContextValue {
  enabled: boolean;
  hotelId: string | null;
  tasks: Record<TaskName, TaskState>;
  refresh: (task?: TaskName) => Promise<RefreshOutcome | void>;
  openChangesDrawer: () => void;
}

// Keep in sync with MANAGER_ROLES in components/dashboard/PmsRefreshButton.tsx —
// anyone who can see the PMS refresh control must also get a live sync context,
// otherwise the button reports "PMS not connected" on a perfectly wired hotel.
const ELIGIBLE_ROLES = new Set([
  "admin",
  "top_management",
  "top_management_manager",
  "manager",
  "housekeeping_manager",
  "reception_manager",
  "front_office",
]);

const THROTTLE_MS = 2 * 60 * 1000; // 2 min
const CHECKOUTS_ACTIVE_INTERVAL_MS = 5 * 60 * 1000; // 5 min while pending checkouts remain
const CHECKOUTS_IDLE_INTERVAL_MS = 30 * 60 * 1000; // 30 min once all RTC (safety net)

const initialTask: TaskState = { status: "idle", lastAt: null };

const LiveSyncContext = createContext<LiveSyncContextValue>({
  enabled: false,
  hotelId: null,
  tasks: { pms: initialTask, revenue: initialTask, checkouts: initialTask, pms_changes: initialTask },
  refresh: async () => {},
  openChangesDrawer: () => {},
});

export function LiveSyncProvider({ children }: { children: React.ReactNode }) {
  const { profile, user } = useAuth();
  const [hotelId, setHotelId] = useState<string | null>(null);
  const [hasPrevio, setHasPrevio] = useState(false);
  const [tasks, setTasks] = useState<Record<TaskName, TaskState>>({
    pms: initialTask,
    revenue: initialTask,
    checkouts: initialTask,
    pms_changes: initialTask,
  });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [businessDate, setBusinessDate] = useState(() => todayBudapest());
  const lastRunRef = useRef<Record<TaskName, number>>({ pms: 0, revenue: 0, checkouts: 0, pms_changes: 0 });
  const observedQueueGroupRef = useRef<string | null>(null);
  const announcedQueueGroupRef = useRef<string | null>(null);

  // An open mobile/desktop tab must detect a new Budapest business day,
  // not wait until logout, login or a full page reload.
  useEffect(() => {
    const updateBusinessDate = () => setBusinessDate(todayBudapest());
    const timer = window.setInterval(updateBusinessDate, 30_000);
    window.addEventListener("focus", updateBusinessDate);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", updateBusinessDate);
    };
  }, []);

  const enabled = !!user && !!profile?.role && ELIGIBLE_ROLES.has(profile.role) && hasPrevio;
  const showHousekeepingOperationalNotifications = canReceiveHousekeepingOperationalNotifications(profile?.role);
  const executiveRole = isExecutiveRole(profile?.role);

  // Detect whether the user's hotel has an active Previo config.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!profile?.assigned_hotel || !profile.role || !ELIGIBLE_ROLES.has(profile.role)) {
        setHotelId(null);
        setHasPrevio(false);
        return;
      }
      // A profile's `assigned_hotel` may be a display name ("Hotel Ottofiori")
      // OR a slug/hotel_id ("ottofiori"). Try every alias so the RPC actually
      // matches the `pms_configurations.hotel_id` row.
      const keys = await resolveHotelKeys(profile.assigned_hotel).catch(() => [] as string[]);
      const candidates = keys.length ? keys : [profile.assigned_hotel];
      let resolvedKey: string = profile.assigned_hotel;
      let active = false;
      for (const key of candidates) {
        const { data, error } = await (supabase as any).rpc("hotel_has_active_previo", {
          _hotel_id: key,
        });
        if (!error && data === true) { active = true; resolvedKey = key; break; }
      }
      if (cancelled) return;
      setHotelId(resolvedKey);
      setHasPrevio(active);
    })();
    return () => {
      cancelled = true;
    };
  }, [profile?.assigned_hotel, profile?.role]);

  // Load most recent sync timestamp for visual continuity across reloads.
  useEffect(() => {
    if (!enabled || !hotelId) return;
    (async () => {
      const keys = await resolveHotelKeys(hotelId).catch(() => [hotelId]);
      const { data } = await supabase
        .from("pms_sync_history")
        .select("created_at, sync_status, data")
        .eq("sync_type", "rooms_refresh") // Full PMS refresh only; checkout polls are not full snapshots.
        .in("hotel_id", keys.length ? keys : [hotelId])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!data) return;
      setTasks((prev) => (prev.pms.status === "queued" || prev.pms.status === "syncing") ? prev : ({
        ...prev,
        pms: {
          status: ((data as any).sync_status as PmsSyncStatus) || "success",
          lastAt: new Date((data as any).created_at),
          meta: (data as any).data || {},
        },
      }));
    })();
  }, [enabled, hotelId]);

  // Follow manual queue jobs after the initial request returns, including
  // when a user reopens the page before all SLNT accounts have completed.
  useEffect(() => {
    if (!enabled || !hotelId || !user?.id) return;
    let cancelled = false;
    let inFlight = false;
    let activeJob = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // No reason to query every 3 seconds once a hotel's manual queue is idle.
    // Active jobs still report progress every 3 seconds; explicit refreshes
    // and tab resumption trigger an immediate reconciliation.
    const schedule = () => {
      if (cancelled || document.hidden) return;
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(() => { timer = undefined; void poll(); },
        activeJob ? 3_000 : 60_000);
    };
    const poll = async () => {
      if (cancelled || inFlight || document.hidden) return;
      inFlight = true;
      try {
        const { data, error } = await (supabase as any).from("pms_refresh_queue")
          .select("id,hotel_id,request_group_id,target_key,status,requested_at,started_at,finished_at,result,error_message")
          .eq("hotel_id",hotelId).eq("request_kind","manual")
          .eq("requested_by",user.id)
          .gte("requested_at",startOfBudapestDayUtc(businessDate))
          .order("requested_at",{ascending:false}).limit(60);
        if (error || cancelled) return;
        const group = selectActivePmsQueueGroup((data || []) as PmsQueueRow[],hotelId);
        if (!group.length) { activeJob = false; return; }
        const groupId = group[0].request_group_id || group[0].id;
        const summary = summarizeQueuedPmsJobs(group);
        const ongoing = summary.status === "queued" || summary.status === "syncing";
        activeJob = ongoing;
        const finishedAt = summary.finishedAt ? new Date(summary.finishedAt) : null;
        if (ongoing) observedQueueGroupRef.current = groupId;

        // Durable progress, including an actual running stage, is restored
        // after reload. No successful timestamp is set until all jobs finish.
        setTasks(prev => {
          const previous = prev.pms;
          if (previous.meta?.queueGroupId === groupId &&
              previous.status === summary.status &&
              previous.meta?.completedJobs === summary.completedJobs &&
              previous.meta?.runningJobs === summary.runningJobs &&
              previous.meta?.queuedJobs === summary.queuedJobs) return prev;
          return {...prev,pms:{
            status:summary.status,
            lastAt:ongoing ? previous.lastAt : finishedAt,
            message:summary.managerMessage,
            meta:{...summary,queueGroupId:groupId,
              jobIds:group.map(j=>j.id),requestedAt:group[0].requested_at},
          }};
        });
        if (ongoing || cancelled) return;

        // The completion must be reflected in the UI even if it happened
        // between polls or while the browser was in the background.
        // Notify once per user/hotel/group to avoid replaying old toasts.
        const storageKey = `pmsQueue.announced.${user.id}.${hotelId}`;
        const wasAnnounced = sessionStorage.getItem(storageKey) === groupId;
        if (announcedQueueGroupRef.current === groupId || wasAnnounced) return;
        announcedQueueGroupRef.current = groupId;
        sessionStorage.setItem(storageKey,groupId);
        const recent = !!finishedAt && Date.now() - finishedAt.getTime() < 10 * 60_000;
        if (!recent && observedQueueGroupRef.current !== groupId) return;
        const { toast } = await import("sonner");
        if (cancelled) return;
        if (summary.status === "error") toast.error("PMS refresh failed",{
          description:summary.managerMessage || "Please review PMS Sync History",
        });
        else if (summary.status === "partial") toast.warning("PMS refresh completed with warnings",{
          description:summary.partialReasons?.join(" | ") || "Review PMS Sync History",
          duration:10000,
        });
        else toast.success("Full PMS refresh completed",{
          description:summary.managerMessage,
        });
        window.dispatchEvent(new CustomEvent("pms-sync-completed"));
      } finally {
        inFlight = false;
        schedule();
      }
    };
    void poll();
    const queued = (event: Event) => {
      const groupId = (event as CustomEvent).detail?.groupId;
      if (typeof groupId === "string" && groupId) observedQueueGroupRef.current = groupId;
      activeJob = true;
      if (timer !== undefined) window.clearTimeout(timer);
      timer = undefined;
      void poll();
    };
    window.addEventListener("pms-manual-refresh-queued",queued);
    const visible = () => {
      if (document.hidden) {
        if (timer !== undefined) window.clearTimeout(timer);
        timer = undefined;
      } else void poll();
    };
    document.addEventListener("visibilitychange",visible);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange",visible);
      window.removeEventListener("pms-manual-refresh-queued",queued);
    };
  }, [enabled,hotelId,user?.id,businessDate]);

  const runPms = useCallback(async (force = false): Promise<RefreshOutcome> => {
    if (!enabled || !hotelId) {
      return { ran: false, status: "skipped", message: hotelId ? "PMS integration not configured for this hotel" : "No hotel context" };
    }
    const now = Date.now();
    if (!force && now - lastRunRef.current.pms < THROTTLE_MS) {
      return { ran: false, status: "skipped", message: "Throttled" };
    }
    lastRunRef.current.pms = now;
    // The browser is only submitting an enqueue RPC here, not running Previo.
    setTasks((p) => ({ ...p, pms: { ...p.pms, status: "queued",
      message: "Requesting a PMS queue slot…" } }));
    try {
      const r = await runQueuedPmsRefresh(hotelId);
      setTasks((p) => ({
        ...p,
        pms: { ...p.pms, status: r.status, message: r.managerMessage,
          // Enqueuing work is not completion. Only the queue's finished_at
          // timestamp is allowed to update the last successful sync time.
          lastAt: p.pms.lastAt, meta: { ...p.pms.meta, ...r } },
      }));
      return { ran: true, status: r.status, meta: r, message: r.managerMessage || r.errors?.[0] };
    } catch (e: any) {
      const message = e?.message || "PMS sync failed";
      setTasks((p) => ({
        ...p,
        // A rejected enqueue must not be recorded as a completed PMS refresh.
        pms: { ...p.pms, status: "error", lastAt: p.pms.lastAt, message },
      }));
      return { ran: true, status: "error", message };
    }
  }, [enabled, hotelId]);

  const runRevenue = useCallback(async (_force = false): Promise<RefreshOutcome> => ({
    ran: false,
    status: "skipped",
    message: "Open Revenue Management to run the coordinated property refresh",
  }), []);

  const runCheckouts = useCallback(async (force = false): Promise<number> => {
    if (!enabled || !hotelId) return 0;
    const now = Date.now();
    if (!force && now - lastRunRef.current.checkouts < CHECKOUTS_ACTIVE_INTERVAL_MS) {
      return (tasks.checkouts.meta as any)?.pendingCheckouts ?? 0;
    }
    lastRunRef.current.checkouts = now;
    setTasks((p) => ({ ...p, checkouts: { ...p.checkouts, status: "syncing" } }));
    let pendingCheckouts = 0;
    try {
      const { data, error } = await supabase.functions.invoke("previo-poll-checkouts", {
        body: { hotelId },
      });
      if (error) throw new Error(error.message || "Checkout poll failed");
      const payload = (data || {}) as any;
      if (payload.ok === false && payload.supported !== false) {
        throw new Error(payload.error || "Checkout poll failed");
      }
      const marked = Number(payload.marked || 0);

      // Count checkout rooms for today that are not yet RTC.
      try {
        const hotelKeys = await resolveHotelKeys(hotelId);
        const keys = hotelKeys.length ? hotelKeys : [hotelId];
        const { data: rows } = await (supabase as any)
          .from("rooms")
          .select("id, pms_metadata")
          .in("hotel", keys)
          .eq("is_checkout_room", true);
        pendingCheckouts = (rows ?? []).filter((r: any) => {
          const m = r.pms_metadata || {};
          return !(m.checkedOutToday === true || m.readyToClean === true);
        }).length;
      } catch { /* non-fatal */ }

      setTasks((p) => ({
        ...p,
        checkouts: {
          status: payload.errors?.length ? "partial" : "success",
          lastAt: new Date(),
          meta: { ...payload, pendingCheckouts },
        },
      }));

      // Checkout auto-release is a housekeeping workflow event. Keep the
      // underlying polling/data update active for every eligible manager, but
      // only notify the operational housekeeping managers who act on it.
      if (marked > 0 && showHousekeepingOperationalNotifications) {
        const { toast } = await import("sonner");
        toast.success(`${marked} checkout room${marked === 1 ? "" : "s"} auto-released — ready to clean.`);
      }
    } catch (e: any) {
      setTasks((p) => ({
        ...p,
        checkouts: { status: "error", lastAt: new Date(), message: e?.message || "Checkout poll failed" },
      }));
    }
    return pendingCheckouts;
  }, [enabled, hotelId, tasks.checkouts.meta, showHousekeepingOperationalNotifications]);

  const refresh = useCallback(
    async (task?: TaskName): Promise<RefreshOutcome | void> => {
      if (task === "pms") {
        const r = await runPms(true);
        // A queue acknowledgement is not a completed PMS refresh: wait
        // for server-side success/partial before telling the user it's synced.
        return r;
      }
      else if (task === "revenue") await runRevenue(true);
      else if (task === "checkouts") await runCheckouts(true);
      else {
        const r = await runPms(true);
        await Promise.all([runRevenue(true), runCheckouts(true)]);
        return r;
      }
    },
    [runPms, runRevenue, runCheckouts],
  );

  // First-sync-of-the-day prompt. The decision is made from the PROPERTY's
  // sync history, not this browser: once anyone has synced the hotel today,
  // nobody else is prompted. We never sync silently — the user gets an
  // actionable prompt so they can't work against stale PMS data.
  useEffect(() => {
    if (!enabled || !hotelId || !user?.id) return;
    const today = businessDate;
    const promptedKey = `liveSync.pmsPrompt.${user.id}.${hotelId}.${today}`;
    if (sessionStorage.getItem(promptedKey) === "1") return;
    let cancelled = false;

    (async () => {
      const keys = await resolveHotelKeys(hotelId).catch(() => [hotelId]);
      const { data } = await supabase
        .from("pms_sync_history")
        .select("created_at, sync_status")
        .eq("sync_type", "rooms_refresh") // Do not suppress the morning warning for lightweight checkout polls.
        .in("hotel_id", keys.length ? keys : [hotelId])
        .gte("created_at", startOfBudapestDayUtc(today))
        .in("sync_status", ["success", "partial"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      if (data) return; // someone already synced this property today
      sessionStorage.setItem(promptedKey, "1");

      const { toast } = await import("sonner");
      const runNow = async () => {
        const toastId = toast.loading("Syncing today's PMS data from Previo…", {
          description: executiveRole
            ? "Property data is being refreshed from Previo."
            : "Checkouts, daily stays and room notes are being refreshed.",
        });
        const r = await runPms(true);
        if (r.status === "error") {
          sessionStorage.removeItem(promptedKey);
          toast.error("PMS sync failed", { id: toastId, description: r.message });
        } else if (r.status === "partial") {
          toast.warning("PMS data incomplete", { id: toastId, description: r.message });
        } else if (r.status === "queued" || r.status === "syncing") {
          toast.message("PMS refresh requested", {
            id: toastId,
            description: "Track queued, running and completed stages in the PMS Sync status.",
          });
        } else {
          const meta = (r.meta || {}) as any;
          toast.success("Today's PMS data is up to date", {
            id: toastId,
            description: executiveRole
              ? `${meta.updated ?? 0} rooms updated from Previo.`
              : `${meta.updated ?? 0} rooms updated · ${meta.checkouts ?? 0} checkout rooms`,
          });
        }
        // The regular checkout poll continues independently of full refresh.
      };

      toast.warning("Today's PMS data hasn't been synced yet", {
        duration: 30000,
        description: executiveRole
          ? "Refresh from Previo to keep the property's live data current."
          : "Refresh from Previo before assigning rooms so checkouts and arrivals are correct.",
        action: { label: "Refresh now", onClick: () => void runNow() },
      });
    })();

    return () => { cancelled = true; };
  }, [enabled, hotelId, user?.id, runPms, runCheckouts, executiveRole, businessDate]);

  // Revenue refresh ownership lives on the revenue route, behind the shared
  // database lease. The global shell only polls checkout state.
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      const pending = await runCheckouts();
      if (cancelled) return;
      const delay = pending > 0 ? CHECKOUTS_ACTIVE_INTERVAL_MS : CHECKOUTS_IDLE_INTERVAL_MS;
      timer = setTimeout(tick, delay);
    };
    void tick();
    const onFocus = () => {
      void runCheckouts();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      if (timer) clearTimeout(timer);
    };
  }, [enabled, runCheckouts]);

  // ---- PMS change events: realtime + count ---------------------------------
  const refreshPmsChanges = useCallback(async () => {
    if (!enabled || !hotelId) return;
    const { count } = await (supabase as any)
      .from("pms_change_events")
      .select("id", { count: "exact", head: true })
      .eq("hotel_id", hotelId)
      .is("acknowledged_at", null);
    const { count: conflictCount } = await (supabase as any)
      .from("pms_change_events")
      .select("id", { count: "exact", head: true })
      .eq("hotel_id", hotelId)
      .eq("is_conflict", true)
      .is("acknowledged_at", null);
    setTasks((p) => ({
      ...p,
      pms_changes: {
        status: (conflictCount ?? 0) > 0 ? "error" : (count ?? 0) > 0 ? "partial" : "success",
        lastAt: new Date(),
        meta: { unacked: count ?? 0, conflicts: conflictCount ?? 0 },
      },
    }));
  }, [enabled, hotelId]);

  useEffect(() => {
    if (!enabled || !hotelId) return;
    void refreshPmsChanges();
    const channel = supabase
      .channel(`pms_change_events:${hotelId}`)
      .on(
        "postgres_changes" as any,
        { event: "*", schema: "public", table: "pms_change_events", filter: `hotel_id=eq.${hotelId}` },
        (payload: any) => {
          void refreshPmsChanges();
          if (payload.eventType === "INSERT") {
            const row = payload.new || {};
            const msg = row.is_conflict
              ? `PMS conflict on room ${row.room_label || "?"}`
              : `PMS update on room ${row.room_label || "?"}`;

            // Top management keeps visibility of real conflicts, but routine
            // room-level PMS updates are operational noise and stay with hotel
            // managers/reception teams.
            if (executiveRole && !row.is_conflict) return;

            import("sonner").then(({ toast }) => {
              if (row.is_conflict) {
                toast.error(msg, { action: { label: "Review", onClick: () => setDrawerOpen(true) } });
              } else {
                toast.message(msg, { action: { label: "Review", onClick: () => setDrawerOpen(true) } });
              }
            });
          }
        },
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [enabled, hotelId, refreshPmsChanges, executiveRole]);

  const openChangesDrawer = useCallback(() => setDrawerOpen(true), []);

  return (
    <LiveSyncContext.Provider value={{ enabled, hotelId, tasks, refresh, openChangesDrawer }}>
      {children}
      {enabled && hotelId && (
        <PmsChangesDrawer
          hotelId={hotelId}
          open={drawerOpen}
          onOpenChange={(v) => { setDrawerOpen(v); if (!v) void refreshPmsChanges(); }}
        />
      )}
    </LiveSyncContext.Provider>
  );
}

export const useLiveSync = () => useContext(LiveSyncContext);
