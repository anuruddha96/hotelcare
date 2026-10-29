import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffect, useState } from 'react';
import { NotificationPermissionBanner } from '../NotificationPermissionBanner';
import { NotificationSetupHelp } from '../NotificationSetupHelp';
import { SettingsDialog } from '../SettingsDialog';
import { useNotificationPreferences } from '@/hooks/useNotificationPreferences';
import { notificationSetupTranslations } from '@/lib/notification-setup-translations';
import { notificationTranslations } from '@/lib/notification-translations';
import { getNotificationEnvironment } from '@/lib/notificationPlatform';

const mocks = vi.hoisted(() => ({
  user: { id: 'staff-1' },
  permission: 'default' as NotificationPermission,
  preferences: { browser_notifications_enabled: false, sound_notifications_enabled: true, banner_permanently_hidden: false },
  load: vi.fn(), save: vi.fn(), subscribe: vi.fn(), request: vi.fn(),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: mocks.user, profile: {} }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({
  language: 'en', t: (key: string) => notificationSetupTranslations.en[key] || notificationTranslations.en[key] || key,
}) }));
vi.mock('@/hooks/useNotifications', () => ({ useNotifications: () => ({
  notificationPermission: mocks.permission,
  requestNotificationPermission: mocks.request,
  ensureAudioUnlocked: vi.fn(), playNotificationSound: vi.fn(), showNotification: vi.fn(),
}) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.load }) }), upsert: mocks.save }),
} }));
vi.mock('@/lib/pushSubscriptionManager', () => ({
  ensurePushSubscription: mocks.subscribe, removePushSubscription: vi.fn(),
}));

function device(ua: string, standalone = false, platform = '', maxTouchPoints = 0) {
  Object.defineProperty(navigator, 'userAgent', { configurable: true, value: ua });
  Object.defineProperty(navigator, 'platform', { configurable: true, value: platform });
  Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: maxTouchPoints });
  Object.defineProperty(navigator, 'standalone', { configurable: true, value: standalone });
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: {} });
}
function permission(value: NotificationPermission) {
  mocks.permission = value;
  vi.stubGlobal('Notification', { permission: value });
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.user = { id: 'staff-1' };
  mocks.preferences = { browser_notifications_enabled: false, sound_notifications_enabled: true, banner_permanently_hidden: false };
  mocks.load.mockImplementation(async () => ({ data: mocks.preferences, error: null }));
  mocks.save.mockResolvedValue({ error: null });
  mocks.subscribe.mockResolvedValue({ endpoint: 'https://push.example/device' });
  mocks.request.mockResolvedValue(false);
  vi.stubGlobal('PushManager', function PushManager() {});
  device('Mozilla Android Chrome/130.0');
  permission('default');
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('notification banner actions', () => {
  it('dismisses the iOS repair warning immediately while permanent saving is still pending', async () => {
    device('Mozilla iPhone Safari/605.1');
    mocks.preferences.browser_notifications_enabled = true;
    mocks.save.mockReturnValue(new Promise(() => {}));
    render(<NotificationPermissionBanner />);
    await screen.findByRole('button', { name: 'Got It' });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Got It' }));
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(localStorage.getItem('rdhotels.notifications.bannerDismissed:staff-1')).toBe('true');
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ banner_permanently_hidden: true }), expect.anything());
  });

  it('keeps a dismissed iOS warning hidden after remounting', async () => {
    device('Mozilla iPhone Safari/605.1');
    mocks.preferences.browser_notifications_enabled = true;
    const view = render(<NotificationPermissionBanner />);
    fireEvent.click(await screen.findByRole('button', { name: 'Got It' }));
    view.unmount();
    render(<NotificationPermissionBanner />);
    await act(async () => {});
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('opens notification settings for an iPhone browser instead of requesting unavailable permission', async () => {
    device('Mozilla iPhone CriOS/130.0');
    const listener = vi.fn();
    window.addEventListener('hc:open-settings', listener);
    render(<NotificationPermissionBanner />);
    fireEvent.click(await screen.findByRole('button', { name: 'Set up on iPhone / iPad' }));
    expect(mocks.request).not.toHaveBeenCalled();
    expect(listener).toHaveBeenCalledOnce();
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual({ tab: 'notifications' });
    window.removeEventListener('hc:open-settings', listener);
  });

  it('starts the enable action directly from the Android button and dismisses after device registration', async () => {
    mocks.request.mockImplementation(() => { permission('granted'); return Promise.resolve(true); });
    render(<NotificationPermissionBanner />);
    fireEvent.click(await screen.findByRole('button', { name: 'Enable notifications' }));
    expect(mocks.request).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole('region')).not.toBeInTheDocument());
    expect(mocks.subscribe).toHaveBeenCalled();
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ browser_notifications_enabled: true }), expect.anything());
  });

  it('leaves a failed registration actionable and lets X dismiss it', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.preferences.browser_notifications_enabled = true;
    permission('granted');
    mocks.subscribe.mockRejectedValue(new Error('offline'));
    render(<NotificationPermissionBanner />);
    await screen.findByText(notificationSetupTranslations.en['notificationSetup.failed']);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('honors permanent hiding even when an enabled device needs repair', async () => {
    device('Mozilla iPhone Safari/605.1');
    mocks.preferences.browser_notifications_enabled = true;
    mocks.preferences.banner_permanently_hidden = true;
    render(<NotificationPermissionBanner />);
    await act(async () => {});
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('routes denied Android permission to settings without repeatedly requesting it', async () => {
    permission('denied');
    const listener = vi.fn();
    window.addEventListener('hc:open-settings', listener);
    render(<NotificationPermissionBanner />);
    fireEvent.click(await screen.findByRole('button', { name: 'Notification settings' }));
    expect(listener).toHaveBeenCalledOnce();
    expect(mocks.request).not.toHaveBeenCalled();
    window.removeEventListener('hc:open-settings', listener);
  });

  it('allows notification permission from the installed iOS app', async () => {
    device('Mozilla iPhone Safari/605.1', true);
    render(<NotificationPermissionBanner />);
    fireEvent.click(await screen.findByRole('button', { name: 'Enable notifications' }));
    expect(mocks.request).toHaveBeenCalledOnce();
    expect(screen.queryByText(notificationSetupTranslations.en['notificationSetup.iosBrowser'])).not.toBeInTheDocument();
    await act(async () => {});
  });

  it('still dismisses when localStorage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage blocked'); });
    render(<NotificationPermissionBanner />);
    fireEvent.click(await screen.findByRole('button', { name: 'Got It' }));
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });
});

describe('device-specific notification setup', () => {
  it('recognizes an iPad using a desktop user agent', () => {
    device('Mozilla Macintosh Safari/605.1', false, 'MacIntel', 5);
    expect(getNotificationEnvironment()).toMatchObject({ platform: 'ios', needsInstall: true, canRequest: false });
  });

  it('gives Android site and app instructions without iPhone-only advice', () => {
    render(<NotificationSetupHelp permission="denied" />);
    expect(screen.getByText(/In Chrome, open this website/)).toBeInTheDocument();
    expect(screen.getByText(/Android Settings → Apps/)).toBeInTheDocument();
    expect(screen.queryByText(/On your iPhone/)).not.toBeInTheDocument();
  });

  it('shows the iOS installed-app recovery path for blocked notifications', () => {
    device('Mozilla iPhone Safari/605.1', true);
    render(<NotificationSetupHelp permission="denied" />);
    expect(screen.getByText(/Settings → Notifications → HotelCare/)).toBeInTheDocument();
    expect(screen.getByText(/Device settings must be opened manually/)).toBeInTheDocument();
    expect(screen.queryByText(/Android Settings/)).not.toBeInTheDocument();
  });

  it('does not promise a permission prompt when Web Push is unsupported', () => {
    vi.stubGlobal('PushManager', undefined);
    Reflect.deleteProperty(window, 'PushManager');
    expect(getNotificationEnvironment().canRequest).toBe(false);
    render(<NotificationSetupHelp permission="default" />);
    expect(screen.getByText(/Push notifications are unavailable in this browser/)).toBeInTheDocument();
    expect(screen.queryByText(/choose Allow in the system prompt/)).not.toBeInTheDocument();
  });
});

function BannerWithSettings() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const openSettings = () => setOpen(true);
    window.addEventListener('hc:open-settings', openSettings);
    return () => window.removeEventListener('hc:open-settings', openSettings);
  }, []);
  return <><NotificationPermissionBanner /><SettingsDialog open={open} onOpenChange={setOpen} initialTab="notifications" /></>;
}

describe('notification settings destination', () => {
  it('opens the actual notification tab with iOS installation help from the banner', async () => {
    device('Mozilla iPhone Safari/605.1');
    render(<BannerWithSettings />);
    fireEvent.click(await screen.findByRole('button', { name: 'Set up on iPhone / iPad' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'settings.tabNotifications' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText(/keep Open as Web App on/)).toBeInTheDocument();
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('enables Android notifications from Settings and removes the banner behind it', async () => {
    mocks.request.mockImplementation(() => { permission('granted'); return Promise.resolve(true); });
    render(<BannerWithSettings />);
    fireEvent.click(await screen.findByRole('button', { name: 'Notification settings' }));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Enable notifications' }));
    await waitFor(() => expect(screen.queryByRole('region', { hidden: true })).not.toBeInTheDocument());
    expect(mocks.subscribe).toHaveBeenCalled();
    expect(mocks.request).toHaveBeenCalledOnce();
  });
});

describe('notification preferences shared between settings and the banner', () => {
  it('syncs preference changes and dismissal across mounted hook instances', async () => {
    const { result } = renderHook(() => ({ banner: useNotificationPreferences(), settings: useNotificationPreferences() }));
    await waitFor(() => expect(result.current.banner.preferencesLoaded && result.current.settings.preferencesLoaded).toBe(true));
    await act(async () => { await result.current.settings.updatePreferences({ browser_notifications_enabled: true }); });
    expect(result.current.banner.preferences.browser_notifications_enabled).toBe(true);
    act(() => result.current.banner.dismissBanner());
    expect(result.current.settings.bannerDismissed).toBe(true);
    act(() => result.current.settings.clearBannerDismissal());
    expect(result.current.banner.bannerDismissed).toBe(false);
  });
});
