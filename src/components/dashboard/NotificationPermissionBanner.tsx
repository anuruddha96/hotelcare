import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Bell, BellOff, Smartphone } from 'lucide-react';
import { useNotifications } from '@/hooks/useNotifications';
import { useTranslation } from '@/hooks/useTranslation';

export function NotificationPermissionBanner() {
  const { requestNotificationPermission, notificationPermission, ensureAudioUnlocked, playNotificationSound } = useNotifications();
  const { t } = useTranslation();
  const [isVisible, setIsVisible] = useState(false);
  const [showIOSInstructions, setShowIOSInstructions] = useState(false);

  useEffect(() => {
    // Show banner if notifications are not granted
    if (notificationPermission === 'default' || notificationPermission === 'denied') {
      setIsVisible(true);
    }
    
  // Check if user is on iOS Safari
  const isIOSSafari = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
    setShowIOSInstructions(isIOSSafari);
  }, [notificationPermission]);

  const handleEnableNotifications = async () => {
    // Ensure audio can play on iOS (must be inside user gesture)
    try { ensureAudioUnlocked(); } catch {}

    // Detect iOS Safari context
    const isIOSSafari = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
    const isStandalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || (navigator as any).standalone === true;

    // If running in Safari (not installed PWA), enable loud in-app alerts and show guidance
    if (isIOSSafari && !isStandalone) {
      try { playNotificationSound(); } catch {}
      setShowIOSInstructions(true);
      setIsVisible(false);
      return;
    }

    // Otherwise, request browser permission (PWA or non‑iOS browsers)
    const granted = await requestNotificationPermission();
    if (granted) {
      setIsVisible(false);
      return;
    }

    // If denied or unavailable, surface guidance
    const current = typeof Notification !== 'undefined' ? Notification.permission : notificationPermission;
    if (current === 'denied') {
      alert(t('notifications.enableInBrowserSettings'));
    }
  };
  if (!isVisible || notificationPermission === 'granted') {
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
            
            {showIOSInstructions && (
              <div className="mt-2 p-2 bg-blue-50 dark:bg-blue-900/20 rounded-md border border-blue-200 dark:border-blue-800">
                <div className="flex items-center gap-2">
                  <Smartphone className="h-4 w-4 text-blue-600" />
                  <span className="text-xs font-medium text-blue-800 dark:text-blue-200">
                    {t('notifications.iosInstructions')}
                  </span>
                </div>
                <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                  {t('notifications.iosSteps')}
                </p>
              </div>
            )}
          </div>
          
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setIsVisible(false)}
              className="text-xs"
            >
              {t('common.dismiss')}
            </Button>
            {notificationPermission !== 'denied' && (
              <Button
                size="sm"
                onClick={handleEnableNotifications}
                className="text-xs bg-orange-600 hover:bg-orange-700 text-white"
              >
                {t('notifications.enable')}
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}