// Lightweight wrapper around the Geolocation + Permissions APIs that
// remembers the user's choice so we don't prompt on every refresh.
//
// Storage keys:
//   hc.location.optIn   "true" | "false"      — user explicitly opted in / out
//   hc.location.lastFix JSON { latitude, longitude, address?, ts }

const OPT_IN_KEY = 'hc.location.optIn';
const LAST_FIX_KEY = 'hc.location.lastFix';
const FIX_TTL_MS = 10 * 60 * 1000; // 10 minutes

export type LocationFix = {
  latitude: number;
  longitude: number;
  address?: string;
  ts: number;
};

export function getOptIn(): boolean {
  try { return localStorage.getItem(OPT_IN_KEY) === 'true'; } catch { return false; }
}
export function setOptIn(v: boolean) {
  try {
    localStorage.setItem(OPT_IN_KEY, v ? 'true' : 'false');
    if (!v) localStorage.removeItem(LAST_FIX_KEY);
  } catch { /* ignore */ }
}
export function getCachedFix(): LocationFix | null {
  try {
    const raw = localStorage.getItem(LAST_FIX_KEY);
    if (!raw) return null;
    const fix = JSON.parse(raw) as LocationFix;
    if (!fix?.ts || Date.now() - fix.ts > FIX_TTL_MS) return null;
    return fix;
  } catch { return null; }
}
export function saveFix(fix: Omit<LocationFix, 'ts'>) {
  try { localStorage.setItem(LAST_FIX_KEY, JSON.stringify({ ...fix, ts: Date.now() })); } catch { /* ignore */ }
}

export async function getBrowserPermissionState(): Promise<PermissionState | 'unsupported'> {
  if (typeof navigator === 'undefined' || !('permissions' in navigator)) return 'unsupported';
  try {
    const status = await navigator.permissions.query({ name: 'geolocation' as PermissionName });

    return status.state;
  } catch { return 'unsupported'; }
}

/** Resolve a location only when the user has previously opted in.
 *  Uses cache if fresh; otherwise makes one geolocation call. */
export async function resolveLocationIfAllowed(): Promise<LocationFix | null> {
  if (!getOptIn()) return null;
  const cached = getCachedFix();
  if (cached) return cached;
  const state = await getBrowserPermissionState();
  if (state === 'denied') return null;
  return await requestLocationOnce();
}

/** Force a single geolocation request — call only from explicit user gestures
 *  (settings toggle, opt-in card button). Saves opt-in + fix on success. */
export function requestLocationOnce(): Promise<LocationFix | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const fix: LocationFix = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          address: `${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`,
          ts: Date.now(),
        };
        setOptIn(true);
        saveFix(fix);
        resolve(fix);
      },
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: FIX_TTL_MS }
    );
  });
}

export function clearLocation() {
  setOptIn(false);
  try { localStorage.removeItem(LAST_FIX_KEY); } catch { /* ignore */ }
}
