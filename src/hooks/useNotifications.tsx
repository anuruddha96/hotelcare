import { useEffect, useCallback, useState, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useAuth } from './useAuth';
import { useTranslation } from './useTranslation';
import { serviceWorkerManager } from '@/lib/serviceWorkerManager';
import { ensurePushSubscription } from '@/lib/pushSubscriptionManager';
import { getNotificationEnvironment } from '@/lib/notificationPlatform';
import { resolveHotelKeys } from '@/lib/hotelKeys';
import {
  canReceiveHousekeepingOperationalNotifications,
  isExecutiveRole,
} from '@/lib/notificationAudience';

// Add CSS for flash animation (only once)
if (typeof document !== 'undefined' && !document.getElementById('notification-flash-style')) {
  const style = document.createElement('style');
  style.id = 'notification-flash-style';
  style.textContent = `
    @keyframes flash {
      0% { background-color: transparent; }
      50% { background-color: rgba(59, 130, 246, 0.1); }
      100% { background-color: transparent; }
    }
  `;
  document.head.appendChild(style);
}

let sharedAudioContext: (AudioContext & { close?: () => Promise<void> }) | null = null;
let serviceWorkerRegistered = false;

export function useNotifications() {
  const { user, profile } = useAuth();
  const { t } = useTranslation();
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>('default');
  const initRef = useRef(false);

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;

    if ('Notification' in window) {
      setNotificationPermission(Notification.permission);
    }

    if (!serviceWorkerRegistered) {
      serviceWorkerRegistered = true;
      serviceWorkerManager.register().then((registration) => {
        if (registration) console.log('Service Worker registered for notifications');
      });
    }
  }, []);

  // Each screen has its own hook instance. Refresh them after a system prompt
  // and when returning from iOS / Android Settings; no page reload is required.
  useEffect(() => {
    const refreshPermission = () => {
      setNotificationPermission(typeof Notification === 'undefined' ? 'default' : Notification.permission);
    };
    const onVisible = () => { if (document.visibilityState === 'visible') refreshPermission(); };
    refreshPermission();
    window.addEventListener('focus', refreshPermission);
    window.addEventListener('pageshow', refreshPermission);
    window.addEventListener('hc:notification-permission-changed', refreshPermission);
    document.addEventListener('visibilitychange', onVisible);
    let disposed = false;
    let permissionStatus: PermissionStatus | undefined;
    // Not all Safari versions expose notification permissions through this API.
    if (navigator.permissions?.query) {
      void navigator.permissions.query({ name: 'notifications' as PermissionName }).then(status => {
        if (disposed) return;
        permissionStatus = status;
        status.addEventListener('change', refreshPermission);
      }).catch(() => { /* Focus / visibility listeners are the fallback. */ });
    }
    return () => {
      disposed = true;
      window.removeEventListener('focus', refreshPermission);
      window.removeEventListener('pageshow', refreshPermission);
      window.removeEventListener('hc:notification-permission-changed', refreshPermission);
      document.removeEventListener('visibilitychange', onVisible);
      permissionStatus?.removeEventListener('change', refreshPermission);
    };
  }, []);

  // Existing users may already have granted browser notification permission from
  // the old foreground-only implementation. Attach the missing PushManager
  // subscription automatically the next time they open HotelCare.
  useEffect(() => {
    if (!user?.id || !('Notification' in window) || Notification.permission !== 'granted') return;

    void ensurePushSubscription().catch((error) => {
      console.warn('Could not register HotelCare background notifications:', error);
    });
  }, [user?.id]);

  const requestNotificationPermission = useCallback(async () => {
    const device = getNotificationEnvironment();
    if (!device.canRequest) {
      toast.info(t(device.needsInstall ? 'notificationSetup.iosBrowser' : 'notificationSetup.unsupported'));
      return false;
    }
    if (!('Notification' in window)) {
      console.log('Browser does not support notifications');
      return false;
    }
    if (Notification.permission === 'granted') {
      setNotificationPermission('granted');
      // A user can grant iOS permission but still have HotelCare notifications
      // disabled in account settings. Let the explicit Enable action save that
      // preference FIRST; trying to subscribe before opt-in is a no-op.
      const { data: preference, error: preferenceError } = await supabase
        .from('notification_preferences')
        .select('browser_notifications_enabled')
        .eq('user_id', user?.id || '')
        .maybeSingle();
      if (preferenceError) {
        console.error('Could not check notification preference:', preferenceError);
        return false;
      }
      if (preference?.browser_notifications_enabled !== true) return true;
      try {
        return !!(await ensurePushSubscription());
      } catch (error) {
        console.warn('iOS push permission granted, but device registration failed:', error);
        toast.error('Notifications are allowed, but this device is not registered. Open Settings → Notifications to repair.');
        return false;
      }
    }
    if (Notification.permission === 'denied') {
      setNotificationPermission('denied');
      console.log('Notifications are blocked by user');
      return false;
    }

    try {
      // Keep this before any await: WebKit / Firefox require the button's gesture.
      const permission = await Notification.requestPermission();
      setNotificationPermission(permission);
      window.dispatchEvent(new Event('hc:notification-permission-changed'));

      if (user?.id && permission === 'granted') {
        // Persist the opt-in BEFORE calling ensurePushSubscription: the
        // subscription manager intentionally rejects opted-out users.
        const { error: saveError } = await supabase
          .from('notification_preferences')
          .upsert({ user_id: user.id, browser_notifications_enabled: true }, { onConflict: 'user_id' });
        if (saveError) {
          console.error('Could not save HotelCare notification opt-in:', saveError);
          toast.error('Notifications were allowed, but HotelCare could not save your preference.');
          return false;
        }
      }

      if (permission === 'granted') {
        try {
          const subscription = await ensurePushSubscription();
          if (!subscription) throw new Error('Device push registration was not completed');
        } catch (error) {
          console.error('Could not enable HotelCare background notifications:', error);
          toast.error('Notification permission was granted, but this device could not be registered for background notifications.');
          return false;
        }

        await serviceWorkerManager.sendNotification(
          'Hotel Care',
          'You will now receive Hotel Care notifications relevant to your role.',
          { timestamp: Date.now(), url: window.location.href }
        );
      }

      return permission === 'granted';
    } catch (error) {
      console.log('Error requesting notification permission:', error);
      return false;
    }
  }, [user?.id, t]);

  const ensureAudioUnlocked = useCallback(() => {
    try {
      if (!sharedAudioContext) {
        sharedAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      sharedAudioContext.resume?.();
      const osc = sharedAudioContext.createOscillator();
      const gain = sharedAudioContext.createGain();
      gain.gain.value = 0.0001;
      osc.connect(gain);
      gain.connect(sharedAudioContext.destination);
      osc.start();
      setTimeout(() => {
        try { osc.stop(); } catch {}
      }, 50);
    } catch (e) {
      console.log('Audio unlock failed:', e);
    }
  }, []);

  const playNotificationSound = useCallback(() => {
    try {
      if ('vibrate' in navigator) navigator.vibrate([200, 100, 200, 100, 200]);

      try {
        if (!sharedAudioContext) {
          sharedAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
        const ctx = sharedAudioContext;
        ctx.resume?.();
        const now = ctx.currentTime;

        const playTone = (freq: number, startTime: number, duration: number, volume: number) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, startTime);
          gain.gain.setValueAtTime(0.001, startTime);
          gain.gain.exponentialRampToValueAtTime(volume, startTime + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(startTime);
          osc.stop(startTime + duration + 0.05);
        };

        playTone(523, now, 0.3, 0.15);
        playTone(1046, now, 0.2, 0.05);
        playTone(659, now + 0.15, 0.35, 0.12);
        playTone(1318, now + 0.15, 0.25, 0.04);
        playTone(784, now + 0.3, 0.3, 0.06);
      } catch (webAudioError) {
        console.log('Web Audio not supported:', webAudioError);
      }
    } catch (error) {
      console.log('Notification sound not supported:', error);
    }
  }, []);

  const showBrowserNotification = useCallback(async (title: string, message: string) => {
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        await serviceWorkerManager.sendNotification(title, message, {
          timestamp: Date.now(),
          url: window.location.href,
        });
        return true;
      } catch (error) {
        console.error('Service Worker notification failed, using fallback:', error);
        try {
          const notification = new Notification(title, {
            body: message,
            icon: '/icon-192.png',
            badge: '/icon-maskable-512.png',
            tag: 'hotel-notification',
          } as any);
          setTimeout(() => notification.close(), 5000);
          return notification;
        } catch (fallbackError) {
          console.log('Direct notification fallback failed:', fallbackError);
        }
      }
    }
    return null;
  }, []);

  const showNotification = useCallback(async (
    message: string,
    type: 'success' | 'info' | 'warning' = 'info',
    title?: string
  ) => {
    playNotificationSound();

    toast[type](message, {
      duration: 4000,
      position: 'top-center',
      style: {
        background: type === 'warning' ? '#FED7AA' : type === 'success' ? '#D1FAE5' : '#DBEAFE',
        color: type === 'warning' ? '#9A3412' : type === 'success' ? '#065F46' : '#1E40AF',
        border: `2px solid ${type === 'warning' ? '#FB923C' : type === 'success' ? '#10B981' : '#3B82F6'}`,
        fontSize: '13px',
        fontWeight: '500',
        maxWidth: '90vw'
      }
    });

    const brandedTitle = title ? `Hotel Care · ${title}` : 'Hotel Care';
    if (title && notificationPermission === 'granted') {
      await showBrowserNotification(brandedTitle, message);
    }
  }, [playNotificationSound, showBrowserNotification, notificationPermission]);

  // Personal room assignments still reach housekeepers/staff, but executive
  // roles are explicitly excluded even if a room is accidentally assigned to
  // their user id. Manager-facing housekeeping events are likewise restricted
  // to the operational manager audience.
  useEffect(() => {
    if (!user?.id || !profile?.assigned_hotel) return;

    let disposed = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const setup = async () => {
      const resolvedKeys = await resolveHotelKeys(profile.assigned_hotel);
      const activeHotelKeys = resolvedKeys.length ? resolvedKeys : [profile.assigned_hotel];
      if (disposed) return;

      const isRoomInActiveHotel = async (roomId?: string | null): Promise<boolean> => {
        if (!roomId || activeHotelKeys.length === 0) return false;
        const { data: room, error } = await supabase
          .from('rooms')
          .select('hotel')
          .eq('id', roomId)
          .maybeSingle();
        if (error || !room?.hotel || disposed) return false;
        return activeHotelKeys.includes(room.hotel);
      };

      const isUserInActiveHotel = async (staffId?: string | null): Promise<boolean> => {
        if (!staffId) return false;
        const { data: staff, error } = await supabase
          .from('profiles')
          .select('assigned_hotel')
          .eq('id', staffId)
          .maybeSingle();
        if (error || !staff?.assigned_hotel || disposed) return false;
        const staffKeys = await resolveHotelKeys(staff.assigned_hotel);
        const comparable = staffKeys.length ? staffKeys : [staff.assigned_hotel];
        return comparable.some((key) => activeHotelKeys.includes(key));
      };

      channel = supabase
        .channel(`notifications-channel-${user.id}-${profile.assigned_hotel}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'room_assignments',
            filter: `assigned_to=eq.${user.id}`
          },
          async (payload) => {
            if (isExecutiveRole(profile?.role)) return;
            const newRecord = payload.new as any;
            if (!(await isRoomInActiveHotel(newRecord.room_id))) return;
            showNotification(
              t('notifications.newAssignment'),
              'info',
              t('notifications.newAssignmentTitle')
            );
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'room_assignments',
            filter: 'status=eq.completed'
          },
          async (payload) => {
            const newRecord = payload.new as any;
            const oldRecord = payload.old as any;

            // Under RLS, Realtime UPDATE old rows may contain only the primary key.
            // A completed room edited hours later must not look like a NEW
            // completion. Accept a real before/after transition, or evidence
            // that completed_at was written with this very database event.
            const committedAt = Date.parse(payload.commit_timestamp || '');
            const completedAt = Date.parse(newRecord.completed_at || '');
            const isFreshCompletion = oldRecord.status != null
              ? oldRecord.status !== 'completed'
              : Number.isFinite(committedAt) && Number.isFinite(completedAt)
                && Math.abs(committedAt - completedAt) < 30_000;

            if (
              isFreshCompletion &&
              newRecord.status === 'completed' &&
              canReceiveHousekeepingOperationalNotifications(profile?.role) &&
              await isRoomInActiveHotel(newRecord.room_id)
            ) {
              showNotification(
                t('notifications.newPendingApproval'),
                'warning',
                t('notifications.newPendingApprovalTitle')
              );
            }
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'break_requests'
          },
          async (payload) => {
            if (!canReceiveHousekeepingOperationalNotifications(profile?.role)) return;
            const newRecord = payload.new as any;
            const staffId = newRecord.user_id || newRecord.requested_by;
            if (!(await isUserInActiveHotel(staffId))) return;
            showNotification(
              t('notifications.newBreakRequest'),
              'info',
              t('notifications.newBreakRequestTitle')
            );
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'break_requests',
            filter: `user_id=eq.${user.id}`
          },
          (payload) => {
            const newRecord = payload.new as any;
            if (newRecord.status === 'approved') {
              showNotification(
                t('notifications.breakRequestApproved'),
                'success',
                t('notifications.breakRequestTitle')
              );
            } else if (newRecord.status === 'rejected') {
              showNotification(
                t('notifications.breakRequestRejected'),
                'warning',
                t('notifications.breakRequestTitle')
              );
            }
          }
        )
        .subscribe();
    };

    void setup();

    return () => {
      disposed = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [user?.id, profile?.role, profile?.assigned_hotel, showNotification, t]);

  return {
    playNotificationSound,
    showNotification,
    requestNotificationPermission,
    notificationPermission,
    ensureAudioUnlocked
  };
}
