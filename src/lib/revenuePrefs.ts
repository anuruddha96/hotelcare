/**
 * Per-user, per-device revenue view preferences.
 *
 * A very wide calendar is still available, but mounting six months of price
 * cells on the first paint makes the Rate & Pickup view feel heavy. Desktop
 * therefore opens the grid on 90 days unless the user has explicitly saved
 * another range. Whatever they pick is remembered exactly as before.
 */

const isBrowser = typeof window !== "undefined";

export const isDesktopViewport = () => isBrowser && window.innerWidth >= 768;

/** Smooth generic first paint: 90 days on desktop, one readable month on mobile. */
export function defaultRangeDays(mobileDays = 30, desktopDays = 90): number {
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
export function rememberedRange(name: string, mobileDays = 30, desktopDays = 90): number {
  // RateStrategyGrid historically passed 180 explicitly. Keep that API
  // compatible, but make the *unsaved* first visit light. A user who has
  // deliberately selected 6m/9m/12m still gets that saved choice unchanged.
  const initialDesktopDays = name === "grid-range" ? Math.min(90, desktopDays) : desktopDays;
  return readNumberPref(name, defaultRangeDays(mobileDays, initialDesktopDays));
}
