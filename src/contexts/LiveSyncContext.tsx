// LiveSync — silently pulls live PMS / Revenue data from Previo whenever an
// eligible user (manager / admin / top_management) is logged in. Other roles
// (housekeeping, maintenance, reception) are completely opted out.
//
// Each task tracks its own status and is exposed to the rest of the app via
// the LiveSyncIndicator pill in the header and per-feature banners.

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { runPmsRefresh, type PmsSyncStatus } from "@/lib/pmsRefresh";

export type TaskName = "pms" | "revenue" | "checkouts";

export interface TaskState {
  status: PmsSyncStatus | "syncing";
  lastAt: Date | null;
  message?: string;
  meta?: Record<string, any>;
}

interface LiveSyncContextValue {
  enabled: boolean;
  hotelId: string | null;
  tasks: Record<TaskName, TaskState>;
  refresh: (task?: TaskName) => Promise<void>;
}

const ELIGIBLE_ROLES = new Set([
  "admin",
  "top_management",
  "manager",
  "housekeeping_manager",
  "front_office",
]);

const THROTTLE_MS = 2 * 60 * 1000; // 2 min

const initialTask: TaskState = { status: "idle", lastAt: null };

const LiveSyncContext = createContext<LiveSyncContextValue>({
  enabled: false,
  hotelId: null,
  tasks: { pms: initialTask, revenue: initialTask },
  refresh: async () => {},
});

export function LiveSyncProvider({ children }: { children: React.ReactNode }) {
  const { profile, user } = useAuth();
  const [hotelId, setHotelId] = useState<string | null>(null);
  const [hasPrevio, setHasPrevio] = useState(false);
  const [tasks, setTasks] = useState<Record<TaskName, TaskState>>({
    pms: initialTask,
    revenue: initialTask,
  });
  const lastRunRef = useRef<Record<TaskName, number>>({ pms: 0, revenue: 0 });

  const enabled = !!user && !!profile?.role && ELIGIBLE_ROLES.has(profile.role) && hasPrevio;

  // Detect whether the user's hotel has an active Previo config.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!profile?.assigned_hotel || !profile.role || !ELIGIBLE_ROLES.has(profile.role)) {
        setHotelId(null);
        setHasPrevio(false);
        return;
      }
      const { data } = await supabase
        .from("pms_configurations")
        .select("hotel_id, is_active, pms_type")
        .eq("hotel_id", profile.assigned_hotel)
        .eq("pms_type", "previo")
        .eq("is_active", true)
        .maybeSingle();
      if (cancelled) return;
      if (data) {
        setHotelId(data.hotel_id);
        setHasPrevio(true);
      } else {
        setHotelId(profile.assigned_hotel);
        setHasPrevio(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profile?.assigned_hotel, profile?.role]);

  // Load most recent sync timestamp for visual continuity across reloads.
  useEffect(() => {
    if (!enabled || !hotelId) return;
    (async () => {
      const { data } = await supabase
        .from("pms_sync_history")
        .select("created_at, sync_status, data")
        .eq("hotel_id", hotelId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!data) return;
      setTasks((prev) => ({
        ...prev,
        pms: {
          status: ((data as any).sync_status as PmsSyncStatus) || "success",
          lastAt: new Date((data as any).created_at),
          meta: (data as any).data || {},
        },
      }));
    })();
  }, [enabled, hotelId]);

  const runPms = useCallback(async (force = false) => {
    if (!enabled || !hotelId) return;
    const now = Date.now();
    if (!force && now - lastRunRef.current.pms < THROTTLE_MS) return;
    lastRunRef.current.pms = now;
    setTasks((p) => ({ ...p, pms: { ...p.pms, status: "syncing" } }));
    try {
      const r = await runPmsRefresh(hotelId);
      setTasks((p) => ({
        ...p,
        pms: { status: r.status, lastAt: new Date(), meta: r },
      }));
    } catch (e: any) {
      setTasks((p) => ({
        ...p,
        pms: { status: "error", lastAt: new Date(), message: e?.message || "PMS sync failed" },
      }));
    }
  }, [enabled, hotelId]);

  const runRevenue = useCallback(async (force = false) => {
    if (!enabled || !hotelId) return;
    const unsupportedKey = `liveSync.revenue.unsupported.${hotelId}`;
    if (!force && sessionStorage.getItem(unsupportedKey) === "1") {
      // Endpoint already known to be unavailable in this session — skip silently.
      return;
    }
    const now = Date.now();
    if (!force && now - lastRunRef.current.revenue < THROTTLE_MS) return;
    lastRunRef.current.revenue = now;
    setTasks((p) => ({ ...p, revenue: { ...p.revenue, status: "syncing" } }));
    try {
      const { data, error } = await supabase.functions.invoke("previo-pull-revenue", {
        body: { hotelId, days: 365 },
      });
      if (error) throw new Error(error.message || "Revenue sync failed");
      const payload = (data || {}) as any;
      if (payload.ok === false) {
        throw new Error(payload.error || "Revenue sync failed");
      }
      if (payload.supported === false) {
        sessionStorage.setItem(unsupportedKey, "1");
        setTasks((p) => ({
          ...p,
          revenue: {
            status: "idle",
            lastAt: new Date(),
            message: payload.message,
            meta: payload,
          },
        }));
        return;
      }
      // Clear any prior unsupported flag now that the call succeeded.
      sessionStorage.removeItem(unsupportedKey);
      setTasks((p) => ({
        ...p,
        revenue: { status: "success", lastAt: new Date(), meta: payload },
      }));
    } catch (e: any) {
      setTasks((p) => ({
        ...p,
        revenue: { status: "error", lastAt: new Date(), message: e?.message || "Revenue sync failed" },
      }));
    }
  }, [enabled, hotelId]);

  const refresh = useCallback(
    async (task?: TaskName) => {
      if (task === "pms") await runPms(true);
      else if (task === "revenue") await runRevenue(true);
      else await Promise.all([runPms(true), runRevenue(true)]);
    },
    [runPms, runRevenue],
  );

  // Auto-run on login + when tab regains focus after long idle.
  useEffect(() => {
    if (!enabled) return;
    void runPms();
    void runRevenue();
    const onFocus = () => {
      void runPms();
      void runRevenue();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [enabled, runPms, runRevenue]);

  return (
    <LiveSyncContext.Provider value={{ enabled, hotelId, tasks, refresh }}>
      {children}
    </LiveSyncContext.Provider>
  );
}

export const useLiveSync = () => useContext(LiveSyncContext);
