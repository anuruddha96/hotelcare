import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { ensurePushSubscription, removePushSubscription } from '@/lib/pushSubscriptionManager';
import { useAuth } from './useAuth';

interface NotificationPreferences {
  browser_notifications_enabled: boolean;
  sound_notifications_enabled: boolean;
  banner_permanently_hidden: boolean;
}

const DISMISSED_KEY_PREFIX = 'rdhotels.notifications.bannerDismissed:';
const PREFERENCES_EVENT = 'hc:notification-preferences-changed';
const DISMISSAL_EVENT = 'hc:notification-banner-dismissed';
const DEFAULT_PREFERENCES: NotificationPreferences = {
  browser_notifications_enabled: false,
  sound_notifications_enabled: true,
  banner_permanently_hidden: false,
};

export function useNotificationPreferences() {
  const { user } = useAuth();
  const [preferences, setPreferences] = useState<NotificationPreferences>({
    browser_notifications_enabled: false,
    sound_notifications_enabled: true,
    banner_permanently_hidden: false
  });
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  // Settings and the banner use separate hook instances. Keep their local state
  // in sync without refetching preferences on every render or browser focus.
  useEffect(() => {
    setBannerDismissed(false);
    if (!user?.id) return;
    const key = `${DISMISSED_KEY_PREFIX}${user.id}`;
    try { setBannerDismissed(localStorage.getItem(key) === 'true'); } catch { /* Storage can be unavailable. */ }
    const onPreferences = (event: Event) => {
      const detail = (event as CustomEvent<{ userId: string; updates: Partial<NotificationPreferences> }>).detail;
      if (detail.userId === user.id) setPreferences(previous => ({ ...previous, ...detail.updates }));
    };
    const onDismissal = (event: Event) => {
      const detail = (event as CustomEvent<{ userId: string; dismissed: boolean }>).detail;
      if (detail.userId === user.id) setBannerDismissed(detail.dismissed);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === key) setBannerDismissed(event.newValue === 'true');
    };
    window.addEventListener(PREFERENCES_EVENT, onPreferences);
    window.addEventListener(DISMISSAL_EVENT, onDismissal);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(PREFERENCES_EVENT, onPreferences);
      window.removeEventListener(DISMISSAL_EVENT, onDismissal);
      window.removeEventListener('storage', onStorage);
    };
  }, [user?.id]);

  // Load preferences from database
  useEffect(() => {
    setPreferences(DEFAULT_PREFERENCES);
    setPreferencesLoaded(false);
    if (!user?.id) {
      return;
    }
    let cancelled = false;

    const loadPreferences = async () => {
      try {
        const { data, error } = await supabase
          .from('notification_preferences')
          .select('browser_notifications_enabled, sound_notifications_enabled, banner_permanently_hidden')
          .eq('user_id', user.id)
          .maybeSingle();

        if (cancelled) return;

        if (error) {
          console.error('Error loading notification preferences:', error);
          setPreferencesLoaded(true);
          return;
        }

        if (data) {
          setPreferences({
            browser_notifications_enabled: data.browser_notifications_enabled ?? false,
            sound_notifications_enabled: data.sound_notifications_enabled ?? true,
            banner_permanently_hidden: data.banner_permanently_hidden ?? false
          });
          // Also sync localStorage if banner is permanently hidden in DB
          if (data.banner_permanently_hidden) {
            setBannerDismissed(true);
            try { localStorage.setItem(`${DISMISSED_KEY_PREFIX}${user.id}`, 'true'); } catch { /* In-memory dismissal still works. */ }
          }
        }
        setPreferencesLoaded(true);
      } catch (error) {
        if (cancelled) return;
        console.error('Error loading notification preferences:', error);
        setPreferencesLoaded(true);
      }
    };

    loadPreferences();
    return () => { cancelled = true; };
  }, [user?.id]);

  // Update preferences in database and keep the real background Push endpoint in
  // sync. Turning notifications off removes this browser/device subscription;
  // turning them on attaches one when permission has already been granted.
  const updatePreferences = useCallback(async (updates: Partial<NotificationPreferences>) => {
    if (!user?.id) return false;

    try {
      const { error } = await supabase
        .from('notification_preferences')
        .upsert({
          user_id: user.id,
          ...preferences,
          ...updates,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'user_id'
        });

      if (error) {
        console.error('Error updating notification preferences:', error);
        return false;
      }

      // Keep the UI in sync even if Web Push registration fails. Otherwise a
      // saved opt-in can look disabled, leaving staff unable to diagnose it.
      setPreferences(prev => ({ ...prev, ...updates }));
      window.dispatchEvent(new CustomEvent(PREFERENCES_EVENT, { detail: { userId: user.id, updates } }));

      if (updates.browser_notifications_enabled === false) {
        try {
          await removePushSubscription();
        } catch (pushError) {
          console.warn('Could not remove background notification subscription:', pushError);
        }
      } else if (
        updates.browser_notifications_enabled === true
        && typeof Notification !== 'undefined'
        && Notification.permission === 'granted'
      ) {
        try {
          const subscription = await ensurePushSubscription();
          if (!subscription) throw new Error('Web Push endpoint not registered');
        } catch (pushError) {
          console.error('Could not register background notification subscription:', pushError);
          return false;
        }
      }

      return true;
    } catch (error) {
      console.error('Error updating notification preferences:', error);
      return false;
    }
  }, [user?.id, preferences]);

  // Dismiss the banner permanently for this user
  const dismissBanner = useCallback(() => {
    if (user?.id) {
      setBannerDismissed(true);
      window.dispatchEvent(new CustomEvent(DISMISSAL_EVENT, { detail: { userId: user.id, dismissed: true } }));
      try { localStorage.setItem(`${DISMISSED_KEY_PREFIX}${user.id}`, 'true'); } catch { /* Do not block dismissal. */ }
    }
  }, [user?.id]);

  // Clear the banner dismissal (e.g., if user wants to see it again)
  const clearBannerDismissal = useCallback(() => {
    if (user?.id) {
      setBannerDismissed(false);
      window.dispatchEvent(new CustomEvent(DISMISSAL_EVENT, { detail: { userId: user.id, dismissed: false } }));
      try { localStorage.removeItem(`${DISMISSED_KEY_PREFIX}${user.id}`); } catch { /* In-memory state still updates. */ }
    }
  }, [user?.id]);

  return {
    preferences,
    preferencesLoaded,
    updatePreferences,
    bannerDismissed,
    dismissBanner,
    clearBannerDismissal
  };
}
