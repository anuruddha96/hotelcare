/**
 * Per-tab cache of the last verified published Revenue dataset.
 *
 * Big portfolios used to re-download and re-parse everything on every reload,
 * so the page showed its loading screen again and again. We keep the first,
 * smaller window of the dataset in sessionStorage so a returning user paints
 * quickly while the requested horizon reloads quietly in the background.
 *
 * Room-type metadata is much smaller and changes rarely, so we also keep a
 * tenant/property-scoped copy in localStorage. That lets the frozen room rail
 * render immediately on a new tab or browser session while prices are loading.
 * Both caches are cleared on sign-out / identity change.
 */

const PREFIX = "revenue_payload";
const META_PREFIX = "revenue_room_meta";
/** Anything older than this is refetched before it is trusted for painting. */
const MAX_AGE_MS = 30 * 60 * 1000;
/** Room labels/mappings may safely survive normal browser restarts for a week. */
const META_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** sessionStorage quota is ~5 MB per origin — never try to store more. */
const MAX_BYTES = 3_200_000;
/** Metadata should remain tiny; reject accidental large payloads. */
const META_MAX_BYTES = 180_000;

export interface StoredRevenuePayload<T> {
  payload: T;
  lastSyncAt: string | null;
  lastSyncBy: string | null;
  savedAt: number;
}

export interface StoredRevenueRoomMetadata<T> {
  roomTypes: T;
  savedAt: number;
}

const keyFor = (cacheKey: string) => `${PREFIX}:${cacheKey}`;
const metaKeyFor = (cacheKey: string) => `${META_PREFIX}:${cacheKey}`;

export function readCachedRevenuePayload<T>(cacheKey: string): StoredRevenuePayload<T> | null {
  try {
    const raw = sessionStorage.getItem(keyFor(cacheKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredRevenuePayload<T>;
    if (!parsed?.payload || Date.now() - (parsed.savedAt ?? 0) > MAX_AGE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeCachedRevenuePayload<T>(
  cacheKey: string,
  value: Omit<StoredRevenuePayload<T>, "savedAt">,
): void {
  try {
    const raw = JSON.stringify({ ...value, savedAt: Date.now() });
    if (raw.length > MAX_BYTES) return;
    sessionStorage.setItem(keyFor(cacheKey), raw);
  } catch {
    /* quota or private mode — the in-memory cache still applies */
  }
}

export function readCachedRevenueRoomMetadata<T>(cacheKey: string): T | null {
  try {
    const raw = localStorage.getItem(metaKeyFor(cacheKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredRevenueRoomMetadata<T>;
    if (!parsed?.roomTypes || Date.now() - (parsed.savedAt ?? 0) > META_MAX_AGE_MS) {
      localStorage.removeItem(metaKeyFor(cacheKey));
      return null;
    }
    return parsed.roomTypes;
  } catch {
    return null;
  }
}

export function writeCachedRevenueRoomMetadata<T>(cacheKey: string, roomTypes: T): void {
  try {
    const raw = JSON.stringify({ roomTypes, savedAt: Date.now() });
    if (raw.length > META_MAX_BYTES) return;
    localStorage.setItem(metaKeyFor(cacheKey), raw);
  } catch {
    /* quota or private mode — normal loading still works */
  }
}

/** Sign-out / identity change: no tenant data may survive into the next session. */
export function clearCachedRevenuePayloads(): void {
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i -= 1) {
      const key = sessionStorage.key(i);
      if (key?.startsWith(`${PREFIX}:`)) sessionStorage.removeItem(key);
    }
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i);
      if (key?.startsWith(`${META_PREFIX}:`)) localStorage.removeItem(key);
    }
  } catch {
    /* ignore */
  }
}
