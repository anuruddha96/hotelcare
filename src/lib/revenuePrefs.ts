/**
 * Per-user, per-device revenue view preferences.
 *
 * A very wide calendar is still available, but mounting months of price cells
 * on first paint is expensive on properties with many room/occupancy rows
 * (SLNT is a good example). Desktop therefore opens the grid on 45 days unless
 * the user has explicitly saved another range. Whatever they pick is still
 * remembered exactly as before.
 */

const isBrowser = typeof window !== "undefined";

export const isDesktopViewport = () => isBrowser && window.innerWidth >= 768;

/** Fast first paint: 45 days on desktop, one readable month on mobile. */
export function defaultRangeDays(mobileDays = 30, desktopDays = 45): number {
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
export function rememberedRange(name: string, mobileDays = 30, desktopDays = 45): number {
  // RateStrategyGrid historically passes 180 explicitly. Keep that API
  // compatible, but make the *unsaved* first visit light. A user who has
  // deliberately selected 60d/90d/6m/9m/12m still gets that saved choice.
  const initialDesktopDays = name === "grid-range" ? Math.min(45, desktopDays) : desktopDays;
  return readNumberPref(name, defaultRangeDays(mobileDays, initialDesktopDays));
}
