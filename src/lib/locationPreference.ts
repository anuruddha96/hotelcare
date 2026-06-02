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

export type LocationPermissionState = PermissionState | 'unsupported';

let cachedPermState: LocationPermissionState | null = null;
let permListenerInstalled = false;

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

export async function getBrowserPermissionState(): Promise<LocationPermissionState> {
  if (typeof navigator === 'undefined' || !('permissions' in navigator)) return 'unsupported';
  try {
    const status = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
    cachedPermState = status.state;
    return status.state;
  } catch { return 'unsupported'; }
}

export function getPermissionStateCached(): LocationPermissionState | null {
  return cachedPermState;
}

function emit(state: LocationPermissionState) {
  try {
    window.dispatchEvent(new CustomEvent('hc:location-permission-changed', { detail: { state } }));
  } catch { /* ignore */ }
}

/** Silently sync our opt-in flag with the browser's actual permission state.
 *  - granted + no opt-in   → flip opt-in true and refresh fix (no native prompt)
 *  - denied                → clear opt-in + cached fix so UI shows recovery path
 *  Safe to call repeatedly. Subscribes to permission change events once. */
export async function syncOptInFromBrowser(): Promise<LocationPermissionState> {
  if (typeof navigator === 'undefined' || !('permissions' in navigator)) {
    cachedPermState = 'unsupported';
    return 'unsupported';
  }
  try {
    const status = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
    const prev = cachedPermState;
    cachedPermState = status.state;

    if (status.state === 'granted') {
      if (!getOptIn()) setOptIn(true);
      if (!getCachedFix()) {
        // Refresh silently – browser won't prompt because permission is already granted.
        navigator.geolocation?.getCurrentPosition(
          (pos) => saveFix({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            address: `${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`,
          }),
          () => { /* ignore */ },
          { enableHighAccuracy: false, timeout: 8000, maximumAge: FIX_TTL_MS }
        );
      }
    } else if (status.state === 'denied') {
      try { localStorage.removeItem(LAST_FIX_KEY); } catch { /* ignore */ }
      if (getOptIn()) setOptIn(false);
    }

    if (prev !== status.state) emit(status.state);

    if (!permListenerInstalled) {
      permListenerInstalled = true;
      try {
        status.onchange = () => {
          // Re-run sync on any change (granted ↔ denied ↔ prompt).
          void syncOptInFromBrowser();
        };
      } catch { /* ignore */ }
    }
    return status.state;
  } catch {
    cachedPermState = 'unsupported';
    return 'unsupported';
  }
}

/** Resolve a location only when the user has previously opted in.
 *  Uses cache if fresh; never prompts. */
export async function resolveLocationIfAllowed(): Promise<LocationFix | null> {
  if (!getOptIn()) return null;
  const cached = getCachedFix();
  if (cached) return cached;
  const state = await getBrowserPermissionState();
  if (state !== 'granted') return null;
  // Already granted but cache expired – refresh silently.
  return await new Promise<LocationFix | null>((resolve) => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const fix: LocationFix = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          address: `${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`,
          ts: Date.now(),
        };
        saveFix(fix);
        resolve(fix);
      },
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: FIX_TTL_MS }
    );
  });
}

/** Force a single geolocation request — call only from explicit user gestures
 *  (Sign In, settings toggle). Saves opt-in + fix on success. */
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
        cachedPermState = 'granted';
        emit('granted');
        resolve(fix);
      },
      (err) => {
        if (err && err.code === err.PERMISSION_DENIED) {
          cachedPermState = 'denied';
          emit('denied');
        }
        resolve(null);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: FIX_TTL_MS }
    );
  });
}

export function clearLocation() {
  setOptIn(false);
  try { localStorage.removeItem(LAST_FIX_KEY); } catch { /* ignore */ }
}

/** Trigger the global recovery dialog (mounted at root). */
export function openLocationHelp(reason: 'denied' | 'blocked' | 'unsupported' = 'denied') {
  try {
    window.dispatchEvent(new CustomEvent('hc:open-location-help', { detail: { reason } }));
  } catch { /* ignore */ }
}
