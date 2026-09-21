import { writeCachedRevenueHotPayload, writeCachedRevenuePayload, writeCachedRevenueRoomMetadata } from "@/lib/revenuePayloadCache";

/** Defer large JSON serialization until after the browser has painted the grid.
 * Reads remain synchronous, while writes to each hotel cache coalesce to the
 * newest verified response. Cancelling on logout must be done by the cache
 * library, rather than this helper, before enabling it in a caller.
 */
export function scheduleRevenueCacheWrite(task: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const idle = window as typeof window & {
    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  if (idle.requestIdleCallback) {
    const id = idle.requestIdleCallback(task, { timeout: 1500 });
    return () => idle.cancelIdleCallback?.(id);
  }
  const id = window.setTimeout(task, 30);
  return () => window.clearTimeout(id);
}
