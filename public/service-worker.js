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

// Click handler
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === self.registration.scope && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow('/');
      }
    })
  );
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
