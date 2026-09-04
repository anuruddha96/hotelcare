import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Bell, BellOff, Smartphone, X } from 'lucide-react';
import { useNotifications } from '@/hooks/useNotifications';
import { useNotificationPreferences } from '@/hooks/useNotificationPreferences';
import { useTranslation } from '@/hooks/useTranslation';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { resolveHotelKeys } from '@/lib/hotelKeys';

export function NotificationPermissionBanner() {
  const { requestNotificationPermission, notificationPermission, ensureAudioUnlocked, playNotificationSound, showNotification } = useNotifications();
  const { preferences, preferencesLoaded, updatePreferences, bannerDismissed, dismissBanner } = useNotificationPreferences();
  const { t, language } = useTranslation();
  const { user, profile } = useAuth();
  const [showIOSInstructions, setShowIOSInstructions] = useState(false);
  const [isRequesting, setIsRequesting] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);


  useEffect(() => {
    if (!user?.id || !profile?.organization_slug || !profile?.assigned_hotel) return;
    let disposed = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const copy: Record<string, { title: string; assigned: string; forwarded: string; approval: string; approved: string; room: string }> = {
      en: { title: 'Maintenance', assigned: 'New maintenance task assigned', forwarded: 'New maintenance request forwarded', approval: 'Repair submitted for supervisor approval', approved: 'Your maintenance repair was approved', room: 'Room' },
      hu: { title: 'Karbantartás', assigned: 'Új karbantartási feladat érkezett', forwarded: 'Új karbantartási kérés továbbítva', approval: 'A javítás felügyelői jóváhagyásra vár', approved: 'A karbantartási javítást jóváhagyták', room: 'Szoba' },
      es: { title: 'Mantenimiento', assigned: 'Nueva tarea de mantenimiento asignada', forwarded: 'Nueva solicitud de mantenimiento reenviada', approval: 'Reparación enviada para aprobación del supervisor', approved: 'Su reparación de mantenimiento fue aprobada', room: 'Habitación' },
      vi: { title: 'Bảo trì', assigned: 'Đã giao công việc bảo trì mới', forwarded: 'Đã chuyển yêu cầu bảo trì mới', approval: 'Công việc sửa chữa đã gửi để giám sát duyệt', approved: 'Công việc sửa chữa của bạn đã được duyệt', room: 'Phòng' },
      mn: { title: 'Засвар үйлчилгээ', assigned: 'Шинэ засварын ажил хуваарилагдлаа', forwarded: 'Шинэ засварын хүсэлт шилжүүлэгдлээ', approval: 'Засварыг хянагчийн зөвшөөрөлд илгээлээ', approved: 'Таны засварын ажил зөвшөөрөгдлөө', room: 'Өрөө' },
      az: { title: 'Texniki xidmət', assigned: 'Yeni texniki xidmət tapşırığı təyin edildi', forwarded: 'Yeni texniki xidmət sorğusu yönləndirildi', approval: 'Təmir nəzarətçi təsdiqinə göndərildi', approved: 'Texniki xidmət təmiriniz təsdiqləndi', room: 'Otaq' },
      tl: { title: 'Maintenance', assigned: 'May bagong maintenance task na naka-assign', forwarded: 'May bagong maintenance request na na-forward', approval: 'Ipinadala ang repair para sa supervisor approval', approved: 'Na-approve ang maintenance repair mo', room: 'Kuwarto' },
      uk: { title: 'Техобслуговування', assigned: 'Вам призначено нове завдання з ремонту', forwarded: 'Передано нову заявку на ремонт', approval: 'Ремонт надіслано на схвалення керівника', approved: 'Ваш ремонт схвалено', room: 'Кімната' },
      ru: { title: 'Техобслуживание', assigned: 'Вам назначена новая задача по ремонту', forwarded: 'Передана новая заявка на ремонт', approval: 'Ремонт отправлен на одобрение руководителя', approved: 'Ваш ремонт одобрен', room: 'Комната' },
    };

    const setup = async () => {
      const keys = await resolveHotelKeys(profile.assigned_hotel);
      const hotelKeys = keys.length ? keys : [profile.assigned_hotel];
      if (disposed) return;
      const c = copy[language] || copy.en;
      const supervisorRoles = new Set(['manager', 'housekeeping_manager', 'maintenance_manager', 'supervisor', 'admin']);

      channel = supabase
        .channel(`maintenance-notifications-${user.id}-${profile.assigned_hotel}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets' }, (payload: any) => {
          const row = payload.new || payload.old;
          const old = payload.old || {};
          if (!row || row.department !== 'maintenance') return;
          if (row.organization_slug !== profile.organization_slug) return;
          if (row.source === 'housekeeping_legacy_backfill') return;
          if (row.hotel && !hotelKeys.includes(row.hotel)) return;

          const suffix = row.room_number ? ` · ${c.room} ${row.room_number}` : '';
          const newlyAssignedToMe = row.assigned_to === user.id && (payload.eventType === 'INSERT' || old.assigned_to !== user.id);
          if (newlyAssignedToMe) {
            void showNotification(`${c.assigned}${suffix}`, 'info', c.title);
            return;
          }

          if (row.assigned_to === user.id && payload.eventType === 'UPDATE' && old.supervisor_approved !== true && row.supervisor_approved === true) {
            void showNotification(`${c.approved}${suffix}`, 'success', c.title);
            return;
          }

          if (!supervisorRoles.has(profile.role || '')) return;
          if (payload.eventType === 'INSERT' && row.created_by !== user.id) {
            void showNotification(`${c.forwarded}${suffix}`, row.priority === 'urgent' ? 'warning' : 'info', c.title);
          } else if (payload.eventType === 'UPDATE' && old.pending_supervisor_approval !== true && row.pending_supervisor_approval === true) {
            void showNotification(`${c.approval}${suffix}`, 'warning', c.title);
          }
        })
        .subscribe();
    };

    void setup();
    return () => {
      disposed = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [user?.id, profile?.organization_slug, profile?.assigned_hotel, profile?.role, language, showNotification]);

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
