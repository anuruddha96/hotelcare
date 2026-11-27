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
  if (typeof navigator === 'undefined' || !navigator.geolocation) return 'unsupported';
  if (!navigator.permissions) return 'prompt';
  try {
    const status = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
    cachedPermState = status.state;
    return status.state;
  } catch { return 'prompt'; }
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

export type AttendanceLocationFailure = 'denied' | 'unsupported' | 'timeout' | 'unavailable';

export type AttendanceLocationAttempt = {
  highAccuracy: boolean;
  outcome: 'ok' | AttendanceLocationFailure;
  /** Native GeolocationPositionError code (1 denied, 2 unavailable, 3 timeout). */
  code?: number;
  ms: number;
};

export type AttendanceLocationResult =
  | { ok: true; fix: LocationFix; attempts: AttendanceLocationAttempt[] }
  | { ok: false; reason: AttendanceLocationFailure; attempts: AttendanceLocationAttempt[];
      /** Site permission as reported by the browser when the failure happened. */
      permission?: LocationPermissionState };

type SingleAttempt =
  | { ok: true; fix: LocationFix; attempt: AttendanceLocationAttempt }
  | { ok: false; reason: AttendanceLocationFailure; attempt: AttendanceLocationAttempt };

// A position the phone itself measured in the last few minutes is still the
// staff member's real location (it comes from the OS, not from our app cache).
// Accepting it is what makes indoor/basement check-ins reliable; forcing a
// brand-new fix (maximumAge 0) made phones without a GPS view time out.
const OS_FIX_MAX_AGE_MS = 5 * 60 * 1000;

function acquireAttendancePosition(highAccuracy: boolean): Promise<SingleAttempt> {
  const started = Date.now();
  const attempt = (outcome: AttendanceLocationAttempt['outcome'], code?: number): AttendanceLocationAttempt =>
    ({ highAccuracy, outcome, ...(code !== undefined ? { code } : {}), ms: Date.now() - started });
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve({ ok: false, reason: 'unsupported', attempt: attempt('unsupported') });
      return;
    }
    try {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude } = pos.coords;
          if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
              Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
            resolve({ ok: false, reason: 'unavailable', attempt: attempt('unavailable') });
            return;
          }
          resolve({ ok: true, attempt: attempt('ok'), fix: {
            latitude, longitude,
            address: `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`,
            ts: pos.timestamp || Date.now(),
          } });
        },
        (err) => {
          const reason: AttendanceLocationFailure =
            err.code === 1 ? 'denied' : err.code === 3 ? 'timeout' : 'unavailable';
          resolve({ ok: false, reason, attempt: attempt(reason, err.code) });
        },
        highAccuracy
          ? { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
          : { enableHighAccuracy: false, timeout: 8000, maximumAge: OS_FIX_MAX_AGE_MS }
      );
    } catch {
      resolve({ ok: false, reason: 'unavailable', attempt: attempt('unavailable') });
    }
  });
}

/** Explicit attendance action. Try a network-assisted fix first (useful indoors),
 * then GPS for transient failures. Never reuse app-cached coordinates for sign-in.
 * Worst case the staff member waits about 20 seconds before being offered
 * temporary access; the attempts are returned so support can see what failed. */
export async function requestAttendanceLocation(): Promise<AttendanceLocationResult> {
  const attempts: AttendanceLocationAttempt[] = [];
  let single = await acquireAttendancePosition(false);
  attempts.push(single.attempt);
  if (single.ok === false && (single.reason === 'timeout' || single.reason === 'unavailable')) {
    single = await acquireAttendancePosition(true);
    attempts.push(single.attempt);
  }
  if (single.ok === true) {
    setOptIn(true);
    saveFix(single.fix);
    cachedPermState = 'granted';
    emit('granted');
    return { ok: true, fix: single.fix, attempts };
  }
  const permission = await getBrowserPermissionState();
  if (single.reason === 'denied') {
    // Android may report code 1 even though site permission is granted (e.g.
    // the Chrome app lost its Android location permission, or "only this time"
    // expired). Don't send staff into a site-settings loop.
    if (permission === 'granted') return { ok: false, reason: 'unavailable', attempts, permission };
    cachedPermState = 'denied';
    emit('denied');
  }
  return { ok: false, reason: single.reason, attempts, permission };
}

/** Plain facts about the device/browser sent with a location-failure alert so
 *  support can see the cause without asking the staff member anything. */
export function collectLocationDiagnostics(result: Extract<AttendanceLocationResult, { ok: false }>) {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  let standalone = false;
  try { standalone = window.matchMedia?.('(display-mode: standalone)').matches ?? false; } catch { /* ignore */ }
  return {
    reason: result.reason,
    site_permission: result.permission ?? null,
    attempts: result.attempts,
    user_agent: nav?.userAgent?.slice(0, 300) ?? null,
    online: nav?.onLine ?? null,
    installed_app: standalone,
    secure_context: typeof window !== 'undefined' ? window.isSecureContext : null,
    app_opt_in: getOptIn(),
  };
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
