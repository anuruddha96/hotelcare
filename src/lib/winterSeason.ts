import { useEffect, useState } from "react";
import type { AccessSubject } from "@/lib/accessPolicy";

// A one-off 2026 campaign, using Budapest midnight regardless of device timezone.
export const WINTER_START = Date.parse("2026-11-25T00:00:00+01:00");
export const WINTER_END = Date.parse("2027-01-01T00:00:00+01:00");

export function isWinterSeason(now = Date.now()): boolean {
  return now >= WINTER_START && now < WINTER_END;
}

/** Decorative only; every signed-in staff profile is eligible. The tenant
 * router independently requires authentication and excludes auth screens. */
export function canSeeWinterSnow(profile: AccessSubject): boolean {
  return !!profile;
}

/** Also expires in an already-open tab; resynchronizes after sleep or tab restore. */
export function useWinterSeason(): boolean {
  const [active, setActive] = useState(isWinterSeason);
  useEffect(() => {
    let timer: number | undefined;
    const sync = () => {
      window.clearTimeout(timer);
      const now = Date.now();
      setActive(isWinterSeason(now));
      const boundary = now < WINTER_START ? WINTER_START : WINTER_END;
      if (now < boundary) {
        timer = window.setTimeout(sync, Math.min(boundary - now, 60_000));
      }
    };
    sync();
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);
  return active;
}
