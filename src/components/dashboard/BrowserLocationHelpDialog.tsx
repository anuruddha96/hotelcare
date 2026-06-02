import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { MapPin, Copy, RefreshCw, Settings, X } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from '@/hooks/useTranslation';
import { requestLocationOnce, getBrowserPermissionState } from '@/lib/locationPreference';

type Reason = 'denied' | 'blocked' | 'unsupported';

type BrowserId =
  | 'chromeDesktop'
  | 'edgeDesktop'
  | 'safariMac'
  | 'safariIos'
  | 'chromeAndroid'
  | 'firefox';

function detectBrowser(): { id: BrowserId; settingsUrl?: string } {
  if (typeof navigator === 'undefined') return { id: 'chromeDesktop' };
  const ua = navigator.userAgent || '';
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && (navigator as any).maxTouchPoints > 1);
  const isAndroid = /Android/.test(ua);
  const isEdge = /Edg\//.test(ua);
  const isFirefox = /Firefox\//.test(ua);
  const isSafari = /^((?!chrome|android).)*safari/i.test(ua) && !isEdge;
  const isChrome = /Chrome\//.test(ua) && !isEdge;

  if (isIOS) return { id: 'safariIos' };
  if (isAndroid && isChrome) return { id: 'chromeAndroid' };
  if (isSafari) return { id: 'safariMac' };
  if (isEdge) return { id: 'edgeDesktop', settingsUrl: 'edge://settings/content/location' };
  if (isFirefox) return { id: 'firefox' };
  if (isChrome) return { id: 'chromeDesktop', settingsUrl: 'chrome://settings/content/location' };
  return { id: 'chromeDesktop', settingsUrl: 'chrome://settings/content/location' };
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reason?: Reason;
}

export function BrowserLocationHelpDialog({ open, onOpenChange, reason = 'denied' }: Props) {
  const { t } = useTranslation();
  const [retrying, setRetrying] = useState(false);

  const { id: browserId, settingsUrl } = useMemo(() => detectBrowser(), []);
  const stepKeys = [
    `locationHelp.${browserId}.step1`,
    `locationHelp.${browserId}.step2`,
    `locationHelp.${browserId}.step3`,
  ];

  const handleCopyUrl = async () => {
    if (!settingsUrl) return;
    try {
      await navigator.clipboard.writeText(settingsUrl);
      toast.success(t('locationHelp.copied'));
    } catch {
      toast.error('Copy failed');
    }
  };

  const handleOpenSettings = () => {
    window.dispatchEvent(new CustomEvent('hc:open-settings', { detail: { tab: 'account', focus: 'location' } }));
    onOpenChange(false);
  };

  const handleTryAgain = async () => {
    setRetrying(true);
    // Re-check permission first; if still denied, the prompt will not appear and we just notify.
    const state = await getBrowserPermissionState();
    if (state === 'denied') {
      toast.error(t('locationHelp.stillBlocked'));
      setRetrying(false);
      return;
    }
    const fix = await requestLocationOnce();
    setRetrying(false);
    if (fix) {
      toast.success(t('locationHelp.fixed'));
      onOpenChange(false);
    } else {
      toast.error(t('locationHelp.stillBlocked'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-primary" />
            {t('locationHelp.title')}
          </DialogTitle>
          <DialogDescription>
            {reason === 'unsupported' ? t('locationHelp.unsupportedIntro') : t('locationHelp.intro')}
          </DialogDescription>
        </DialogHeader>

        {reason !== 'unsupported' && (
          <ol className="space-y-3 list-decimal list-inside text-sm">
            {stepKeys.map((k, i) => (
              <li key={i} className="leading-relaxed">{t(k)}</li>
            ))}
          </ol>
        )}

        {settingsUrl && (
          <div className="mt-2 flex items-center justify-between gap-2 rounded-md border bg-muted/40 p-2">
            <code className="text-xs truncate flex-1">{settingsUrl}</code>
            <Button size="sm" variant="outline" onClick={handleCopyUrl} className="shrink-0">
              <Copy className="h-3 w-3 mr-1" /> {t('locationHelp.copyUrl')}
            </Button>
          </div>
        )}

        <DialogFooter className="flex flex-col sm:flex-row gap-2 sm:gap-2 mt-2">
          <Button variant="outline" onClick={handleOpenSettings} className="sm:flex-1">
            <Settings className="h-4 w-4 mr-1.5" />
            {t('locationHelp.openSettings')}
          </Button>
          <Button onClick={handleTryAgain} disabled={retrying || reason === 'unsupported'} className="sm:flex-1">
            <RefreshCw className={`h-4 w-4 mr-1.5 ${retrying ? 'animate-spin' : ''}`} />
            {t('locationHelp.tryAgain')}
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="sm:w-auto">
            <X className="h-4 w-4 mr-1.5" />
            {t('locationHelp.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Mount once at the root. Listens for `hc:open-location-help` events
 *  so any component can trigger the recovery flow without prop-drilling. */
export function BrowserLocationHelpRoot() {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<Reason>('denied');

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      setReason((detail.reason as Reason) || 'denied');
      setOpen(true);
    };
    window.addEventListener('hc:open-location-help', handler as EventListener);
    return () => window.removeEventListener('hc:open-location-help', handler as EventListener);
  }, []);

  return <BrowserLocationHelpDialog open={open} onOpenChange={setOpen} reason={reason} />;
}
