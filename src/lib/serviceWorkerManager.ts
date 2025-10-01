// Service Worker Manager for persistent notifications

export class ServiceWorkerManager {
  private static instance: ServiceWorkerManager;
  private registration: ServiceWorkerRegistration | null = null;

  private constructor() {}

  static getInstance(): ServiceWorkerManager {
    if (!ServiceWorkerManager.instance) {
      ServiceWorkerManager.instance = new ServiceWorkerManager();
    }
    return ServiceWorkerManager.instance;
  }

  async register(): Promise<ServiceWorkerRegistration | null> {
    if (!('serviceWorker' in navigator)) {
      console.log('Service Workers not supported');
      return null;
    }

    try {
      const registration = await navigator.serviceWorker.register('/service-worker.js', {
        scope: '/'
      });

      console.log('Service Worker registered successfully:', registration);
      this.registration = registration;

      // Wait for the service worker to be ready
      await navigator.serviceWorker.ready;
      console.log('Service Worker is ready');

      return registration;
    } catch (error) {
      console.error('Service Worker registration failed:', error);
      return null;
    }
  }

  async sendNotification(title: string, body: string, data?: any): Promise<void> {
    if (!this.registration) {
      console.log('No service worker registration available');
      return;
    }

    try {
      // Check if we have permission
      if (Notification.permission !== 'granted') {
        console.log('Notification permission not granted');
        return;
      }

      // Send message to service worker to show notification
      if (navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
          type: 'SHOW_NOTIFICATION',
          title,
          body,
          data
        });
      } else {
        // Fallback: show notification directly
        await this.registration.showNotification(title, {
          body,
          icon: '/favicon.ico',
          badge: '/favicon.ico',
          tag: 'hotel-notification',
          requireInteraction: true,
          data
        } as any);
      }
    } catch (error) {
      console.error('Failed to send notification:', error);
    }
  }

  getRegistration(): ServiceWorkerRegistration | null {
    return this.registration;
  }

  async unregister(): Promise<boolean> {
    if (!this.registration) {
      return false;
    }

    try {
      const result = await this.registration.unregister();
      console.log('Service Worker unregistered:', result);
      this.registration = null;
      return result;
    } catch (error) {
      console.error('Service Worker unregistration failed:', error);
      return false;
    }
  }
}

// Export a singleton instance
export const serviceWorkerManager = ServiceWorkerManager.getInstance();
