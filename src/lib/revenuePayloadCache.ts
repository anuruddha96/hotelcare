/**
 * Revenue payload caches used by the Rate & Pickup calendar.
 *
 * There are three deliberately different layers:
 *  - memory: the complete payload for the current SPA session;
 *  - sessionStorage: the first useful verified window for the current tab;
 *  - localStorage hot cache: a compact verified calendar window that survives
 *    route changes, reloads and a new tab so the room rail and recent prices
 *    can paint immediately while the server quietly revalidates them.
 */

const PREFIX = "revenue_payload";
const META_PREFIX = "revenue_room_meta";
const HOT_PREFIX = "revenue_hot";

/** Anything older than this is refetched before it is trusted for painting. */
const MAX_AGE_MS = 30 * 60 * 1000;
/** Room labels/mappings change rarely. */
const META_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** A verified compact calendar may be used briefly as stale-while-revalidate. */
const HOT_MAX_AGE_MS = 45 * 60 * 1000;

/** sessionStorage quota is ~5 MB per origin — never try to store more. */
const MAX_BYTES = 3_200_000;
/** Keep the persistent hot cache comfortably below common localStorage limits. */
const HOT_MAX_BYTES = 2_400_000;
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
const hotKeyFor = (cacheKey: string) => `${HOT_PREFIX}:${cacheKey}`;

function readStoredPayload<T>(storage: Storage, key: string, maxAgeMs: number): StoredRevenuePayload<T> | null {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredRevenuePayload<T>;
    if (!parsed?.payload || Date.now() - (parsed.savedAt ?? 0) > maxAgeMs) {
      storage.removeItem(key);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeStoredPayload<T>(storage: Storage, key: string, maxBytes: number, value: Omit<StoredRevenuePayload<T>, "savedAt">): void {
  try {
    const raw = JSON.stringify({ ...value, savedAt: Date.now() });
    if (raw.length > maxBytes) return;
    storage.setItem(key, raw);
  } catch {
    /* quota or private mode — the in-memory cache still applies */
  }
}

export function readCachedRevenuePayload<T>(cacheKey: string): StoredRevenuePayload<T> | null {
  return readStoredPayload<T>(sessionStorage, keyFor(cacheKey), MAX_AGE_MS);
}

export function writeCachedRevenuePayload<T>(
  cacheKey: string,
  value: Omit<StoredRevenuePayload<T>, "savedAt">,
): void {
  writeStoredPayload(sessionStorage, keyFor(cacheKey), MAX_BYTES, value);
}

/**
 * Compact persistent calendar cache. The hook stores only the near-term window
 * here, so it remains small enough to survive even when a six-month payload is
 * too large for sessionStorage.
 */
export function readCachedRevenueHotPayload<T>(cacheKey: string): StoredRevenuePayload<T> | null {
  return readStoredPayload<T>(localStorage, hotKeyFor(cacheKey), HOT_MAX_AGE_MS);
}

export function writeCachedRevenueHotPayload<T>(
  cacheKey: string,
  value: Omit<StoredRevenuePayload<T>, "savedAt">,
): void {
  writeStoredPayload(localStorage, hotKeyFor(cacheKey), HOT_MAX_BYTES, value);
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
      if (key?.startsWith(`${META_PREFIX}:`) || key?.startsWith(`${HOT_PREFIX}:`)) localStorage.removeItem(key);
    }
  } catch {
    /* ignore */
  }
}
