export type NotificationPlatform = 'ios' | 'android' | 'desktop';

/** iPadOS can identify itself as a Mac. Browser brand does not remove iOS's install requirement. */
export function getNotificationEnvironment() {
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const platform: NotificationPlatform = isIOS ? 'ios' : /Android/.test(ua) ? 'android' : 'desktop';
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches === true
    || window.matchMedia?.('(display-mode: fullscreen)').matches === true
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const supported = 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
  const needsInstall = platform === 'ios' && !standalone;

  return {
    platform,
    standalone,
    supported,
    needsInstall,
    canRequest: supported && !needsInstall,
    androidChrome: /Chrome\//.test(ua) && !/SamsungBrowser|EdgA|OPR\//.test(ua),
  };
}

/** Opens the existing app settings; browsers cannot reliably deep-link into OS permission settings. */
export function openNotificationSettings() {
  window.dispatchEvent(new CustomEvent('hc:open-settings', { detail: { tab: 'notifications' } }));
}
