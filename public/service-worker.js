// Service Worker for persistent Hotel Care notifications
const CACHE_NAME = 'hotelcare-v2';
const BRAND_ICON = '/icon-192.png';
const BRAND_BADGE = '/icon-maskable-512.png';

// Install
self.addEventListener('install', (event) => {
  console.log('Service Worker installing...');
  self.skipWaiting();
});

// Activate
self.addEventListener('activate', (event) => {
  console.log('Service Worker activating...');
  event.waitUntil(clients.claim());
});

// Push notification (background)
self.addEventListener('push', (event) => {
  let notificationData = {
    title: 'Hotel Care',
    body: 'You have a new notification',
    icon: BRAND_ICON,
    badge: BRAND_BADGE,
    tag: 'hotel-notification',
    requireInteraction: true,
    vibrate: [200, 100, 200],
  };

  if (event.data) {
    try {
      const data = event.data.json();
      notificationData = {
        ...notificationData,
        title: data.title || notificationData.title,
        body: data.body || notificationData.body,
        tag: data.tag || notificationData.tag,
        data: data.data || {},
      };
    } catch (e) {
      notificationData.body = event.data.text();
    }
  }

  event.waitUntil(
    self.registration.showNotification(notificationData.title, notificationData)
  );
});

// Notification clicks now respect the room-specific URL embedded by the app.
// Reuse an existing Hotel Care window when possible, navigate it to the exact
// room target, then focus it. This works for both foreground-created
// notifications and real Push API notifications that carry data.url.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const targetUrl = data.url || self.registration.scope;

  event.waitUntil((async () => {
    const clientList = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    let targetOrigin = null;
    try {
      targetOrigin = new URL(targetUrl, self.registration.scope).origin;
    } catch (_) {
      targetOrigin = new URL(self.registration.scope).origin;
    }

    for (const client of clientList) {
      try {
        if (new URL(client.url).origin !== targetOrigin) continue;

        if ('navigate' in client && client.url !== targetUrl) {
          await client.navigate(targetUrl);
        }
        if ('focus' in client) await client.focus();
        client.postMessage({ type: 'HOTELCARE_NOTIFICATION_CLICK', data });
        return;
      } catch (error) {
        console.log('Could not reuse Hotel Care window for notification:', error);
      }
    }

    if (clients.openWindow) {
      await clients.openWindow(targetUrl);
    }
  })());
});

// Foreground -> SW message bridge
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
    const { title, body, data, tag } = event.data;
    self.registration.showNotification(title || 'Hotel Care', {
      body,
      icon: BRAND_ICON,
      badge: BRAND_BADGE,
      tag: tag || 'hotel-notification',
      requireInteraction: true,
      vibrate: [200, 100, 200],
      data,
    });
  }
});
