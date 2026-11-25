import { useEffect, useState } from 'react';
import { Camera, Loader2, RefreshCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { RECHECK_PHOTO_BUCKET } from '@/lib/recheckEvidence';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/hooks/useTranslation';

interface Props {
  photos?: string[] | null;
}

/** Manager findings on a returned assignment, NOT the housekeeper's completion photos. */
export function ManagerRecheckEvidence({ photos }: Props) {
  const { language } = useTranslation();
  const [signedUrls, setSignedUrls] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [expandedUrl, setExpandedUrl] = useState<string | null>(null);
  const pathsKey = (photos || []).filter(Boolean).join('|');
  const hu = language === 'hu';
  const title = hu ? 'Vezetői fotók – javítandó hibák' : 'Manager photos – areas to recheck';

  useEffect(() => {
    let active = true;
    if (!pathsKey) {
      setSignedUrls([]);
      setFailed(false);
      return;
    }
    setLoading(true);
    setFailed(false);
    // One request for all signed links keeps the room card responsive on mobile.
    supabase.storage.from(RECHECK_PHOTO_BUCKET)
      .createSignedUrls(pathsKey.split('|'), 60 * 60)
      .then(({ data, error }) => {
        if (!active) return;
        const urls = (data || []).map(item => item.signedUrl).filter((url): url is string => Boolean(url));
        setSignedUrls(urls);
        setFailed(Boolean(error) || urls.length !== pathsKey.split('|').length);
      })
      .catch(() => { if (active) { setFailed(true); setSignedUrls([]); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [pathsKey, retry]);

  if (!pathsKey) return null;

  return (
    <section data-testid="manager-recheck-evidence" aria-label={title}
      className="rounded-lg border border-amber-300 bg-amber-50/80 p-3 dark:border-amber-700 dark:bg-amber-950/30 space-y-2">
      <div className="flex items-center gap-2">
        <Camera className="h-4 w-4 text-amber-700 dark:text-amber-200" />
        <p className="text-sm font-semibold text-amber-950 dark:text-amber-100">{title}</p>
      </div>
      <p className="text-xs text-amber-900 dark:text-amber-200">
        {hu ? 'Nézd meg a képeket, javítsd ki a problémát, majd küldd be újra a szobát.'
          : 'Open the photos to see what needs correcting before submitting the room again.'}
      </p>
      {loading && <p role="status" className="flex items-center gap-2 text-xs"><Loader2 className="h-4 w-4 animate-spin" />{hu ? 'Fotók betöltése…' : 'Loading photos…'}</p>}
      {signedUrls.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {signedUrls.map((url, index) => (
            <button type="button" key={url} onClick={() => setExpandedUrl(url)}
              aria-label={hu ? `Fotó ${index + 1} nagyítása` : `Enlarge manager photo ${index + 1}`}
              className="overflow-hidden rounded-lg border border-amber-200 bg-white aspect-square focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
              <img src={url} alt={hu ? `Javítandó terület ${index + 1}` : `Area needing recheck ${index + 1}`}
                className="h-full w-full object-cover" loading="lazy" />
            </button>
          ))}
        </div>
      )}
      {failed && (
        <div className="flex items-center gap-2 text-xs text-amber-950 dark:text-amber-100">
          <span>{hu ? 'Egyes fotók nem tölthetők be.' : 'Some photos could not load.'}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => setRetry(value => value + 1)}>
            <RefreshCw className="h-3 w-3 mr-1" />{hu ? 'Újra' : 'Retry'}
          </Button>
        </div>
      )}
      <Dialog open={Boolean(expandedUrl)} onOpenChange={open => { if (!open) setExpandedUrl(null); }}>
        <DialogContent className="w-[95vw] max-w-3xl">
          <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
          {expandedUrl && <img src={expandedUrl} alt={title} className="w-full max-h-[78vh] object-contain rounded" />}
        </DialogContent>
      </Dialog>
    </section>
  );
}
