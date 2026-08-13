import { useEffect, useMemo, useRef, useState } from "react";

/**
 * "Have I seen this pickup before?"
 *
 * We remember when each property's revenue screen was last active in this
 * browser. Anything that arrived after that moment is new to the user, so it
 * gets a New marker; anything older was already on screen last time and stays
 * quiet. The stored stamp keeps ticking while the tab is open, so the next
 * visit only highlights what genuinely arrived in between.
 */
const KEY = (hotelId: string) => `hc.pickupSeen.${hotelId}`;
const HEARTBEAT_MS = 60_000;

function readStamp(hotelId: string): number | null {
  try {
    const raw = window.localStorage.getItem(KEY(hotelId));
    const value = raw ? Date.parse(raw) : NaN;
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function writeStamp(hotelId: string) {
  try {
    window.localStorage.setItem(KEY(hotelId), new Date().toISOString());
  } catch {
    /* storage disabled — the marker simply falls back to "nothing is new" */
  }
}

export function usePickupSeenSince(hotelId: string | null | undefined): number | null {
  const [since, setSince] = useState<number | null>(null);
  const captured = useRef<string | null>(null);

  useEffect(() => {
    if (!hotelId) { setSince(null); return; }
    if (captured.current !== hotelId) {
      captured.current = hotelId;
      setSince(readStamp(hotelId));
    }
    writeStamp(hotelId);
    const tick = window.setInterval(() => {
      if (document.visibilityState === "visible") writeStamp(hotelId);
    }, HEARTBEAT_MS);
    const onHide = () => writeStamp(hotelId);
    window.addEventListener("pagehide", onHide);
    return () => {
      window.clearInterval(tick);
      window.removeEventListener("pagehide", onHide);
      writeStamp(hotelId);
    };
  }, [hotelId]);

  return since;
}

/** True when this event landed after the user's previous visit to the property. */
export function useIsNewSince(since: number | null) {
  return useMemo(
    () => (at: string | null | undefined) => {
      if (!since || !at) return false;
      const stamp = Date.parse(at);
      return Number.isFinite(stamp) && stamp > since;
    },
    [since],
  );
}
