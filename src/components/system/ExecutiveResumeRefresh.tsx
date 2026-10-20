import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { RefreshCw, Clock3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { freshApplicationUrl } from "@/lib/lazyModuleRecovery";
import { checkHotelCareRelease } from "@/lib/hotelcareVersion";
import {
  checkHotelCareInactivity,
  CLIENT_UPDATE_GRACE_MS,
  CLIENT_VERSION_CHECK_MS,
  getSessionSuspension,
  observeSessionSuspension,
  recordHotelCareInteraction,
  resetHotelCareSession,
  SESSION_INACTIVITY_MS,
  suspendHotelCareSession,
} from "@/lib/clientSessionGuard";

/** Compatibility exports retained for existing consumers. */
export const RESUME_REFRESH_ROLES = new Set(["admin", "top_management", "top_management_manager"]);
export const RESUME_REFRESH_AFTER_MS = SESSION_INACTIVITY_MS;
export const EXTENDED_RESUME_AFTER_MS = SESSION_INACTIVITY_MS;
export const RESUME_DEBOUNCE_MS = 5000;
export const EXECUTIVE_RESUME_EVENT = "hotelcare:executive-resume";

export interface ExecutiveResumeDetail {
  idleMs: number;
  level: "normal" | "extended";
}
export function isResumeRefreshEligible(
  profile: { role?: string | null; is_super_admin?: boolean | null } | null | undefined,
): boolean {
  return !!profile;
}

/**
 * After 30 minutes WITHOUT trusted interaction, remove the operational app
 * subtree (AuthenticatedShell) and require a new document load to resume.
 * Merely showing a dialog would leave the old React timers running.
 *
 * Version polling goes to the static host every five minutes; this is
 * deliberately independent of Supabase data usage.
 */
export default function ExecutiveResumeRefresh() {
  const { user, profile } = useAuth();
  const eligible = !!user && isResumeRefreshEligible(profile);
  const suspension = useSyncExternalStore(
    observeSessionSuspension, getSessionSuspension, () => null,
  );
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const firstUpdateSeen = useRef<number | null>(null);
  const initializedUserRef = useRef<string | null>(null);

  useEffect(() => {
    if (!eligible || !user?.id) return;
    // A temporary profile reload must not unlock an already suspended tab.
    // Reset the idle clock only for a genuinely new signed-in user.
    if (initializedUserRef.current !== user.id) {
      initializedUserRef.current = user.id;
      resetHotelCareSession();
    }

    const checkIdle = () => { checkHotelCareInactivity(); };
    const onUserActivity = (event: Event) => {
      // No synthetic activity or background process may silently extend life.
      if (document.hidden) return;
      // Even a synthetic event must not activate a stale underlying control.
      if (checkHotelCareInactivity()) {
        // The first click after a long idle must not accidentally change a
        // rate, assign a room or submit a form under the new modal.
        const dialog = document.getElementById("idle-refresh-dialog");
        if (dialog && event.target instanceof Node && dialog.contains(event.target)) return;
        if (event.cancelable) event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (!event.isTrusted) return;
      recordHotelCareInteraction();
    };
    // pointermove is intentionally excluded: desk mice and remote-control
    // utilities can generate movement without anyone actually working.
    const activityEvents = ["pointerdown", "click", "keydown", "touchstart", "wheel"];
    for (const eventName of activityEvents) {
      window.addEventListener(eventName, onUserActivity, { passive: false, capture: true });
    }
    const onResume = () => { checkIdle(); };
    document.addEventListener("visibilitychange", onResume);
    window.addEventListener("pageshow", onResume);
    window.addEventListener("focus", onResume);

    const interval = window.setInterval(checkIdle, 15_000);
    return () => {
      window.clearInterval(interval);
      for (const eventName of activityEvents) {
        window.removeEventListener(eventName, onUserActivity, true);
      }
      document.removeEventListener("visibilitychange", onResume);
      window.removeEventListener("pageshow", onResume);
      window.removeEventListener("focus", onResume);
    };
  }, [eligible, user?.id]);

  useEffect(() => {
    if (!eligible) {
      firstUpdateSeen.current = null;
      setUpdateAvailable(false);
      return;
    }
    let active = true;
    const checkRelease = async () => {
      if (!active || getSessionSuspension()) return;
      try {
        if (!(await checkHotelCareRelease()) || !active) return;
        if (firstUpdateSeen.current === null) firstUpdateSeen.current = Date.now();
        setUpdateAvailable(true);
        // Do not wake an unattended room-board just to show a notice.
        if (document.hidden) suspendHotelCareSession("update");
      } catch {
        // Hosting may temporarily be unavailable. Do not lock out a working
        // hotel because version discovery timed out.
      }
    };
    void checkRelease();
    const timer = window.setInterval(() => { void checkRelease(); }, CLIENT_VERSION_CHECK_MS);
    const deadline = window.setInterval(() => {
      if (firstUpdateSeen.current !== null
          && Date.now() - firstUpdateSeen.current >= CLIENT_UPDATE_GRACE_MS) {
        suspendHotelCareSession("update");
      }
    }, 15_000);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.clearInterval(deadline);
    };
  }, [eligible, user?.id]);

  if (!eligible) return null;
  const refreshHref = freshApplicationUrl(window.location.href, Date.now());

  if (!suspension && updateAvailable) {
    return (
      <div role="status" className="fixed bottom-4 left-4 right-4 z-[2147483645] mx-auto max-w-md rounded-xl border border-amber-300 bg-card p-4 text-card-foreground shadow-2xl sm:left-auto sm:right-5">
        <p className="flex items-center gap-2 font-semibold"><RefreshCw className="h-4 w-4" /> HotelCare update available</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Save any unfinished changes, then refresh to continue. The older version will be paused shortly.
        </p>
        <Button asChild className="mt-3 w-full"><a href={refreshHref}>Refresh HotelCare</a></Button>
      </div>
    );
  }

  if (!suspension) return null;
  const idle = suspension === "idle";
  return (
    <div
      id="idle-refresh-dialog"
      className="pointer-events-auto fixed inset-0 z-[2147483646] flex items-center justify-center bg-slate-950/45 px-5 py-8 backdrop-blur-[3px]"
      role="dialog"
      style={{ pointerEvents: "auto" }}
      aria-modal="true"
      aria-labelledby="idle-refresh-title"
      aria-describedby={idle ? undefined : "idle-refresh-description"}
    >
      <div className="relative w-full max-w-[490px] overflow-hidden rounded-[28px] border border-white/80 bg-card/95 px-7 py-9 text-center text-card-foreground shadow-[0_30px_100px_rgba(12,24,48,0.32)] ring-1 ring-white/25 sm:px-11 sm:py-11">
        <div className="pointer-events-none absolute inset-x-12 top-0 h-16 rounded-full bg-sky-400/10 blur-3xl" aria-hidden="true" />
        <div className="relative mx-auto mb-6 flex h-[68px] w-[68px] items-center justify-center rounded-[22px] bg-gradient-to-br from-sky-50 via-blue-50 to-indigo-100 text-blue-600 ring-1 ring-blue-100 dark:from-sky-900/50 dark:via-blue-900/40 dark:to-indigo-900/30 dark:text-sky-300 dark:ring-blue-800">
          {idle ? <Clock3 className="h-8 w-8" strokeWidth={1.8} aria-hidden="true" /> : <RefreshCw className="h-8 w-8" strokeWidth={1.8} aria-hidden="true" />}
        </div>
        <h2 id="idle-refresh-title" className="relative text-balance text-[25px] font-semibold leading-tight tracking-tight sm:text-[28px]">
          {idle ? "You've been away for some time" : "HotelCare has been updated"}
        </h2>
        {!idle && (
          <p id="idle-refresh-description" className="relative mt-3 text-sm text-muted-foreground">
            Refresh to continue with the latest version.
          </p>
        )}
        <Button
          asChild
          size="lg"
          className="relative mt-8 h-13 w-full rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 text-base font-semibold text-white shadow-lg shadow-blue-500/20 transition-all hover:from-sky-600 hover:to-blue-700 hover:shadow-xl hover:shadow-blue-500/25 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
        >
          <a href={refreshHref} autoFocus>
            <RefreshCw className="mr-2 h-[18px] w-[18px]" aria-hidden="true" />
            Refresh and continue
          </a>
        </Button>
      </div>
    </div>
  );
}
