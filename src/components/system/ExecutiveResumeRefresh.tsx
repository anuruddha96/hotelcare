import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";

/**
 * Executive resume freshness.
 *
 * When an admin / top-management user comes back to HotelCare after being away
 * for a couple of minutes, the screen they are looking at silently re-reads the
 * data HotelCare already has. It never triggers an external PMS/Previo sync,
 * never reloads the browser and never runs for operational staff: housekeeping,
 * maintenance, reception and everyone else keep exactly the behaviour they had
 * before this component existed.
 */

export const RESUME_REFRESH_ROLES = new Set([
  "admin",
  "top_management",
  "top_management_manager",
]);

export const RESUME_REFRESH_AFTER_MS = 2 * 60 * 1000;
export const EXTENDED_RESUME_AFTER_MS = 10 * 60 * 1000;
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
  const queryClient = useQueryClient();
  const hiddenSinceRef = useRef<number | null>(null);
  const lastResumeAtRef = useRef(0);

  const eligible = !!user && isResumeRefreshEligible(profile);

  useEffect(() => {
    // Operational roles register no listeners at all.
    if (!eligible) return;

    const markHidden = () => {
      if (hiddenSinceRef.current === null) hiddenSinceRef.current = Date.now();
    };

    const handleResume = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      const hiddenSince = hiddenSinceRef.current;
      if (hiddenSince === null) return;

      const now = Date.now();
      const idleMs = now - hiddenSince;

      // Mobile browsers fire visibilitychange + focus + pageshow together.
      // Clearing the marker first, plus the debounce window, guarantees a
      // single refresh per return.
      if (now - lastResumeAtRef.current < RESUME_DEBOUNCE_MS) {
        hiddenSinceRef.current = null;
        return;
      }
      if (idleMs < RESUME_REFRESH_AFTER_MS) {
        hiddenSinceRef.current = null;
        return;
      }
      hiddenSinceRef.current = null;
      lastResumeAtRef.current = now;

      const detail: ExecutiveResumeDetail = {
        idleMs,
        level: idleMs >= EXTENDED_RESUME_AFTER_MS ? "extended" : "normal",
      };
      window.dispatchEvent(new CustomEvent(EXECUTIVE_RESUME_EVENT, { detail }));

      // Only what is on screen right now — inactive cached queries stay cached.
      void queryClient.invalidateQueries({ refetchType: "active" });
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") markHidden();
      else handleResume();
    };
    const onPageShow = () => handleResume();
    const onFocus = () => handleResume();
    const onBlur = () => markHidden();
    const onOnline = () => handleResume();

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    window.addEventListener("online", onOnline);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("online", onOnline);
    };
  }, [eligible, queryClient]);

  return null;
}
