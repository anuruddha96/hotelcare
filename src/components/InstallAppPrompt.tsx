import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';
import { toast } from 'sonner';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function InstallAppPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    // Hide in iframe / preview hosts to avoid editor noise
    const isInIframe = (() => {
      try {
        return window.self !== window.top;
      } catch {
        return true;
      }
    })();
    const isPreviewHost =
      window.location.hostname.includes('id-preview--') ||
      window.location.hostname.includes('lovableproject.com');

    if (isInIframe || isPreviewHost) return;

    // Detect already-installed (standalone display mode)
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setIsInstalled(true);
      return;
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const installedHandler = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
      toast.success('App installed! Open it from your home screen.');
    };

    window.addEventListener('beforeinstallprompt', handler);
    window.addEventListener('appinstalled', installedHandler);

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      window.removeEventListener('appinstalled', installedHandler);
    };
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    try {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setDeferredPrompt(null);
        // Nudge for notification permission after install
        if ('Notification' in window && Notification.permission === 'default') {
          setTimeout(() => Notification.requestPermission(), 1500);
        }
      }
    } catch (err) {
      console.error('Install prompt failed:', err);
    }
  };

  if (isInstalled || !deferredPrompt) return null;

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleInstall}
      className="hidden sm:inline-flex shrink-0"
      title="Install app to home screen"
    >
      <Download className="h-4 w-4 sm:mr-2" />
      <span className="hidden md:inline">Install App</span>
    </Button>
  );
}
