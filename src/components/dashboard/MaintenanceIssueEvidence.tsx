import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { getSignedPhotoUrls } from '@/lib/storageUrls';
import { useTranslation } from '@/hooks/useTranslation';
import { Camera, RefreshCw } from 'lucide-react';

type EvidenceProps = { originalPhotos?: string[] | null; completionPhotos?: string[] | null };
type EvidenceState = { originals: string[]; repairs: string[]; failed: number };

/** Both original and after-repair evidence belong to the SAME issue. Never expose raw private paths. */
export function MaintenanceIssueEvidence({ originalPhotos, completionPhotos }: EvidenceProps) {
  const { language } = useTranslation();
  const hu = language === 'hu';
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(false);
  const [state, setState] = useState<EvidenceState>({ originals: [], repairs: [], failed: 0 });
  const [imageFailed, setImageFailed] = useState(false);
  const original = originalPhotos || [];
  const repairs = completionPhotos || [];
  const evidenceKey = JSON.stringify([original, repairs]);
  const total = original.length + repairs.length;

  useEffect(() => {
    let live = true;
    if (!total) {
      setState({ originals: [], repairs: [], failed: 0 });
      return;
    }
    setLoading(true);
    setImageFailed(false);
    void (async () => {
      try {
        const [originals, completed] = await Promise.all([
          getSignedPhotoUrls(original, 'ticket-attachments'),
          getSignedPhotoUrls(repairs, 'ticket-attachments'),
        ]);
        if (live) setState({
          originals, repairs: completed,
          failed: Math.max(0, original.length - originals.length) + Math.max(0, repairs.length - completed.length),
        });
      } catch (error) {
        console.error('Could not load maintenance issue evidence', error);
        if (live) setState({ originals: [], repairs: [], failed: total });
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => { live = false; };
    // Re-sign on evidence change or explicit retry, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evidenceKey, attempt]);

  if (!total) return null;
  const sections = [
    { label: hu ? 'Eredeti hibafotók' : 'Original issue photos', urls: state.originals },
    { label: hu ? 'Javítás utáni fotók' : 'After-repair photos', urls: state.repairs },
  ];
  return (
    <section aria-label={hu ? 'Karbantartási hiba fotói' : 'Maintenance issue evidence'} className="space-y-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1 text-sm font-semibold"><Camera className="h-4 w-4" />{hu ? 'Fotóbizonyíték' : 'Photo evidence'} ({total})</span>
        <Button type="button" size="sm" variant="outline" disabled={loading} onClick={() => setAttempt(value => value + 1)}>
          <RefreshCw className="mr-1 h-3.5 w-3.5" />{hu ? 'Fotók frissítése' : 'Refresh photos'}
        </Button>
      </div>
      {loading && <p role="status" className="text-xs text-muted-foreground">{hu ? 'Fotók betöltése…' : 'Loading photos…'}</p>}
      {sections.map(section => section.urls.length ? (
        <div key={section.label} className="space-y-1.5">
          <p className="text-xs font-semibold text-muted-foreground">{section.label} ({section.urls.length})</p>
          <div className="flex flex-wrap gap-2">
            {section.urls.map((url, index) => (
              <Dialog key={`${section.label}-${index}-${attempt}`}>
                <DialogTrigger asChild>
                  <button type="button" className="rounded-md border focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" aria-label={`${section.label} ${index + 1}`}>
                    <img src={url} alt={`${section.label} ${index + 1}`} loading="lazy" className="h-20 w-20 rounded-md object-cover" onError={() => setImageFailed(true)} />
                  </button>
                </DialogTrigger>
                <DialogContent className="max-h-[90dvh] w-[calc(100vw-1rem)] max-w-4xl overflow-auto">
                  <img src={url} alt={`${section.label} ${index + 1}`} className="mx-auto max-h-[80dvh] w-auto object-contain" onError={() => setImageFailed(true)} />
                </DialogContent>
              </Dialog>
            ))}
          </div>
        </div>
      ) : null)}
      {(state.failed > 0 || imageFailed) && !loading && (
        <p role="alert" className="text-xs text-amber-800">
          {hu ? 'Néhány fotó nem érhető el. Ellenőrizze a hozzáférést, majd frissítse a fotókat.' : 'Some photos are unavailable. Check access and refresh the photos.'}
        </p>
      )}
    </section>
  );
}
