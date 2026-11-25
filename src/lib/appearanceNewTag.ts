import { useEffect, useState } from "react";

// One-week introduction of the appearance control, in Budapest local time.
export const APPEARANCE_TAG_START = Date.parse("2026-11-25T00:00:00+01:00");
export const APPEARANCE_TAG_END = Date.parse("2026-12-02T00:00:00+01:00");

export function isAppearanceTagActive(now = Date.now()): boolean {
  return now >= APPEARANCE_TAG_START && now < APPEARANCE_TAG_END;
}

export function useAppearanceNewTag(): boolean {
  const [active, setActive] = useState(isAppearanceTagActive);

  useEffect(() => {
    let timer: number | undefined;
    const sync = () => {
      window.clearTimeout(timer);
      const now = Date.now();
      setActive(isAppearanceTagActive(now));
      const boundary = now < APPEARANCE_TAG_START ? APPEARANCE_TAG_START : APPEARANCE_TAG_END;
      if (now < boundary) timer = window.setTimeout(sync, Math.min(boundary - now, 60_000));
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
