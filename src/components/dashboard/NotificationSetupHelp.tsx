import { Smartphone } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { getNotificationEnvironment } from '@/lib/notificationPlatform';

/** Shared by the banner's destination and account settings, including blocked permission recovery. */
export function NotificationSetupHelp({ permission }: { permission: NotificationPermission }) {
  const { t } = useTranslation();
  const device = getNotificationEnvironment();
  const steps: string[] = [];

  if (device.needsInstall) {
    steps.push('iosInstallSteps', 'iosOpenSteps');
  } else {
    if (!device.supported) steps.push('unsupported');
    if (permission !== 'granted' && permission !== 'denied' && device.canRequest) steps.push('readyHint');
    if (device.platform === 'ios') steps.push('iosSettings');
    else if (device.platform === 'android') {
      steps.push(device.androidChrome ? 'androidChrome' : 'androidBrowser', 'androidSystem');
    } else steps.push('desktopSettings');
    steps.push('manualSettings');
  }

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm dark:border-blue-800 dark:bg-blue-950/30">
      <h4 className="flex items-center gap-2 font-medium text-blue-900 dark:text-blue-100">
        <Smartphone className="h-4 w-4 shrink-0" aria-hidden="true" />
        {t('notificationSetup.helpTitle')}
      </h4>
      <ol className="mt-2 list-decimal space-y-2 pl-5 text-blue-800 dark:text-blue-200">
        {steps.map((step) => <li key={step}>{t(`notificationSetup.${step}`)}</li>)}
      </ol>
    </div>
  );
}
