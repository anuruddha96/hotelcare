import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Bell, BellOff, Settings, X } from 'lucide-react';
import { useNotifications } from '@/hooks/useNotifications';
import { useNotificationPreferences } from '@/hooks/useNotificationPreferences';
import { useTranslation } from '@/hooks/useTranslation';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { resolveHotelKeys } from '@/lib/hotelKeys';
import { ensurePushSubscription } from '@/lib/pushSubscriptionManager';
import { getNotificationEnvironment, openNotificationSettings } from '@/lib/notificationPlatform';

export function NotificationPermissionBanner() {
  const { requestNotificationPermission, notificationPermission, ensureAudioUnlocked, playNotificationSound, showNotification } = useNotifications();
  const { preferences, preferencesLoaded, updatePreferences, bannerDismissed, dismissBanner } = useNotificationPreferences();
  const { t, language } = useTranslation();
  const { user, profile } = useAuth();
  const [isRequesting, setIsRequesting] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const [pushIssue, setPushIssue] = useState('');
  const device = getNotificationEnvironment();


  useEffect(() => {
    if (!user?.id || !profile?.organization_slug || !profile?.assigned_hotel) return;
    let disposed = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    const assignedSeen = new Set<string>();
    const pendingSeen = new Set<string>();
    const approvedSeen = new Set<string>();

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
      const c = copy[language] || copy.en;
      const supervisorRoles = new Set(['manager', 'housekeeping_manager', 'maintenance_manager', 'supervisor', 'admin', 'top_management', 'top_management_manager']);

      let existingQuery = (supabase as any)
        .from('tickets')
        .select('id, assigned_to, pending_supervisor_approval, supervisor_approved, status')
        .eq('department', 'maintenance')
        .eq('organization_slug', profile.organization_slug)
        .neq('source', 'housekeeping_legacy_backfill');
      if (hotelKeys.length) existingQuery = existingQuery.in('hotel', hotelKeys);
      const { data: existingRows } = await existingQuery;
      for (const row of existingRows || []) {
        if (row.assigned_to === user.id) assignedSeen.add(row.id); // Baseline all historic tickets: no false 'new assignment' on later updates.
        if (row.pending_supervisor_approval === true) pendingSeen.add(row.id);
        if (row.assigned_to === user.id && row.supervisor_approved === true) approvedSeen.add(row.id);
      }
      if (disposed) return;

      channel = supabase
        .channel(`maintenance-notifications-${user.id}-${profile.assigned_hotel}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets' }, (payload: any) => {
          const row = payload.new || payload.old;
          if (!row || row.department !== 'maintenance') return;
          if (row.organization_slug !== profile.organization_slug) return;
          if (row.source === 'housekeeping_legacy_backfill') return;
          if (row.hotel && !hotelKeys.includes(row.hotel)) return;

          const suffix = row.room_number ? ` · ${c.room} ${row.room_number}` : '';
          const isMine = row.assigned_to === user.id;
          if (!isMine) assignedSeen.delete(row.id);
          if (row.pending_supervisor_approval !== true) pendingSeen.delete(row.id);
          if (row.supervisor_approved !== true) approvedSeen.delete(row.id);

          if (isMine && row.supervisor_approved === true && !approvedSeen.has(row.id)) {
            approvedSeen.add(row.id);
            void showNotification(`${c.approved}${suffix}`, 'success', c.title);
            return;
          }
          if (isMine && row.supervisor_approved !== true && !assignedSeen.has(row.id)) {
            assignedSeen.add(row.id);
            void showNotification(`${c.assigned}${suffix}`, 'info', c.title);
            return;
          }

          if (!supervisorRoles.has(profile.role || '')) return;
          if (payload.eventType === 'INSERT' && row.created_by !== user.id) {
            void showNotification(`${c.forwarded}${suffix}`, row.priority === 'urgent' ? 'warning' : 'info', c.title);
          }
          if (row.pending_supervisor_approval === true && !pendingSeen.has(row.id)) {
            pendingSeen.add(row.id);
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

  useEffect(() => {
    if (!user?.id || !preferencesLoaded || !preferences.browser_notifications_enabled
      || notificationPermission !== 'granted' || !device.canRequest) {
      setPushIssue('');
      return;
    }
    let cancelled = false;
    void ensurePushSubscription().then((subscription) => {
      if (!cancelled) setPushIssue(subscription ? '' : 'registration');
    }).catch((error) => {
      console.warn('Could not register background notifications:', error);
      if (!cancelled) setPushIssue('registration');
    });
    return () => { cancelled = true; };
  }, [user?.id, preferencesLoaded, preferences.browser_notifications_enabled, notificationPermission, device.canRequest]);

  // Explicit dismissal wins for EVERY warning, including iOS installation and
  // failed push registration. Those were previously outside the dismissal guard.
  const shouldShowBanner = user?.id && preferencesLoaded
    && !bannerDismissed && !preferences.banner_permanently_hidden
    && (!preferences.browser_notifications_enabled || notificationPermission !== 'granted'
      || !!pushIssue || !device.canRequest);
  const needsSettings = !device.canRequest || notificationPermission === 'denied';

  const handleEnableNotifications = async () => {
    if (needsSettings) {
      openNotificationSettings();
      return;
    }
    if (isRequesting) return;
    setIsRequesting(true);
    // Audio and the native permission request must start inside this tap.
    ensureAudioUnlocked();
    try {
      if (pushIssue && notificationPermission === 'granted') {
        const subscription = await ensurePushSubscription({ forceRenew: true });
        if (!subscription) throw new Error('Device registration was not completed.');
      } else {
        const granted = await requestNotificationPermission();
        if (!granted) {
          if (typeof Notification !== 'undefined' && Notification.permission === 'denied') {
            openNotificationSettings();
          } else if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            setPushIssue('registration');
          }
          return;
        }
      }
      const pushReady = await updatePreferences({ browser_notifications_enabled: true });
      if (!pushReady) {
        setPushIssue('registration');
        return;
      }
      setPushIssue('');
      dismissBanner();
      playNotificationSound();
    } catch (error) {
      console.error('Error enabling notifications:', error);
      setPushIssue('registration');
    } finally {
      setIsRequesting(false);
    }
  };

  const handleDismiss = () => {
    // Hide immediately, even while the network is slow or saving fails.
    dismissBanner();
    if (dontShowAgain) void updatePreferences({ banner_permanently_hidden: true });
  };

  if (!shouldShowBanner) return null;

  return (
    <Card className="mb-4 border-orange-200 bg-orange-50 dark:border-orange-800 dark:bg-orange-900/20"
      role="region" aria-labelledby="notification-permission-title">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          {notificationPermission === 'denied'
            ? <BellOff className="mt-1 h-5 w-5 shrink-0 text-orange-600" aria-hidden="true" />
            : <Bell className="mt-1 h-5 w-5 shrink-0 text-orange-600" aria-hidden="true" />}
          <div className="min-w-0 flex-1">
            <h3 id="notification-permission-title" className="text-sm font-medium text-orange-800 dark:text-orange-200">
              {t('notifications.enableTitle')}
            </h3>
            <p className="mt-1 text-sm text-orange-700 dark:text-orange-300">
              {t('notificationSetup.description')}
            </p>
            {device.needsInstall && (
              <p className="mt-2 text-sm text-orange-800 dark:text-orange-200">{t('notificationSetup.iosBrowser')}</p>
            )}
            {!!pushIssue && (
              <p role="status" className="mt-2 text-sm text-red-700 dark:text-red-300">{t('notificationSetup.failed')}</p>
            )}
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={handleDismiss}
            className="h-11 w-11 shrink-0" aria-label={t('notifications.dismiss')}>
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Checkbox id="dont-show-notifications" checked={dontShowAgain}
            onCheckedChange={(checked) => setDontShowAgain(checked === true)} />
          <label htmlFor="dont-show-notifications" className="cursor-pointer py-1 text-xs text-muted-foreground">
            {t('notifications.dontShowAgain')}
          </label>
        </div>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button type="button" onClick={handleEnableNotifications} disabled={isRequesting}
            className="h-auto min-h-11 whitespace-normal bg-orange-600 px-3 py-2 text-white hover:bg-orange-700">
            {isRequesting ? t('notificationSetup.enabling')
              : device.needsInstall ? t('notificationSetup.install')
              : needsSettings ? t('notificationSetup.settings')
              : pushIssue && notificationPermission === 'granted' ? t('notificationSetup.repair')
              : t('notificationSetup.enable')}
          </Button>
          {!needsSettings && (
            <Button type="button" variant="outline" onClick={openNotificationSettings}
              className="h-auto min-h-11 whitespace-normal px-3 py-2">
              <Settings className="mr-2 h-4 w-4 shrink-0" aria-hidden="true" />
              {t('notificationSetup.settings')}
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={handleDismiss} className="min-h-11">
            {t('notifications.gotIt')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
