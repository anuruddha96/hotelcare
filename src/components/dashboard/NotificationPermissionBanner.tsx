import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Bell, BellOff, Smartphone, X } from 'lucide-react';
import { useNotifications } from '@/hooks/useNotifications';
import { useNotificationPreferences } from '@/hooks/useNotificationPreferences';
import { useTranslation } from '@/hooks/useTranslation';
import { useAuth } from '@/hooks/useAuth';

export function NotificationPermissionBanner() {
  const { requestNotificationPermission, notificationPermission, ensureAudioUnlocked, playNotificationSound } = useNotifications();
  const { preferences, preferencesLoaded, updatePreferences, bannerDismissed, dismissBanner } = useNotificationPreferences();
  const { t } = useTranslation();
  const { user } = useAuth();
  const [showIOSInstructions, setShowIOSInstructions] = useState(false);
  const [isRequesting, setIsRequesting] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);

  // Detect iOS Safari (not standalone)
  const isIOSSafari = typeof navigator !== 'undefined' && 
    /iPad|iPhone|iPod/.test(navigator.userAgent) && 
    !(window as any).MSStream;
  const isStandalone = typeof window !== 'undefined' && 
    ((window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || 
    (navigator as any).standalone === true);
  const isIOSNonStandalone = isIOSSafari && !isStandalone;

  // Determine if we should show the banner
  const shouldShowBanner = 
    user?.id && // User must be logged in
    preferencesLoaded && // Preferences must be loaded
    !bannerDismissed && // User hasn't dismissed the banner
    !preferences.banner_permanently_hidden && // User hasn't permanently hidden
    !preferences.browser_notifications_enabled && // User hasn't enabled notifications
    notificationPermission !== 'granted'; // Browser hasn't granted permission

  const handleEnableNotifications = async () => {
    setIsRequesting(true);

    // Ensure audio can play on iOS (must be inside user gesture)
    try { ensureAudioUnlocked(); } catch {}

    // If iOS non-standalone, show instructions instead of trying to request
    if (isIOSNonStandalone) {
      setShowIOSInstructions(true);
      setIsRequesting(false);
      return;
    }

    // Request browser permission
    try {
      const granted = await requestNotificationPermission();
      if (granted) {
        // Save preference to database - this permanently hides banner
        await updatePreferences({ 
          browser_notifications_enabled: true,
          banner_permanently_hidden: true 
        });
        // Dismiss banner locally too
        dismissBanner();
        // Play a test sound to confirm
        try { playNotificationSound(); } catch {}
      } else if (notificationPermission === 'denied') {
        // Show instructions for denied state
        setShowIOSInstructions(true);
      }
    } catch (error) {
      console.error('Error requesting notification permission:', error);
    } finally {
      setIsRequesting(false);
    }
  };

  const handleDismiss = async () => {
    // If checkbox is checked, save to database permanently
    if (dontShowAgain) {
      await updatePreferences({ banner_permanently_hidden: true });
    }
    dismissBanner();
  };

  if (!shouldShowBanner) {
    return null;
  }

  return (
    <Card className="mb-4 border-orange-200 bg-orange-50 dark:border-orange-800 dark:bg-orange-900/20">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0">
            {notificationPermission === 'denied' ? (
              <BellOff className="h-5 w-5 text-orange-600" />
            ) : (
              <Bell className="h-5 w-5 text-orange-600" />
            )}
          </div>
          
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-medium text-orange-800 dark:text-orange-200">
              {t('notifications.enableTitle')}
            </h3>
            <p className="mt-1 text-sm text-orange-700 dark:text-orange-300">
              {t('notifications.enableDescription')}
            </p>
            
            {/* iOS instructions or denied state instructions */}
            {(showIOSInstructions || isIOSNonStandalone) && (
              <div className="mt-2 p-2 bg-blue-50 dark:bg-blue-900/20 rounded-md border border-blue-200 dark:border-blue-800">
                <div className="flex items-center gap-2">
                  <Smartphone className="h-4 w-4 text-blue-600" />
                  <span className="text-xs font-medium text-blue-800 dark:text-blue-200">
                    {isIOSNonStandalone 
                      ? t('notifications.iosInstructions')
                      : t('notifications.deniedInstructions')}
                  </span>
                </div>
                <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                  {isIOSNonStandalone 
                    ? t('notifications.iosSteps')
                    : t('notifications.deniedSteps')}
                </p>
              </div>
            )}

            {notificationPermission === 'denied' && !isIOSNonStandalone && (
              <div className="mt-2 p-2 bg-red-50 dark:bg-red-900/20 rounded-md border border-red-200 dark:border-red-800">
                <p className="text-xs text-red-700 dark:text-red-300">
                  {t('notifications.deniedInstructions')}
                </p>
              </div>
            )}

            {/* Don't show again checkbox */}
            <div className="flex items-center gap-2 mt-3">
              <Checkbox 
                id="dont-show-notifications"
                checked={dontShowAgain}
                onCheckedChange={(checked) => setDontShowAgain(checked === true)}
              />
              <label 
                htmlFor="dont-show-notifications" 
                className="text-xs text-muted-foreground cursor-pointer"
              >
                {t('notifications.dontShowAgain')}
              </label>
            </div>
          </div>
          
          <div className="flex gap-2 flex-shrink-0">
            <Button
              size="sm"
              variant="ghost"
              onClick={handleDismiss}
              className="text-xs h-8 w-8 p-0"
              title={t('common.dismiss')}
            >
              <X className="h-4 w-4" />
            </Button>
            {notificationPermission !== 'denied' && !isIOSNonStandalone && (
              <Button
                size="sm"
                onClick={handleEnableNotifications}
                disabled={isRequesting}
                className="text-xs bg-orange-600 hover:bg-orange-700 text-white"
              >
                {isRequesting ? '...' : t('notifications.enable')}
              </Button>
            )}
            {isIOSNonStandalone && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleDismiss}
                className="text-xs"
              >
                {t('common.gotIt')}
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
