import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTO_TORCH_START, KEEP_READY_MS, acquireCamera, autoTorchStep, cameraConstraints, cameraWasAsked, holdCamera,
  isAppleTouchDevice, loadCameraPrefs, nextTorchMode, parseCameraPrefs, releaseCamera, resetCameraSessionForTests,
  setTorch, stopCamera, torchAvailable, torchIsOn, type AutoTorch,
} from './cameraSession';

function fakeTrack(options: { torch?: boolean; deviceId?: string } = {}) {
  const track = {
    kind: 'video',
    enabled: true,
    readyState: 'live' as MediaStreamTrackState,
    stop: vi.fn(() => { track.readyState = 'ended'; }),
    getSettings: () => ({ deviceId: options.deviceId ?? 'rear-cam' }),
    getCapabilities: () => (options.torch ? { torch: true } : {}),
    applyConstraints: vi.fn(async () => undefined),
  };
  return track;
}

function fakeStream(track = fakeTrack()) {
  return { getVideoTracks: () => [track], getTracks: () => [track], track } as unknown as MediaStream & { track: ReturnType<typeof fakeTrack> };
}

let permission: PermissionState = 'prompt';
const getUserMedia = vi.fn();

beforeEach(() => {
  resetCameraSessionForTests();
  localStorage.clear();
  permission = 'prompt';
  getUserMedia.mockReset();
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
  Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query: vi.fn(async () => ({ state: permission })) } });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('camera permission is asked once', () => {
  it('reuses the live stream for the next scan without asking the browser again', async () => {
    const stream = fakeStream();
    getUserMedia.mockResolvedValue(stream);
    expect(await acquireCamera()).toBe(stream);
    expect(cameraWasAsked()).toBe(true);
    releaseCamera();
    expect(stream.track.enabled).toBe(false);
    expect(await acquireCamera()).toBe(stream);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(cameraWasAsked()).toBe(false);
    expect(stream.track.enabled).toBe(true);
  });

  it('keeps the camera ready for a minute after the dialog closes, then stops it', async () => {
    vi.useFakeTimers();
    const stream = fakeStream();
    getUserMedia.mockResolvedValue(stream);
    await acquireCamera();
    releaseCamera();
    vi.advanceTimersByTime(KEEP_READY_MS - 1);
    expect(stream.track.stop).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(stream.track.stop).toHaveBeenCalled();
  });

  it('stops a stream the browser granted after the dialog was already closed', async () => {
    vi.useFakeTimers();
    let resolve!: (stream: MediaStream) => void;
    getUserMedia.mockReturnValue(new Promise<MediaStream>((r) => { resolve = r; }));
    const pending = acquireCamera();
    releaseCamera();
    const stream = fakeStream();
    await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalled());
    resolve(stream);
    await pending;
    expect(stream.track.enabled).toBe(false);
    vi.advanceTimersByTime(KEEP_READY_MS);
    expect(stream.track.stop).toHaveBeenCalled();
  });

  it('opens the remembered camera and counts browser prompts', async () => {
    getUserMedia.mockResolvedValue(fakeStream(fakeTrack({ deviceId: 'desk-cam' })));
    await acquireCamera();
    expect(loadCameraPrefs()).toMatchObject({ cameraId: 'desk-cam', prompts: 1 });
    stopCamera();
    permission = 'granted';
    getUserMedia.mockResolvedValue(fakeStream(fakeTrack({ deviceId: 'desk-cam' })));
    await acquireCamera();
    expect(getUserMedia).toHaveBeenLastCalledWith(cameraConstraints('desk-cam'));
    expect(loadCameraPrefs().prompts).toBe(1);
    expect(cameraWasAsked()).toBe(false);
  });

  it('falls back to the default camera when the remembered one is gone', async () => {
    localStorage.setItem('hotelcare.reception.camera.v1', JSON.stringify({ cameraId: 'unplugged' }));
    const stream = fakeStream();
    getUserMedia.mockRejectedValueOnce(Object.assign(new Error('gone'), { name: 'OverconstrainedError' })).mockResolvedValueOnce(stream);
    expect(await acquireCamera()).toBe(stream);
    expect(getUserMedia).toHaveBeenLastCalledWith(cameraConstraints(''));
  });

  it('asks for the rear camera, never the microphone', () => {
    const constraints = cameraConstraints('cam-1');
    expect(constraints.audio).toBe(false);
    expect(constraints.video).toMatchObject({ deviceId: { ideal: 'cam-1' }, facingMode: { ideal: 'environment' } });
    expect(cameraConstraints('').video).not.toHaveProperty('deviceId');
  });
});

describe('flashlight', () => {
  it('switches the torch only where the camera has one', async () => {
    const plain = fakeStream();
    getUserMedia.mockResolvedValue(plain);
    await acquireCamera();
    expect(torchAvailable()).toBe(false);
    expect(await setTorch(true)).toBe(false);
    expect(plain.track.applyConstraints).not.toHaveBeenCalled();
    stopCamera();

    const lit = fakeStream(fakeTrack({ torch: true }));
    getUserMedia.mockResolvedValue(lit);
    await acquireCamera();
    expect(torchAvailable()).toBe(true);
    expect(await setTorch(true)).toBe(true);
    expect(lit.track.applyConstraints).toHaveBeenCalledWith({ advanced: [{ torch: true }] });
    expect(torchIsOn()).toBe(true);
    holdCamera();
    await vi.waitFor(() => expect(torchIsOn()).toBe(false));
    expect(lit.track.enabled).toBe(false);
  });

  it('turns on after a dark picture and stays off after glare in automatic mode', () => {
    let state: AutoTorch = AUTO_TORCH_START;
    let on = false;
    for (let i = 0; i < 3; i++) ({ on, state } = autoTorchStep('auto', on, 'tooDark', state));
    expect(on).toBe(false);
    ({ on, state } = autoTorchStep('auto', on, 'tooDark', state));
    expect(on).toBe(true);
    ({ on, state } = autoTorchStep('auto', on, 'ready', state));
    expect(on).toBe(true);
    for (let i = 0; i < 3; i++) ({ on, state } = autoTorchStep('auto', on, 'tooMuchGlare', state));
    expect(on).toBe(false);
    for (let i = 0; i < 8; i++) ({ on, state } = autoTorchStep('auto', on, 'tooDark', state));
    expect(on).toBe(false);
  });

  it('follows a manual choice and cycles automatic → on → off', () => {
    expect(autoTorchStep('on', false, 'ready', AUTO_TORCH_START).on).toBe(true);
    expect(autoTorchStep('off', true, 'tooDark', AUTO_TORCH_START).on).toBe(false);
    expect([nextTorchMode('auto'), nextTorchMode('on'), nextTorchMode('off')]).toEqual(['on', 'off', 'auto']);
  });
});

describe('workstation camera settings', () => {
  it('defaults to automatic light and ignores broken values', () => {
    expect(parseCameraPrefs(null)).toEqual({ torch: 'auto', cameraId: '', prompts: 0 });
    expect(parseCameraPrefs('{"torch":"strobe","cameraId":7,"prompts":-3}')).toEqual({ torch: 'auto', cameraId: '', prompts: 0 });
    expect(parseCameraPrefs('{"torch":"off","cameraId":"cam","prompts":2}')).toEqual({ torch: 'off', cameraId: 'cam', prompts: 2 });
  });

  it('recognises iPhones and iPads, including iPadOS desktop mode', () => {
    expect(isAppleTouchDevice({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', platform: 'iPhone', maxTouchPoints: 5 })).toBe(true);
    expect(isAppleTouchDevice({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 5 })).toBe(true);
    expect(isAppleTouchDevice({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 0 })).toBe(false);
    expect(isAppleTouchDevice({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', platform: 'Win32', maxTouchPoints: 0 })).toBe(false);
  });
});
