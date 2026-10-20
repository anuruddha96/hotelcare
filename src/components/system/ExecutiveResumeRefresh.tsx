import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { RefreshCw, ShieldAlert } from "lucide-react";
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
      className="pointer-events-auto fixed inset-0 z-[2147483646] flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-md"
      role="dialog"
      style={{ pointerEvents: "auto" }}
      aria-modal="true"
      aria-labelledby="idle-refresh-title"
      aria-describedby="idle-refresh-description"
    >
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 text-center text-card-foreground shadow-2xl sm:p-8">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          {idle ? <ShieldAlert className="h-6 w-6" /> : <RefreshCw className="h-6 w-6" />}
        </div>
        <h2 id="idle-refresh-title" className="text-xl font-semibold">
          {idle ? "HotelCare paused after 30 minutes" : "HotelCare needs an update"}
        </h2>
        <p id="idle-refresh-description" className="mt-3 text-sm leading-relaxed text-muted-foreground">
          {idle
            ? "No activity was detected for 30 minutes. Background operational queries and live subscriptions are stopped until you refresh."
            : "This version is outdated. Refresh to load the latest HotelCare and continue working safely."}
        </p>
        <p className="mt-3 text-xs text-muted-foreground">
          Saved work is preserved. Unsaved changes on this page may be lost.
        </p>
        <Button asChild className="mt-6 w-full" size="lg">
          <a href={refreshHref} autoFocus>
            <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
            Refresh HotelCare
          </a>
        </Button>
      </div>
    </div>
  );
}
