import { supabase } from '@/integrations/supabase/client';
import { serviceWorkerManager } from '@/lib/serviceWorkerManager';

// Public VAPID keys are intentionally shipped to browsers. The private key is
// stored only in Supabase Vault and used by the send-push-notification function.
export const HOTELCARE_VAPID_PUBLIC_KEY =
  'BC-vMYcTM4vY9zBEE-9cXCH8TJ-LTXym4pfr7YbPe2VatkZa4fLbKom3NMjPgMb9vwDHaj4MfoU4eWia4xAhMoA';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }

  return outputArray;
}

export function isWebPushSupported(): boolean {
  return typeof window !== 'undefined'
    && 'Notification' in window
    && 'serviceWorker' in navigator
    && 'PushManager' in window;
}

export async function ensurePushSubscription(): Promise<PushSubscription | null> {
  if (!isWebPushSupported()) return null;
  if (Notification.permission !== 'granted') return null;

  await serviceWorkerManager.register();
  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();

  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(HOTELCARE_VAPID_PUBLIC_KEY),
    });
  }

  const json = subscription.toJSON();
  const endpoint = json.endpoint || subscription.endpoint;
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;

  if (!endpoint || !p256dh || !auth) {
    throw new Error('Browser returned an incomplete Web Push subscription');
  }

  const { error } = await (supabase as any).rpc('register_push_subscription', {
    _endpoint: endpoint,
    _p256dh: p256dh,
    _auth: auth,
    _user_agent: navigator.userAgent,
  });

  if (error) {
    throw error;
  }

  return subscription;
}

export async function removePushSubscription(): Promise<boolean> {
  if (!isWebPushSupported()) return false;

  await serviceWorkerManager.register();
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return true;

  try {
    await (supabase as any).rpc('unregister_push_subscription', {
      _endpoint: subscription.endpoint,
    });
  } catch (error) {
    // Still unsubscribe locally if the server cleanup failed. Expired endpoints
    // are also removed automatically by the push sender after a 404/410.
    console.warn('Could not unregister Web Push endpoint from HotelCare', error);
  }

  return subscription.unsubscribe();
}
