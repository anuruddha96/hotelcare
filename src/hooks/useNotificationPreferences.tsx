import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';

interface NotificationPreferences {
  browser_notifications_enabled: boolean;
  sound_notifications_enabled: boolean;
  banner_permanently_hidden: boolean;
}

const DISMISSED_KEY_PREFIX = 'rdhotels.notifications.bannerDismissed:';

export function useNotificationPreferences() {
  const { user } = useAuth();
  const [preferences, setPreferences] = useState<NotificationPreferences>({
    browser_notifications_enabled: false,
    sound_notifications_enabled: true,
    banner_permanently_hidden: false
  });
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  // Check localStorage for banner dismissal
  useEffect(() => {
    if (user?.id) {
      const dismissed = localStorage.getItem(`${DISMISSED_KEY_PREFIX}${user.id}`);
      setBannerDismissed(dismissed === 'true');
    }
  }, [user?.id]);

  // Load preferences from database
  useEffect(() => {
    if (!user?.id) {
      setPreferencesLoaded(false);
      return;
    }

    const loadPreferences = async () => {
      try {
        const { data, error } = await supabase
          .from('notification_preferences')
          .select('browser_notifications_enabled, sound_notifications_enabled, banner_permanently_hidden')
          .eq('user_id', user.id)
          .maybeSingle();

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
            localStorage.setItem(`${DISMISSED_KEY_PREFIX}${user.id}`, 'true');
            setBannerDismissed(true);
          }
        }
        setPreferencesLoaded(true);
      } catch (error) {
        console.error('Error loading notification preferences:', error);
        setPreferencesLoaded(true);
      }
    };

    loadPreferences();
  }, [user?.id]);

  // Update preferences in database
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

      setPreferences(prev => ({ ...prev, ...updates }));
      return true;
    } catch (error) {
      console.error('Error updating notification preferences:', error);
      return false;
    }
  }, [user?.id, preferences]);

  // Dismiss the banner permanently for this user
  const dismissBanner = useCallback(() => {
    if (user?.id) {
      localStorage.setItem(`${DISMISSED_KEY_PREFIX}${user.id}`, 'true');
      setBannerDismissed(true);
    }
  }, [user?.id]);

  // Clear the banner dismissal (e.g., if user wants to see it again)
  const clearBannerDismissal = useCallback(() => {
    if (user?.id) {
      localStorage.removeItem(`${DISMISSED_KEY_PREFIX}${user.id}`);
      setBannerDismissed(false);
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
