/**
 * Revenue payload caches used by the Rate & Pickup calendar.
 *
 * There are three deliberately different layers:
 *  - memory: the complete payload for the current SPA session;
 *  - sessionStorage: the first useful verified window for the current tab;
 *  - session hot cache: a compact verified calendar window that survives route
 *    changes and reloads even when a six-month payload is too large to store.
 *
 * Only tiny structural room metadata is kept in localStorage across sessions.
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
/** Compact near-term grid slice. */
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

/**
 * SLNT's first revenue window alone contains several MB of data. Serializing
 * that twice into WebKit sessionStorage on each login/refresh adds a second
 * copy and can crash a memory-constrained iOS tab. Keep only its in-memory
 * verified dataset on iOS; desktop SLNT and every other tenant are unchanged.
 * Storage entries left by older builds are removed without parsing them.
 */
function useMemoryOnlyRevenueCache(cacheKey: string): boolean {
  return cacheKey.startsWith("slnt:")
    && typeof navigator !== "undefined"
    && /iPad|iPhone|iPod/.test(navigator.userAgent);
}

function removeExistingMobileCacheEntry(key: string): void {
  try { sessionStorage.removeItem(key); } catch { /* storage disabled */ }
}

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

/**
 * JSON.stringify of a large first-window response can block React's first
 * paint. Queue cache writes until idle, one entry per idle turn. The latest
 * verified response wins if a hotel is refreshed while an earlier write waits.
 * Crucially, sign-out cancels queued writes before clearing tenant storage.
 */
type PendingWrite = { key: string; maxBytes: number; value: Omit<StoredRevenuePayload<unknown>, "savedAt"> };
const pendingWrites = new Map<string, PendingWrite>();
let idleHandle: number | null = null;
let fallbackTimer: number | null = null;

function scheduleNextWrite(): void {
  if (idleHandle !== null || fallbackTimer !== null || pendingWrites.size === 0 || typeof window === "undefined") return;
  const idleWindow = window as typeof window & {
    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  };
  const run = () => {
    idleHandle = null;
    fallbackTimer = null;
    const next = pendingWrites.entries().next().value;
    if (!next) return;
    const [key, write] = next;
    pendingWrites.delete(key);
    try { writeStoredPayload(sessionStorage, write.key, write.maxBytes, write.value); } catch { /* storage disabled */ }
    scheduleNextWrite();
  };
  if (idleWindow.requestIdleCallback) {
    idleHandle = idleWindow.requestIdleCallback(run, { timeout: 2000 });
  } else {
    fallbackTimer = window.setTimeout(run, 16);
  }
}

function queueStoredPayload<T>(key: string, maxBytes: number, value: Omit<StoredRevenuePayload<T>, "savedAt">): void {
  // Avoid stringifying megabytes on the same task that first paints the grid.
  pendingWrites.set(key, { key, maxBytes, value });
  scheduleNextWrite();
}

export function readCachedRevenuePayload<T>(cacheKey: string): StoredRevenuePayload<T> | null {
  if (useMemoryOnlyRevenueCache(cacheKey)) {
    removeExistingMobileCacheEntry(keyFor(cacheKey));
    return null;
  }
  return readStoredPayload<T>(sessionStorage, keyFor(cacheKey), MAX_AGE_MS);
}

export function writeCachedRevenuePayload<T>(
  cacheKey: string,
  value: Omit<StoredRevenuePayload<T>, "savedAt">,
): void {
  if (useMemoryOnlyRevenueCache(cacheKey)) return;
  queueStoredPayload(keyFor(cacheKey), MAX_BYTES, value);
}

/** Compact near-term fallback used when the full payload is too large to cache. */
export function readCachedRevenueHotPayload<T>(cacheKey: string): StoredRevenuePayload<T> | null {
  if (useMemoryOnlyRevenueCache(cacheKey)) {
    removeExistingMobileCacheEntry(hotKeyFor(cacheKey));
    return null;
  }
  return readStoredPayload<T>(sessionStorage, hotKeyFor(cacheKey), HOT_MAX_AGE_MS);
}

export function writeCachedRevenueHotPayload<T>(
  cacheKey: string,
  value: Omit<StoredRevenuePayload<T>, "savedAt">,
): void {
  if (useMemoryOnlyRevenueCache(cacheKey)) return;
  queueStoredPayload(hotKeyFor(cacheKey), HOT_MAX_BYTES, value);
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
  // Pending idle callbacks must never reinsert old tenant data after sign-out.
  pendingWrites.clear();
  try {
    if (idleHandle !== null) {
      (window as typeof window & { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback?.(idleHandle);
      idleHandle = null;
    }
    if (fallbackTimer !== null) {
      window.clearTimeout(fallbackTimer);
      fallbackTimer = null;
    }
    for (let i = sessionStorage.length - 1; i >= 0; i -= 1) {
      const key = sessionStorage.key(i);
      if (key?.startsWith(`${PREFIX}:`) || key?.startsWith(`${HOT_PREFIX}:`)) sessionStorage.removeItem(key);
    }
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i);
      if (key?.startsWith(`${META_PREFIX}:`)) localStorage.removeItem(key);
    }
  } catch {
    /* ignore */
  }
}
