/**
 * Per-user, per-device revenue view preferences.
 *
 * Desktop readers want the widest horizon by default (6 months); a phone can
 * only show a few weeks legibly. Whatever the user picks is remembered so the
 * page opens the way they left it.
 */

const isBrowser = typeof window !== "undefined";

export const isDesktopViewport = () => isBrowser && window.innerWidth >= 768;

/** Widest sensible default: 6 months on desktop, a readable month on mobile. */
export function defaultRangeDays(mobileDays = 30, desktopDays = 180): number {
  return isDesktopViewport() ? desktopDays : mobileDays;
}

function key(name: string): string {
  return `revenue-pref:${name}:${isDesktopViewport() ? "desktop" : "mobile"}`;
}

export function readNumberPref(name: string, fallback: number): number {
  if (!isBrowser) return fallback;
  try {
    const raw = window.localStorage.getItem(key(name));
    const value = raw === null ? NaN : Number(raw);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  } catch {
    return fallback;
  }
}

export function writeNumberPref(name: string, value: number): void {
  if (!isBrowser) return;
  try { window.localStorage.setItem(key(name), String(value)); } catch { /* private mode */ }
}

/** State initialiser + setter wrapper for a remembered numeric range. */
export function rememberedRange(name: string, mobileDays = 30, desktopDays = 180): number {
  return readNumberPref(name, defaultRangeDays(mobileDays, desktopDays));
}
