import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { freshApplicationUrl } from "@/lib/lazyModuleRecovery";

/**
 * Managers often leave several HotelCare tabs open. Never mutate or replace
 * their current view merely because a tab regained focus: after a long absence
 * put the choice in the user's hands, including when the tab stayed visible but
 * received no input. Operational staff retain their existing uninterrupted UX.
 */
export const RESUME_REFRESH_ROLES = new Set([
  "admin",
  "top_management",
  "top_management_manager",
]);

export const RESUME_REFRESH_AFTER_MS = 15 * 60 * 1000;
// Kept as compatibility exports for older listeners/tests. Neither threshold
// triggers a background refresh or a synthetic resume event anymore.
export const EXTENDED_RESUME_AFTER_MS = RESUME_REFRESH_AFTER_MS;
export const RESUME_DEBOUNCE_MS = 5000;
export const EXECUTIVE_RESUME_EVENT = "hotelcare:executive-resume";

export interface ExecutiveResumeDetail {
  idleMs: number;
  level: "normal" | "extended";
}

export function isResumeRefreshEligible(
  profile: { role?: string | null; is_super_admin?: boolean | null } | null | undefined,
): boolean {
  if (!profile) return false;
  if (profile.is_super_admin === true) return true;
  return !!profile.role && RESUME_REFRESH_ROLES.has(profile.role);
}

export default function ExecutiveResumeRefresh() {
  const { user, profile } = useAuth();
  const eligible = !!user && isResumeRefreshEligible(profile);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const lastInteractionRef = useRef(Date.now());
  const awaySinceRef = useRef<number | null>(null);
  const pendingRef = useRef(false);

  useEffect(() => {
    if (!eligible) {
      pendingRef.current = false;
      awaySinceRef.current = null;
      setNeedsRefresh(false);
      return;
    }

    const markAway = () => {
      if (awaySinceRef.current === null) awaySinceRef.current = Date.now();
    };

    const promptIfIdle = (now: number): boolean => {
      if (pendingRef.current) return true;
      const idleSince = awaySinceRef.current === null
        ? lastInteractionRef.current
        : Math.min(lastInteractionRef.current, awaySinceRef.current);
      if (now - idleSince < RESUME_REFRESH_AFTER_MS) return false;
      pendingRef.current = true;
      setNeedsRefresh(true);
      return true;
    };

    const handleReturn = () => {
      if (document.visibilityState === "hidden" || pendingRef.current) return;
      const now = Date.now();
      const showPrompt = promptIfIdle(now);
      awaySinceRef.current = null;
      if (!showPrompt) lastInteractionRef.current = now;
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") markAway();
      else handleReturn();
    };

    const onActivity = (event: Event) => {
      if (document.visibilityState === "hidden" || pendingRef.current) return;
      if (promptIfIdle(Date.now())) {
        // The very first click/key after an idle period must not inadvertently
        // submit a form or change a price underneath the newly opened dialog.
        if (event.cancelable) event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      lastInteractionRef.current = Date.now();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", markAway);
    window.addEventListener("pageshow", handleReturn);
    window.addEventListener("blur", markAway);
    window.addEventListener("focus", handleReturn);
    for (const name of ["pointermove", "pointerdown", "keydown", "touchstart", "wheel"]) {
      window.addEventListener(name, onActivity, { capture: true, passive: false });
    }
    if (document.visibilityState === "hidden") markAway();

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", markAway);
      window.removeEventListener("pageshow", handleReturn);
      window.removeEventListener("blur", markAway);
      window.removeEventListener("focus", handleReturn);
      for (const name of ["pointermove", "pointerdown", "keydown", "touchstart", "wheel"]) {
        window.removeEventListener(name, onActivity, true);
      }
    };
  }, [eligible]);

  if (!eligible || !needsRefresh) return null;

  const refresh = () => {
    // Explicit action only. A cache-busting URL prevents stale Safari/Vite
    // chunks from immediately recreating the white-screen failure; preserve
    // the exact tenant, hotel, route, existing query parameters and hash.
    window.location.replace(freshApplicationUrl(window.location.href, Date.now()));
  };

  return (
    <div
      className="fixed inset-0 z-[2147483646] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="idle-refresh-title"
      aria-describedby="idle-refresh-description"
    >
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 text-center text-card-foreground shadow-2xl sm:p-8">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <RefreshCw className="h-6 w-6" aria-hidden="true" />
        </div>
        <h2 id="idle-refresh-title" className="text-xl font-semibold">Welcome back</h2>
        <p id="idle-refresh-description" className="mt-3 text-sm leading-relaxed text-muted-foreground">
          You were away for some time. This view may be out of date. Refresh to see the latest HotelCare information.
        </p>
        <p className="mt-3 text-xs text-muted-foreground">Refreshing may discard unsaved changes.</p>
        <Button className="mt-6 w-full" size="lg" onClick={refresh} autoFocus>
          <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
          Refresh now
        </Button>
      </div>
    </div>
  );
}
