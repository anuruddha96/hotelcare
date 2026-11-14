import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Camera, CheckCircle2, ImageUp, Loader2, ScanLine, ShieldCheck, TriangleAlert } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { readMrz, type MrzReadResult } from '@/lib/idScan/mrz';

/**
 * Passport / ID-card scan at the front desk.
 *
 * Camera (or a photo on iPads/phones) → crop the code-line band → OCR in the
 * browser (tesseract.js, loaded only when needed) → ICAO MRZ parse with check
 * digits → staff review → fields handed to the guest form. The picture is
 * never uploaded or stored; canvases are cleared after reading.
 */

interface IdScanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: (result: MrzReadResult) => void;
}

type Phase = 'camera' | 'reading' | 'review' | 'failed';

/** Grayscale + contrast stretch + upscale: OCR reads MRZ much better this way. */
function prepareBand(source: CanvasImageSource, width: number, height: number, band: 'bottom' | 'full'): HTMLCanvasElement {
  const top = band === 'bottom' ? Math.floor(height * 0.58) : 0;
  const cropH = height - top;
  const scale = Math.min(3, Math.max(1, 1800 / width));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(cropH * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return canvas;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(source, 0, top, width, cropH, 0, 0, canvas.width, canvas.height);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  let min = 255; let max = 0;
  for (let i = 0; i < d.length; i += 4) {
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    d[i] = g;
    if (g < min) min = g;
    if (g > max) max = g;
  }
  const range = Math.max(1, max - min);
  for (let i = 0; i < d.length; i += 4) {
    const v = ((d[i] - min) / range) * 255;
    const out = v < 128 ? Math.max(0, v - 40) : Math.min(255, v + 40);
    d[i] = d[i + 1] = d[i + 2] = out;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function wipe(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d');
  ctx?.clearRect(0, 0, canvas.width, canvas.height);
  canvas.width = 0; canvas.height = 0;
}

async function ocr(canvas: HTMLCanvasElement): Promise<string> {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('eng');
  try {
    await worker.setParameters({
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<',
      preserve_interword_spaces: '0',
    });
    const { data } = await worker.recognize(canvas);
    return data.text ?? '';
  } finally {
    await worker.terminate();
  }
}

export function IdScanDialog({ open, onOpenChange, onApply }: IdScanDialogProps) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [phase, setPhase] = useState<Phase>('camera');
  const [cameraOk, setCameraOk] = useState<boolean | null>(null);
  const [result, setResult] = useState<MrzReadResult | null>(null);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const startCamera = useCallback(async () => {
    setCameraOk(null);
    if (!navigator.mediaDevices?.getUserMedia) { setCameraOk(false); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      setCameraOk(true);
    } catch {
      setCameraOk(false);
    }
  }, []);

  useEffect(() => {
    if (!open) { stopCamera(); return; }
    setPhase('camera');
    setResult(null);
    void startCamera();
    return stopCamera;
  }, [open, startCamera, stopCamera]);

  const readFrom = async (source: CanvasImageSource, width: number, height: number) => {
    setPhase('reading');
    stopCamera();
    // The code lines are at the bottom; fall back to the whole image if needed.
    for (const band of ['bottom', 'full'] as const) {
      const canvas = prepareBand(source, width, height, band);
      try {
        const text = await ocr(canvas);
        const parsed = readMrz(text);
        if (parsed) { setResult(parsed); setPhase('review'); return; }
      } catch {
        // try the next band
      } finally {
        wipe(canvas);
      }
    }
    setPhase('failed');
  };

  const captureFrame = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    void readFrom(video, video.videoWidth, video.videoHeight);
  };

  const readFile = (file: File | undefined) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      void readFrom(img, img.naturalWidth, img.naturalHeight).finally(() => URL.revokeObjectURL(url));
    };
    img.onerror = () => { URL.revokeObjectURL(url); setPhase('failed'); };
    img.src = url;
    if (fileRef.current) fileRef.current.value = '';
  };

  const retry = () => { setResult(null); setPhase('camera'); void startCamera(); };
  const expired = !!result?.fields.expiryDate && result.fields.expiryDate < new Date().toISOString().slice(0, 10);

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) stopCamera(); onOpenChange(next); }}>
      <DialogContent className="sm:max-w-lg" data-training="fd-id-scan">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ScanLine className="h-5 w-5 text-primary" /> {t('pms.scan.title')}</DialogTitle>
        </DialogHeader>

        <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 shrink-0 mt-px text-emerald-600" /> {t('pms.scan.privacy')}
        </p>

        {phase === 'camera' && (
          <div className="space-y-2">
            <p className="text-xs">{t('pms.scan.hint')}</p>
            {cameraOk !== false ? (
              <div className="relative overflow-hidden rounded-lg bg-black aspect-[4/3]">
                <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
                {/* Guide frame: the MRZ band sits in the lower part of the document. */}
                <div className="pointer-events-none absolute inset-x-[6%] bottom-[10%] top-[45%] rounded-md border-2 border-dashed border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
                <span className="pointer-events-none absolute left-1/2 bottom-[12%] -translate-x-1/2 text-[11px] font-mono text-white/90">P&lt;HUN&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;</span>
                {cameraOk === null && <Loader2 className="absolute inset-0 m-auto h-6 w-6 animate-spin text-white" />}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">{t('pms.scan.noCamera')}</div>
            )}
            <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => readFile(e.target.files?.[0])} />
          </div>
        )}

        {phase === 'reading' && (
          <div className="flex flex-col items-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" /> {t('pms.scan.reading')}
          </div>
        )}

        {phase === 'failed' && (
          <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-3 text-sm text-amber-900 dark:text-amber-200">
            <TriangleAlert className="h-4 w-4 shrink-0 mt-0.5" /> {t('pms.scan.notFound')}
          </div>
        )}

        {phase === 'review' && result && (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {result.valid && !result.unknownCountry
                ? <Badge className="bg-emerald-600 text-white gap-1"><CheckCircle2 className="h-3.5 w-3.5" /> {t('pms.scan.valid')}</Badge>
                : <Badge variant="outline" className="border-amber-400 text-amber-700 dark:text-amber-400 gap-1"><TriangleAlert className="h-3.5 w-3.5" /> {t('pms.scan.checkCarefully')}</Badge>}
              {expired && <Badge variant="destructive">{t('pms.scan.expired')}</Badge>}
            </div>
            <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1 rounded-md border border-border p-3 text-sm">
              <dt className="text-muted-foreground">{t('pms.scan.name')}</dt><dd className="font-semibold">{result.fields.firstName} {result.fields.lastName}</dd>
              <dt className="text-muted-foreground">{t('pms.guest.nationality')}</dt><dd>{result.fields.nationality}</dd>
              <dt className="text-muted-foreground">{t('pms.guest.birthDate')}</dt><dd>{result.fields.dateOfBirth ?? '—'}</dd>
              <dt className="text-muted-foreground">{t('pms.guest.gender')}</dt><dd>{result.fields.gender ? t(`pms.guest.gender${result.fields.gender[0].toUpperCase()}${result.fields.gender.slice(1)}`) : '—'}</dd>
              <dt className="text-muted-foreground">{t('pms.guest.docType')}</dt><dd>{t(result.fields.documentType === 'passport' ? 'pms.guest.docPassport' : 'pms.guest.docIdCard')}</dd>
              <dt className="text-muted-foreground">{t('pms.guest.docNumber')}</dt><dd className="font-mono">{result.fields.documentNumber}</dd>
              <dt className="text-muted-foreground">{t('pms.scan.expiry')}</dt><dd>{result.fields.expiryDate ?? '—'}</dd>
            </dl>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          {phase === 'camera' && (
            <>
              <Button type="button" variant="outline" className="gap-1.5" onClick={() => fileRef.current?.click()}><ImageUp className="h-4 w-4" /> {t('pms.scan.takePhoto')}</Button>
              {cameraOk && <Button type="button" className="gap-1.5" onClick={captureFrame}><Camera className="h-4 w-4" /> {t('pms.scan.capture')}</Button>}
            </>
          )}
          {(phase === 'failed' || phase === 'review') && <Button type="button" variant="outline" onClick={retry}>{t('pms.scan.retry')}</Button>}
          {phase === 'review' && result && (
            <Button type="button" onClick={() => { onApply(result); onOpenChange(false); }}>{t('pms.scan.use')}</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
