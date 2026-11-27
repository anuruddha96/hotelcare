import type { Readiness } from './autoCapture';

/**
 * One camera for every document scan on the page. The check-in guest form,
 * the in-house guest list and express check-in all open the same scan dialog,
 * and they all share this stream.
 *
 * Whether camera access is remembered is the browser's decision: Chrome and
 * Edge keep it after "Allow while visiting the site"; Safari on iPad/iPhone
 * keeps it when the site's Camera setting is "Allow". HotelCare's part is to
 * never cause an extra prompt: a granted stream is shared and kept ready for a
 * minute between guests, so the next scan needs no new getUserMedia call. It is
 * stopped as soon as the page is hidden, and after that minute.
 *
 * The torch (camera flashlight) is used where the camera has one: switched on
 * automatically while the picture stays too dark, and off again on glare.
 */

export const KEEP_READY_MS = 60_000;

export type TorchMode = 'auto' | 'on' | 'off';

/** Per-workstation camera choices; no guest data. */
export interface CameraPrefs {
  torch: TorchMode;
  /** The camera used last time, so the same lens opens again. */
  cameraId: string;
  /** How many times the browser had to ask for camera access on this device. */
  prompts: number;
}

export const DEFAULT_CAMERA_PREFS: CameraPrefs = { torch: 'auto', cameraId: '', prompts: 0 };
const PREFS_KEY = 'hotelcare.reception.camera.v1';

export function parseCameraPrefs(raw: string | null | undefined): CameraPrefs {
  try {
    const parsed = JSON.parse(raw ?? '') as Partial<CameraPrefs> | null;
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_CAMERA_PREFS };
    const prompts = Number(parsed.prompts);
    return {
      torch: parsed.torch === 'on' || parsed.torch === 'off' ? parsed.torch : 'auto',
      cameraId: typeof parsed.cameraId === 'string' && parsed.cameraId.length <= 256 ? parsed.cameraId : '',
      prompts: Number.isInteger(prompts) && prompts > 0 ? Math.min(prompts, 99) : 0,
    };
  } catch {
    return { ...DEFAULT_CAMERA_PREFS };
  }
}

export function loadCameraPrefs(): CameraPrefs {
  try { return parseCameraPrefs(globalThis.localStorage?.getItem(PREFS_KEY)); } catch { return { ...DEFAULT_CAMERA_PREFS }; }
}

export function saveCameraPrefs(prefs: CameraPrefs): void {
  try { globalThis.localStorage?.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* storage blocked: lasts for this visit */ }
}

function updateCameraPrefs(patch: Partial<CameraPrefs>): void {
  saveCameraPrefs({ ...loadCameraPrefs(), ...patch });
}

export function cameraConstraints(cameraId: string, exact = false): MediaStreamConstraints {
  // A USB scanner has no facing mode: ask for that very device.
  if (cameraId && exact) {
    return { audio: false, video: { deviceId: { exact: cameraId }, width: { ideal: 1920 }, height: { ideal: 1080 } } };
  }
  return {
    audio: false,
    video: {
      ...(cameraId ? { deviceId: { ideal: cameraId } } : {}),
      facingMode: { ideal: 'environment' },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    },
  };
}

export type CameraPermission = 'granted' | 'prompt' | 'denied' | 'unknown';

/** The browser's current answer for this site, where it tells (Chrome, Edge, Safari 16+). */
export async function cameraPermission(): Promise<CameraPermission> {
  try {
    const status = await navigator.permissions?.query({ name: 'camera' as PermissionName });
    const state = status?.state;
    return state === 'granted' || state === 'prompt' || state === 'denied' ? state : 'unknown';
  } catch {
    return 'unknown';
  }
}

/** iPhone, iPod or iPad (iPadOS reports itself as a Mac with a touch screen). */
export function isAppleTouchDevice(nav: Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'> = navigator): boolean {
  return /iP(hone|ad|od)/.test(nav.userAgent) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
}

interface Session {
  stream: MediaStream | null;
  pending: Promise<MediaStream> | null;
  stopTimer: ReturnType<typeof setTimeout> | null;
  /** A scan dialog currently wants the camera. */
  wanted: boolean;
  torchOn: boolean;
  /** The last acquisition needed a new answer from the browser. */
  asked: boolean;
  listening: boolean;
  /** Device chosen as scanner: opened by exact id. */
  exactId: string;
}

const session: Session = { stream: null, pending: null, stopTimer: null, wanted: false, torchOn: false, asked: false, listening: false, exactId: '' };

function liveTrack(): MediaStreamTrack | null {
  return session.stream?.getVideoTracks().find((track) => track.readyState === 'live') ?? null;
}

function clearStopTimer(): void {
  if (session.stopTimer !== null) clearTimeout(session.stopTimer);
  session.stopTimer = null;
}

function listenForHiddenPage(): void {
  if (session.listening || typeof document === 'undefined') return;
  session.listening = true;
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopCamera(); });
}

async function openStream(): Promise<MediaStream> {
  const prefs = loadCameraPrefs();
  const before = await cameraPermission();
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(cameraConstraints(prefs.cameraId, !!prefs.cameraId && prefs.cameraId === session.exactId));
  } catch (error) {
    // A remembered camera that is gone: open the default rear camera instead.
    const name = (error as { name?: string })?.name;
    if (!prefs.cameraId || (name !== 'OverconstrainedError' && name !== 'NotFoundError')) throw error;
    stream = await navigator.mediaDevices.getUserMedia(cameraConstraints(''));
  }
  session.asked = before === 'prompt';
  const cameraId = stream.getVideoTracks()[0]?.getSettings?.().deviceId ?? '';
  updateCameraPrefs({ cameraId: cameraId || prefs.cameraId, prompts: session.asked ? prefs.prompts + 1 : prefs.prompts });
  return stream;
}

/** The shared stream. A live one is reused without asking the browser again. */
export function acquireCamera(): Promise<MediaStream> {
  clearStopTimer();
  session.wanted = true;
  if (session.stream && liveTrack()) {
    session.asked = false;
    session.stream.getVideoTracks().forEach((track) => { track.enabled = true; });
    return Promise.resolve(session.stream);
  }
  if (session.pending) return session.pending;
  if (!navigator.mediaDevices?.getUserMedia) return Promise.reject(new Error('Camera unavailable'));
  listenForHiddenPage();
  session.pending = openStream().then((stream) => {
    session.stream?.getTracks().forEach((track) => track.stop());
    session.stream = stream;
    session.torchOn = false;
    // The dialog closed while the browser was asking: keep it briefly, then stop.
    if (!session.wanted) releaseCamera();
    return stream;
  }).finally(() => { session.pending = null; });
  return session.pending;
}

/**
 * Open this camera (or camera-type scanner) from now on. A stream from another
 * device is stopped so the next acquireCamera() opens the chosen one; access
 * already granted to the site covers every camera, so no new prompt appears.
 */
export function chooseCameraDevice(deviceId: string, scanner = false): void {
  session.exactId = scanner ? deviceId : '';
  updateCameraPrefs({ cameraId: deviceId });
  const current = liveTrack()?.getSettings?.().deviceId ?? '';
  if (session.stream && current !== deviceId) stopCamera();
}

/** Whether the last acquisition needed a new answer from the browser. */
export function cameraWasAsked(): boolean {
  return session.asked;
}

/** Between the two sides of a card and while a capture is processed: light off, frames off, stream kept. */
export function holdCamera(): void {
  void setTorch(false);
  session.stream?.getVideoTracks().forEach((track) => { track.enabled = false; });
}

/** The scan dialog closed: keep the stream ready for the next guest, then stop it. */
export function releaseCamera(delayMs = KEEP_READY_MS): void {
  session.wanted = false;
  holdCamera();
  clearStopTimer();
  if (session.stream) session.stopTimer = setTimeout(stopCamera, delayMs);
}

export function stopCamera(): void {
  clearStopTimer();
  session.stream?.getTracks().forEach((track) => track.stop());
  session.stream = null;
  session.torchOn = false;
}

/** True when the open camera has a flashlight the page may switch. */
export function torchAvailable(): boolean {
  const track = liveTrack();
  if (!track || typeof track.getCapabilities !== 'function') return false;
  try {
    return (track.getCapabilities() as MediaTrackCapabilities & { torch?: boolean }).torch === true;
  } catch {
    return false;
  }
}

/**
 * Switch the flashlight. The state is tracked here because some iOS versions
 * report a stale value in getSettings(). Returns whether the light is now as asked.
 */
export async function setTorch(on: boolean): Promise<boolean> {
  if (session.torchOn === on) return true;
  const track = liveTrack();
  if (!track) { session.torchOn = false; return !on; }
  if (on && !torchAvailable()) return false;
  try {
    await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
    session.torchOn = on;
    return true;
  } catch {
    return false;
  }
}

export function torchIsOn(): boolean {
  return session.torchOn;
}

export interface AutoTorch {
  darkTicks: number;
  glareTicks: number;
  /** The light caused glare during this attempt: leave it off. */
  locked: boolean;
}

export const AUTO_TORCH_START: AutoTorch = { darkTicks: 0, glareTicks: 0, locked: false };

/**
 * One camera check (about every 180 ms): should the light be on?
 * Automatic mode turns it on after about 0.7 s of a too-dark picture, and off
 * for the rest of the attempt if the picture then washes out.
 */
export function autoTorchStep(mode: TorchMode, on: boolean, readiness: Readiness, state: AutoTorch): { on: boolean; state: AutoTorch } {
  if (mode !== 'auto') return { on: mode === 'on', state: AUTO_TORCH_START };
  const darkTicks = readiness === 'tooDark' ? state.darkTicks + 1 : 0;
  const glareTicks = readiness === 'tooMuchGlare' ? state.glareTicks + 1 : 0;
  if (on && glareTicks >= 3) return { on: false, state: { darkTicks: 0, glareTicks: 0, locked: true } };
  if (!on && !state.locked && darkTicks >= 4) return { on: true, state: { darkTicks: 0, glareTicks: 0, locked: false } };
  return { on, state: { darkTicks, glareTicks, locked: state.locked } };
}

export function nextTorchMode(mode: TorchMode): TorchMode {
  return mode === 'auto' ? 'on' : mode === 'on' ? 'off' : 'auto';
}

/** Test helper: forget the shared stream without touching any device. */
export function resetCameraSessionForTests(): void {
  clearStopTimer();
  session.stream = null;
  session.pending = null;
  session.wanted = false;
  session.torchOn = false;
  session.asked = false;
  session.exactId = '';
}
