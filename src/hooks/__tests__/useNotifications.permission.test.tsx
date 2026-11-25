import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useNotifications } from '../useNotifications';

const mocks = vi.hoisted(() => ({ request: vi.fn(), save: vi.fn(), subscribe: vi.fn(), info: vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'staff-1' }, profile: {} }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: () => ({ upsert: mocks.save }) } }));
vi.mock('@/lib/pushSubscriptionManager', () => ({ ensurePushSubscription: mocks.subscribe }));
vi.mock('@/lib/serviceWorkerManager', () => ({ serviceWorkerManager: {
  register: vi.fn(async () => null), sendNotification: vi.fn(async () => {}),
} }));
vi.mock('sonner', () => ({ toast: { info: mocks.info, error: vi.fn() } }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('Notification', { permission: 'default', requestPermission: mocks.request });
  vi.stubGlobal('PushManager', function PushManager() {});
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: {} });
  Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla Android Chrome/130.0' });
  Object.defineProperty(navigator, 'standalone', { configurable: true, value: false });
  mocks.request.mockImplementation(async () => {
    Object.defineProperty(Notification, 'permission', { configurable: true, value: 'denied' });
    return 'denied';
  });
  mocks.save.mockResolvedValue({ error: null });
  mocks.subscribe.mockResolvedValue({ endpoint: 'https://push.example/device' });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('notification permission lifecycle', () => {
  it('calls the native prompt synchronously before saving and syncs all consumers after denial', async () => {
    const { result } = renderHook(() => ({ first: useNotifications(), second: useNotifications() }));
    let request: Promise<boolean>;
    act(() => {
      request = result.current.first.requestNotificationPermission();
      expect(mocks.request).toHaveBeenCalledOnce();
      expect(mocks.save).not.toHaveBeenCalled();
    });
    await act(async () => { expect(await request!).toBe(false); });
    expect(result.current.first.notificationPermission).toBe('denied');
    expect(result.current.second.notificationPermission).toBe('denied');
  });

  it('refreshes permission after returning from system settings', async () => {
    const { result } = renderHook(() => useNotifications());
    Object.defineProperty(Notification, 'permission', { configurable: true, value: 'granted' });
    act(() => window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(result.current.notificationPermission).toBe('granted'));
  });

  it('persists the opt-in before enrolling the device after Allow', async () => {
    mocks.request.mockImplementation(async () => {
      Object.defineProperty(Notification, 'permission', { configurable: true, value: 'granted' });
      return 'granted';
    });
    const { result } = renderHook(() => useNotifications());
    await act(async () => { expect(await result.current.requestNotificationPermission()).toBe(true); });
    expect(mocks.save).toHaveBeenCalledWith({ user_id: 'staff-1', browser_notifications_enabled: true }, { onConflict: 'user_id' });
    expect(mocks.save.mock.invocationCallOrder[0]).toBeLessThan(mocks.subscribe.mock.invocationCallOrder[0]);
  });

  it('does not call the native prompt from an iOS browser tab', async () => {
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla iPhone Safari/605.1' });
    const { result } = renderHook(() => useNotifications());
    await act(async () => { expect(await result.current.requestNotificationPermission()).toBe(false); });
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.info).toHaveBeenCalledWith('notificationSetup.iosBrowser');
  });
});
