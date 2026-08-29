/**
 * Per-tab cache of the last verified published Revenue dataset.
 *
 * Big portfolios (SLNT's merged two-account property is ~6 MB of JSON) used to
 * re-download and re-parse everything on every reload, so the page showed its
 * loading screen again and again. We keep the first, smaller window of the
 * dataset in sessionStorage so a returning user paints instantly while the
 * complete horizon reloads quietly in the background.
 *
 * The key always carries the organization slug, so one tenant's data can never
 * be shown under another tenant's header, and everything is dropped at
 * sign-out.
 */

const PREFIX = "revenue_payload";
/** Anything older than this is refetched before it is trusted for painting. */
const MAX_AGE_MS = 30 * 60 * 1000;
/** sessionStorage quota is ~5 MB per origin — never try to store more. */
const MAX_BYTES = 3_200_000;

export interface StoredRevenuePayload<T> {
  payload: T;
  lastSyncAt: string | null;
  lastSyncBy: string | null;
  savedAt: number;
}

const keyFor = (cacheKey: string) => `${PREFIX}:${cacheKey}`;

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

/** Sign-out / identity change: no tenant data may survive into the next session. */
export function clearCachedRevenuePayloads(): void {
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i -= 1) {
      const key = sessionStorage.key(i);
      if (key?.startsWith(`${PREFIX}:`)) sessionStorage.removeItem(key);
    }
  } catch {
    /* ignore */
  }
}
