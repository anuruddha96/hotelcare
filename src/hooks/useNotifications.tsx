import { useEffect, useCallback, useState, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useAuth } from './useAuth';
import { useTranslation } from './useTranslation';
import { serviceWorkerManager } from '@/lib/serviceWorkerManager';
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

  const requestNotificationPermission = useCallback(async () => {
    if (!('Notification' in window)) {
      console.log('Browser does not support notifications');
      return false;
    }
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') {
      console.log('Notifications are blocked by user');
      return false;
    }

    try {
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
      const isStandalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || (navigator as any).standalone === true;
      if (isIOS && !isStandalone) {
        toast.info(t('notifications.iosInstructions'));
        setNotificationPermission('default');
        return false;
      }

      const permission = await Notification.requestPermission();
      setNotificationPermission(permission);

      if (user?.id && permission !== 'default') {
        await supabase
          .from('notification_preferences')
          .upsert({
            user_id: user.id,
            browser_notifications_enabled: permission === 'granted'
          });
      }

      if (permission === 'granted') {
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
    } else if (notificationPermission === 'default' && title) {
      try {
        const granted = await requestNotificationPermission();
        if (granted) await showBrowserNotification(brandedTitle, message);
      } catch (error) {
        console.log('Failed to request notification permission:', error);
      }
    }
  }, [playNotificationSound, showBrowserNotification, notificationPermission, requestNotificationPermission]);

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

            if (
              oldRecord.status !== 'completed' &&
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
