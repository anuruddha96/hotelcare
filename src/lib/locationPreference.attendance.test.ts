// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestAttendanceLocation, getBrowserPermissionState, saveFix, collectLocationDiagnostics } from './locationPreference';

function mockDevice(outcomes: Array<number | 'success'>, permission: PermissionState | null = 'granted') {
  const getCurrentPosition = vi.fn((success: PositionCallback, error: PositionErrorCallback) => {
    const next = outcomes.shift();
    if (next === 'success') success({ coords: { latitude: 47.5, longitude: 19.04 }, timestamp: Date.now() } as GeolocationPosition);
    else error({ code: next ?? 2 } as GeolocationPositionError);
  });
  vi.stubGlobal('navigator', { geolocation: { getCurrentPosition },
    ...(permission ? { permissions: { query: vi.fn().mockResolvedValue({ state: permission }) } } : {}) });
  return getCurrentPosition;
}

describe('attendance location recovery', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it('uses the phone position (recent OS fix allowed) and not the app cache', async () => {
    saveFix({ latitude: 1, longitude: 2 });
    const request = mockDevice(['success']);
    expect(await requestAttendanceLocation()).toMatchObject({ ok: true, fix: { latitude: 47.5, longitude: 19.04 } });
    expect(request).toHaveBeenCalledWith(expect.any(Function), expect.any(Function), expect.objectContaining({ maximumAge: 5 * 60 * 1000, enableHighAccuracy: false }));
  });

  it('retries a timeout using higher accuracy', async () => {
    const request = mockDevice([3, 'success']);
    expect(await requestAttendanceLocation()).toMatchObject({ ok: true });
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1]).toBeDefined();
    expect(request).toHaveBeenLastCalledWith(expect.any(Function), expect.any(Function), expect.objectContaining({ enableHighAccuracy: true }));
  });

  it('does not report a timeout as a blocked browser', async () => {
    mockDevice([3, 3]);
    expect(await requestAttendanceLocation()).toMatchObject({ ok: false, reason: 'timeout' });
  });

  it('distinguishes OS location failures from denied site permission', async () => {
    mockDevice([1], 'granted');
    expect(await requestAttendanceLocation()).toMatchObject({ ok: false, reason: 'unavailable' });
  });

  it('does not retry or bypass a genuinely denied permission', async () => {
    const request = mockDevice([1], 'denied');
    expect(await requestAttendanceLocation()).toMatchObject({ ok: false, reason: 'denied' });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('works on browsers without Permissions API', async () => {
    mockDevice(['success'], null);
    expect(await getBrowserPermissionState()).toBe('prompt');
    expect(await requestAttendanceLocation()).toMatchObject({ ok: true });
  });

  it('does not create a location when unavailable', async () => {
    mockDevice([2, 2]);
    expect(await requestAttendanceLocation()).toMatchObject({ ok: false, reason: 'unavailable' });
  });

  it('reports attempts and site permission so support can see the cause', async () => {
    mockDevice([1], 'granted');
    const result = await requestAttendanceLocation();
    expect(result.ok).toBe(false);
    if (result.ok !== false) return;
    expect(result.permission).toBe('granted');
    expect(result.attempts).toEqual([expect.objectContaining({ highAccuracy: false, outcome: 'denied', code: 1 })]);
    const d = collectLocationDiagnostics(result);
    expect(d).toMatchObject({ reason: 'unavailable', site_permission: 'granted' });
    expect(d.attempts).toHaveLength(1);
  });

  it('records both attempts when the phone times out twice', async () => {
    mockDevice([3, 3]);
    const result = await requestAttendanceLocation();
    expect(result.attempts.map(a => a.code)).toEqual([3, 3]);
  });
});
