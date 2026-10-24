import { useEffect, useRef } from 'react';

/**
 * Realtime events can be missed after a phone sleeps, switches networks or loses
 * its WebSocket. Reconcile the signed-in housekeeper's existing, user-scoped
 * queries while the app is visible, and immediately on returning to the app.
 *
 * This does not open a venue-wide subscription or change any room state.
 * Postgres Changes remains the fast path; this is the bounded recovery path.
 */
export function useHousekeepingLiveRefresh(
  refresh: () => void | Promise<unknown>,
  enabled: boolean,
  intervalMs = 20_000,
) {
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    if (!enabled) return;

    let active = true;
    let inFlight = false;
    let queued = false;

    const reconcile = async () => {
      if (!active || document.hidden || navigator.onLine === false) return;
      if (inFlight) {
        queued = true;
        return;
      }

      inFlight = true;
      try {
        do {
          queued = false;
          await refreshRef.current();
        } while (active && (queued as boolean) && !document.hidden && navigator.onLine !== false);
      } catch (error) {
        // Leave the screen usable; the next tick or focus event will retry.
        console.warn('[Housekeeping] Background refresh failed', error);
      } finally {
        inFlight = false;
      }
    };

    const onResume = () => { void reconcile(); };
    const timer = window.setInterval(onResume, intervalMs);
    window.addEventListener('focus', onResume);
    window.addEventListener('online', onResume);
    document.addEventListener('visibilitychange', onResume);

    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', onResume);
      window.removeEventListener('online', onResume);
      document.removeEventListener('visibilitychange', onResume);
    };
  }, [enabled, intervalMs]);
}
