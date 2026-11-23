import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Camera, CheckCircle2, ImageUp, Keyboard, Loader2, PlugZap, ScanLine, ShieldCheck, TriangleAlert } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useTranslation } from '@/hooks/useTranslation';
import type { Worker as TesseractWorker } from 'tesseract.js';
import { readMrz, type MrzReadResult } from '@/lib/idScan/mrz';
import { snapshotFrame } from '@/lib/idScan/frameCapture';
import { assessIdFront, looksLikeIdFront, type IdFrontAssessment } from '@/lib/idScan/idFront';
import { Checkbox } from '@/components/ui/checkbox';
import {
  fetchBridgeScan, isLoopbackUrl, loadScannerSettings, saveScannerSettings, wedgeInputLooksComplete, wedgeInputToMrzText,
  type ScannerSettings, type ScannerSource,
} from '@/lib/idScan/scannerDevices';

/**
 * Passport / ID-card scan at the front desk.
 *
 * Three sources, chosen per workstation and remembered:
 *   - Camera (or a photo on iPads/phones),
 *   - a document reader attached to the computer that types the code lines
 *     (keyboard output — ARH, Access-IS, Desko, 3M …),
 *   - a reader service on this computer (http://localhost…, Plustek/Granus style).
 *
 * Camera/picture → crop the code-line band → OCR in the
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
type DocumentSide = 'mrz' | 'front'; // 'front' is ALWAYS the initial camera capture.

/** Grayscale + contrast stretch + upscale: OCR reads MRZ much better this way. */
function prepareBand(source: CanvasImageSource, width: number, height: number, band: 'bottom' | 'lower' | 'full'): HTMLCanvasElement {
  const top = band === 'bottom' ? Math.floor(height * 0.58) : band === 'lower' ? Math.floor(height * 0.3) : 0;
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

const OCR_PARAMETERS = {
  tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<',
  preserve_interword_spaces: '0',
};

/**
 * The reader uses a model trained on the OCR-B type of document code lines
 * (served from this site, see public/tessdata) — it reads worn and
 * low-resolution documents that the general English model gets wrong. If it
 * cannot be loaded, the English model is the fallback.
 */
async function createOcrWorker(): Promise<TesseractWorker> {
  const { createWorker } = await import('tesseract.js');
  let worker: TesseractWorker;
  try {
    worker = await createWorker('mrz', 1, { langPath: `${window.location.origin}/tessdata`, gzip: false });
  } catch {
    worker = await createWorker('eng');
  }
  await worker.setParameters(OCR_PARAMETERS as never);
  return worker;
}

/** General text OCR is used ONLY for the front of an ID card.
 * The MRZ-only character whitelist would drop spaces and accented names here.
 * The front text is used as a local comparison; VIZA data comes from the back.
 */
async function createFrontOcrWorker(): Promise<TesseractWorker> {
  const { createWorker } = await import('tesseract.js');
  return createWorker('eng');
}

export function IdScanDialog({ open, onOpenChange, onApply }: IdScanDialogProps) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanRunRef = useRef(0);
  const cameraSessionRef = useRef(0);
  const [phase, setPhase] = useState<Phase>('camera');
  const [side, setSide] = useState<DocumentSide>('front');
  const [frontText, setFrontText] = useState(''); // Temporary local OCR, never saved.
  const [frontAssessment, setFrontAssessment] = useState<IdFrontAssessment | null>(null);
  const [frontCaptureAttempted, setFrontCaptureAttempted] = useState(false);
  const [reviewAcknowledged, setReviewAcknowledged] = useState(false);
  const [cameraOk, setCameraOk] = useState<boolean | null>(null);
  const [result, setResult] = useState<MrzReadResult | null>(null);
  const [settings, setSettings] = useState<ScannerSettings>(loadScannerSettings);
  const [source, setSource] = useState<ScannerSource>(() => loadScannerSettings().preferred);
  const [typed, setTyped] = useState('');
  const [bridgeDraft, setBridgeDraft] = useState(() => loadScannerSettings().bridgeUrl);
  const [failReason, setFailReason] = useState<string | null>(null);
  const wedgeRef = useRef<HTMLTextAreaElement | null>(null);

  const chooseSource = (next: ScannerSource) => {
    setSource(next);
    setTyped('');
    setFailReason(null);
    const updated = { ...settings, preferred: next };
    setSettings(updated);
    saveScannerSettings(updated);
  };

  const stopCamera = useCallback(() => {
    cameraSessionRef.current += 1; // Invalidate a pending iPhone permission request.
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const startCamera = useCallback(async () => {
    const request = ++cameraSessionRef.current;
    setCameraOk(null);
    if (!navigator.mediaDevices?.getUserMedia) { setCameraOk(false); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      // getUserMedia may resolve after the dialog was closed or another source
      // selected. Never leave an iPhone camera running in that case.
      if (cameraSessionRef.current !== request || !videoRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      if (cameraSessionRef.current === request) setCameraOk(true);
    } catch {
      if (cameraSessionRef.current === request) {
        stopCamera();
        setCameraOk(false);
      }
    }
  }, [stopCamera]);

  useEffect(() => {
    if (!open) {
      scanRunRef.current += 1;
      stopCamera();
      setResult(null);
      setFrontText('');
      setFrontAssessment(null);
      setFrontCaptureAttempted(false);
      setReviewAcknowledged(false);
      return;
    }
    setPhase('camera');
    setSide('front');
    setSource('camera');
    setResult(null);
    setFrontText('');
    setFrontAssessment(null);
    setFrontCaptureAttempted(false);
    setReviewAcknowledged(false);
    setTyped('');
    setFailReason(null);
    return stopCamera;
  }, [open, stopCamera]);

  // Wait for the camera-phase video element to be in the DOM before asking
  // Safari for a stream. A previously failed dialog may reopen without a
  // video element until the phase reset has rendered.
  useEffect(() => {
    if (!open || source !== 'camera' || phase !== 'camera') return;
    void startCamera();
    return stopCamera;
  }, [open, source, phase, startCamera, stopCamera]);

  useEffect(() => {
    if (!open || source !== 'wedge' || phase !== 'camera') return;
    const timer = setTimeout(() => wedgeRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, [open, source, phase]);

  // Passports are recognised from their bio-page code lines (TD3), so the
  // first capture is enough. ID cards require a front capture BEFORE TD1/TD2
  // code lines on the back. Never accept the back as scan step one.
  const completeMrz = (parsed: MrzReadResult) => {
    setFailReason(null);
    setReviewAcknowledged(false);
    if (parsed.fields.documentType === 'passport') {
      if (frontText) {
        setResult(null);
        setFrontText('');
        setFrontAssessment(null);
        setFailReason('different_document');
        setSide('front');
        setPhase('failed');
        return;
      }
      setResult(parsed);
      setFrontAssessment(null);
      setPhase('review');
      return;
    }
    if (!frontText) {
      setResult(null);
      setSide('front');
      setFailReason('front_first');
      setPhase('failed');
      return;
    }
    setResult(parsed);
    setSide('mrz');
    setFrontAssessment(assessIdFront(frontText, parsed.fields));
    setPhase('review');
  };

  // A reader types the whole code zone within a fraction of a second: read it
  // as soon as it is complete, without the receptionist pressing anything.
  useEffect(() => {
    if (source !== 'wedge' || phase !== 'camera' || !wedgeInputLooksComplete(typed)) return;
    const timer = setTimeout(() => {
      const parsed = readMrz(wedgeInputToMrzText(typed));
      if (parsed) completeMrz(parsed); else { setFailReason(null); setPhase('failed'); }
      setTyped('');
    }, 350);
    return () => clearTimeout(timer);
  }, [typed, source, phase]);

  const saveBridgeUrl = () => {
    const url = bridgeDraft.trim();
    if (url && !isLoopbackUrl(url)) { setFailReason('not_local'); return; }
    const updated = { ...settings, bridgeUrl: url };
    setSettings(updated);
    saveScannerSettings(updated);
    setFailReason(null);
  };

  const readFromBridge = async () => {
    setPhase('reading');
    setFailReason(null);
    const scan = await fetchBridgeScan(settings.bridgeUrl);
    if (scan.kind === 'mrz') {
      const parsed = readMrz(scan.text);
      if (parsed) completeMrz(parsed); else setPhase('failed');
      return;
    }
    if (scan.kind === 'image') {
      const img = new Image();
      img.onload = () => { void readFrom(img, img.naturalWidth, img.naturalHeight); };
      img.onerror = () => setPhase('failed');
      img.src = scan.dataUrl;
      return;
    }
    setFailReason(scan.reason);
    setPhase('failed');
  };

  const readFrom = async (source: CanvasImageSource, width: number, height: number) => {
    const run = ++scanRunRef.current;
    const initialCapture = side === 'front';
    let frame: HTMLCanvasElement;
    try {
      frame = snapshotFrame(source, width, height);
    } catch {
      setFailReason('ocr_unavailable');
      setPhase('failed');
      return;
    }
    if (initialCapture) setFrontCaptureAttempted(true);
    setPhase('reading');
    setFailReason(null);
    stopCamera();
    let worker: TesseractWorker | null = null;
    let recognized = false;

    // The same MRZ parser handles passport (TD3), ID (TD1), and TD2. A
    // successful passport read on the first capture is the entire scan.
    const recognizeBand = async (current: TesseractWorker, band: 'bottom' | 'lower' | 'full'): Promise<MrzReadResult | null> => {
      const canvas = prepareBand(frame, frame.width, frame.height, band);
      try {
        const { data } = await current.recognize(canvas);
        recognized = true;
        return readMrz(data.text ?? '');
      } catch {
        return null;
      } finally {
        wipe(canvas);
      }
    };

    try {
      worker = await createOcrWorker();
      if (initialCapture) {
        // Try the expected passport bio-page code lines first. If this is
        // actually the BACK of an ID, tell reception to start with its FRONT.
        const firstMrz = await recognizeBand(worker, 'bottom');
        if (scanRunRef.current !== run) return;
        if (firstMrz?.valid && !firstMrz.unknownCountry) {
          completeMrz(firstMrz);
          return;
        }
        await worker.terminate().catch(() => undefined);
        worker = null;

        // No reliable passport code found: try the ID's printed FRONT using
        // ordinary OCR (not the MRZ font/whitelist). The front text stays only
        // in this component until scan completion/cancel.
        worker = await createFrontOcrWorker();
        const { data } = await worker.recognize(frame);
        if (scanRunRef.current !== run) return;
        if (looksLikeIdFront(data.text ?? '')) {
          setFrontText(data.text ?? '');
          setFrontAssessment(null);
          setSide('mrz');
          setSource('camera');
          setPhase('camera');
          return;
        }

        // A passport photo may place the MRZ above the bottom crop or be
        // rotated. Search the remainder before reporting an unknown document.
        await worker.terminate().catch(() => undefined);
        worker = await createOcrWorker();
        let partial: MrzReadResult | null = firstMrz;
        for (const band of ['lower', 'full'] as const) {
          if (scanRunRef.current !== run) return;
          const parsed = await recognizeBand(worker, band);
          if (parsed?.valid && !parsed.unknownCountry) {
            completeMrz(parsed);
            return;
          }
          partial = partial ?? parsed;
        }
        if (partial) {
          completeMrz(partial);
          return;
        }
        setFailReason('first_not_recognized');
        setPhase('failed');
        return;
      }

      // Only the ID back is requested in step two. It must have a real
      // machine-readable code zone; other OCR guesses are not identity data.
      let partial: MrzReadResult | null = null;
      for (const band of ['bottom', 'lower', 'full'] as const) {
        if (scanRunRef.current !== run) return;
        const parsed = await recognizeBand(worker, band);
        if (parsed?.valid && !parsed.unknownCountry) {
          completeMrz(parsed);
          return;
        }
        partial = partial ?? parsed;
      }
      if (scanRunRef.current !== run) return;
      if (partial) completeMrz(partial);
      else {
        setFailReason(recognized ? 'no_mrz' : 'ocr_unavailable');
        setPhase('failed');
      }
    } catch {
      if (scanRunRef.current === run) {
        setFailReason(initialCapture ? 'first_not_recognized' : 'ocr_unavailable');
        setPhase('failed');
      }
    } finally {
      wipe(frame);
      await worker?.terminate().catch(() => undefined);
    }
  };

  const captureFrame = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) {
      setCameraOk(false); // Offer the native photo capture when live video cannot start.
      return;
    }
    void readFrom(video, video.videoWidth, video.videoHeight);
  };

  const readFile = (file: File | undefined) => {
    if (!file) return;
    if (file.type && !file.type.startsWith('image/')) { setFailReason('unsupported_image'); setPhase('failed'); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      void readFrom(img, img.naturalWidth, img.naturalHeight).finally(() => URL.revokeObjectURL(url));
    };
    img.onerror = () => { URL.revokeObjectURL(url); setFailReason('unsupported_image'); setPhase('failed'); };
    img.src = url;
  };

  const retry = () => {
    scanRunRef.current += 1;
    setTyped('');
    setFailReason(null);
    // A failed second scan keeps the successfully captured first ID side.
    if (side === 'front') { setResult(null); setFrontText(''); setFrontCaptureAttempted(false); }
    setFrontAssessment(null);
    setReviewAcknowledged(false);
    setPhase('camera');
  };

  const restart = () => {
    scanRunRef.current += 1;
    setResult(null); setFrontText(''); setFrontAssessment(null);
    setFrontCaptureAttempted(false); setReviewAcknowledged(false);
    setSide('front'); setSource('camera'); setTyped(''); setFailReason(null);
    setPhase('camera');
  };

  // If the printed front is difficult for OCR (including foreign ID cards),
  // staff can only continue after actually capturing a front photo. The final
  // fields must then be verified manually; no OCR match is invented.
  const manuallyCheckedFront = () => {
    if (side !== 'front' || !frontCaptureAttempted || result) return;
    setFrontText('MANUAL_REVIEW_REQUIRED');
    setSide('mrz');
    setSource('camera');
    setFailReason(null);
    setReviewAcknowledged(false);
    setPhase('camera');
  };
  const needsReviewAcknowledgement = !!result && (
    !result.valid || result.unknownCountry ||
    (result.fields.documentType === 'id_card' && frontAssessment?.status !== 'matched')
  );
  const expired = !!result?.fields.expiryDate && result.fields.expiryDate < new Date().toISOString().slice(0, 10);

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) { scanRunRef.current += 1; stopCamera(); } onOpenChange(next); }}>
      <DialogContent className="w-[calc(100%-1rem)] max-w-lg max-h-[94dvh] !h-auto overflow-hidden px-4 py-4 sm:!h-auto sm:max-h-[90dvh] sm:p-6" data-training="fd-id-scan">
        <DialogHeader className="shrink-0 pr-6 text-left">
          <DialogTitle className="flex items-center gap-2"><ScanLine className="h-5 w-5 text-primary" /> {t('pms.scan.title')}</DialogTitle>
        </DialogHeader>

        <p className="flex shrink-0 items-start gap-1.5 text-[11px] text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 shrink-0 mt-px text-emerald-600" /> {t('pms.scan.privacy')}
        </p>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain pr-0.5" data-training="fd-id-scan-scroll">
        {phase !== 'failed' && phase !== 'review' && (
          <div className="rounded-md bg-primary/5 px-3 py-2 text-xs font-semibold" role="status">
            {side === 'front' ? t('pms.scan.firstStep') : t('pms.scan.idBackStep')}
          </div>
        )}
        {phase === 'review' && result && (
          <p className="text-xs font-semibold text-primary">
            {result.fields.documentType === 'passport' ? t('pms.scan.passportDetected') : t('pms.scan.idDetected')}
          </p>
        )}
        {phase === 'camera' && side === 'mrz' && (
          <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1" role="tablist" aria-label={t('pms.scan.source')}>
            {([
              ['camera', Camera, 'pms.scan.srcCamera'], ['wedge', Keyboard, 'pms.scan.srcReader'], ['bridge', PlugZap, 'pms.scan.srcService'],
            ] as Array<[ScannerSource, typeof Camera, string]>).map(([key, Icon, labelKey]) => (
              <button key={key} type="button" role="tab" aria-selected={source === key} onClick={() => chooseSource(key)}
                className={`flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${source === key ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
                <Icon className="h-3.5 w-3.5" /> {t(labelKey)}
              </button>
            ))}
          </div>
        )}

        {phase === 'camera' && side === 'mrz' && source === 'wedge' && (
          <div className="space-y-2" data-training="fd-id-scan-reader">
            <p className="text-xs">{t('pms.scan.readerHint')}</p>
            <textarea
              ref={wedgeRef}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              rows={3}
              spellCheck={false}
              autoComplete="off"
              aria-label={t('pms.scan.readerField')}
              placeholder={t('pms.scan.readerField')}
              className="w-full resize-none rounded-lg border-2 border-dashed border-primary/40 bg-muted/30 p-3 font-mono text-xs uppercase tracking-wider focus:border-primary focus:outline-none"
            />
            <p className="text-[11px] text-muted-foreground">{t('pms.scan.readerSetup')}</p>
          </div>
        )}

        {phase === 'camera' && side === 'mrz' && source === 'bridge' && (
          <div className="space-y-2" data-training="fd-id-scan-service">
            <p className="text-xs">{t('pms.scan.serviceHint')}</p>
            <div className="flex gap-2">
              <Input value={bridgeDraft} onChange={(event) => setBridgeDraft(event.target.value)} placeholder="http://localhost:8080/document" aria-label={t('pms.scan.serviceUrl')} className="h-9 font-mono text-xs" />
              <Button type="button" variant="outline" size="sm" className="h-9 shrink-0" disabled={bridgeDraft.trim() === settings.bridgeUrl} onClick={saveBridgeUrl}>{t('pms.scan.serviceSave')}</Button>
            </div>
            {failReason === 'not_local' && <p className="text-[11px] text-destructive">{t('pms.scan.serviceLocalOnly')}</p>}
            <p className="text-[11px] text-muted-foreground">{t('pms.scan.serviceSetup')}</p>
          </div>
        )}

        {phase === 'camera' && source === 'camera' && (
          <div className="space-y-2">
            <p className="text-xs">{side === 'front' ? t('pms.scan.firstHint') : t('pms.scan.idBackHint')}</p>
            {cameraOk !== false ? (
              <div className="relative mx-auto w-full max-h-[34dvh] overflow-hidden rounded-lg bg-black aspect-[1.58/1]">
                <video ref={videoRef} playsInline muted autoPlay className="absolute inset-0 h-full w-full object-cover" />
                {/* Guide frame: the MRZ band sits in the lower part of the document. */}
                <div className="pointer-events-none absolute inset-[7%] rounded-md border-2 border-dashed border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.28)]" />
                {side === 'mrz' && <div className="pointer-events-none absolute inset-x-[7%] bottom-[7%] h-[24%] border-t border-dashed border-white/80 bg-primary/15" />}
                {cameraOk === null && <Loader2 className="absolute inset-0 m-auto h-6 w-6 animate-spin text-white" />}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">{t('pms.scan.noCamera')}</div>
            )}
          </div>
        )}

        {phase === 'reading' && (
          <div className="flex flex-col items-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" /> {t('pms.scan.reading')}
          </div>
        )}

        {phase === 'failed' && (
          <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-3 text-sm text-amber-900 dark:text-amber-200">
            <TriangleAlert className="h-4 w-4 shrink-0 mt-0.5" /> {failReason === 'front_first' ? t('pms.scan.frontFirstRequired') : failReason === 'first_not_recognized' ? t('pms.scan.firstNotRecognized') : failReason === 'different_document' ? t('pms.scan.differentDocument') : failReason === 'front_unreadable' ? t('pms.scan.frontUnreadable') : failReason === 'ocr_unavailable' ? t('pms.scan.ocrUnavailable') : failReason === 'unsupported_image' ? t('pms.scan.invalidPhoto') : failReason === 'no_mrz' ? t('pms.scan.noMrzGuide') : failReason && failReason !== 'no_document' ? t('pms.scan.serviceFailed') : t('pms.scan.notFound')}
          </div>
        )}

        {phase === 'review' && result && (
          <div className="space-y-2">
            {result.fields.documentType === 'id_card' && frontAssessment && (
              <div className={frontAssessment.status === 'matched'
                ? 'flex items-start gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-900'
                : 'flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900'}>
                {frontAssessment.status === 'matched' ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <TriangleAlert className="h-4 w-4 shrink-0" />}
                <span>{frontAssessment.status === 'matched' ? t('pms.scan.bothSidesMatch') : t('pms.scan.frontCheckRequired')}</span>
              </div>
            )}
            <div className="flex flex-wrap gap-1.5">
              {result.valid && !result.unknownCountry
                ? <Badge className="bg-emerald-600 text-white gap-1"><CheckCircle2 className="h-3.5 w-3.5" /> {t('pms.scan.valid')}</Badge>
                : <Badge variant="outline" className="border-amber-400 text-amber-700 dark:text-amber-400 gap-1"><TriangleAlert className="h-3.5 w-3.5" /> {t('pms.scan.checkCarefully')}</Badge>}
              {expired && <Badge variant="destructive">{t('pms.scan.expired')}</Badge>}
            </div>
            <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1 rounded-md border border-border p-3 text-sm">
              <dt className="text-muted-foreground">{t('pms.guest.familyName')}</dt><dd className="font-semibold">{result.fields.mrzLastName || '—'}</dd>
              <dt className="text-muted-foreground">{t('pms.guest.givenName')}</dt><dd className="font-semibold">{result.fields.mrzFirstName || '—'}</dd>
              <dt className="text-muted-foreground">{t('pms.guest.nationality')}</dt><dd>{result.fields.nationality}</dd>
              <dt className="text-muted-foreground">{t('pms.guest.birthDate')}</dt><dd>{result.fields.dateOfBirth ?? '—'}</dd>
              <dt className="text-muted-foreground">{t('pms.guest.gender')}</dt><dd>{result.fields.gender ? t(`pms.guest.gender${result.fields.gender[0].toUpperCase()}${result.fields.gender.slice(1)}`) : '—'}</dd>
              <dt className="text-muted-foreground">{t('pms.guest.docType')}</dt><dd>{t(result.fields.documentType === 'passport' ? 'pms.guest.docPassport' : 'pms.guest.docIdCard')}</dd>
              <dt className="text-muted-foreground">{t('pms.guest.docNumber')}</dt><dd className="font-mono">{result.fields.documentNumber}</dd>
              <dt className="text-muted-foreground">{t('pms.scan.expiry')}</dt><dd>{result.fields.expiryDate ?? '—'}</dd>
            </dl>
            <pre aria-label={t('pms.scan.codeLines')} className="overflow-x-auto rounded-md bg-muted px-2 py-1.5 font-mono text-[10px] leading-tight text-muted-foreground">{result.lines.join('\n')}</pre>
            <p className="text-[11px] text-muted-foreground">{t('pms.scan.reviewHint')}</p>
            {needsReviewAcknowledgement && (
              <label className="flex cursor-pointer items-start gap-2 rounded-md border border-amber-200 p-2.5 text-xs">
                <Checkbox checked={reviewAcknowledged} onCheckedChange={(value) => setReviewAcknowledged(value === true)} className="mt-0.5 shrink-0" />
                <span>{t('pms.scan.manualReviewConfirm')}</span>
              </label>
            )}
          </div>
        )}

        </div>
        <DialogFooter className="shrink-0 !flex-col gap-2 border-t border-border pt-3 pb-[env(safe-area-inset-bottom)]">
          {phase === 'camera' && side === 'mrz' && source === 'bridge' && (
            <Button type="button" className="gap-1.5" disabled={!settings.bridgeUrl} onClick={() => void readFromBridge()}><ScanLine className="h-4 w-4" /> {t('pms.scan.readDocument')}</Button>
          )}
          {phase === 'camera' && source === 'camera' && (
            <>
              {cameraOk && <Button type="button" className="w-full gap-1.5" onClick={captureFrame}><ScanLine className="h-4 w-4" /> {side === 'front' ? t('pms.scan.captureFirst') : t('pms.scan.captureBack')}</Button>}
              <div className="grid w-full grid-cols-2 gap-2">
                <Button variant="outline" asChild>
                  <label className="relative cursor-pointer gap-1.5">
                    <Camera className="h-4 w-4" /> {t('pms.scan.takeNewPhoto')}
                    <input type="file" accept="image/*" capture="environment" aria-label={t('pms.scan.takeNewPhoto')} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" onChange={(e) => { readFile(e.currentTarget.files?.[0]); e.currentTarget.value = ''; }} />
                  </label>
                </Button>
                <Button variant="outline" asChild>
                  <label className="relative cursor-pointer gap-1.5">
                    <ImageUp className="h-4 w-4" /> {t('pms.scan.choosePhoto')}
                    <input type="file" accept="image/*" aria-label={t('pms.scan.choosePhoto')} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" onChange={(e) => { readFile(e.currentTarget.files?.[0]); e.currentTarget.value = ''; }} />
                  </label>
                </Button>
              </div>
            </>
          )}
          {phase === 'failed' && <Button type="button" variant="outline" className="w-full" onClick={retry}>{t('pms.scan.retry')}</Button>}
          {phase === 'failed' && side === 'front' && !result && frontCaptureAttempted && failReason !== 'front_first' && (
            <Button type="button" variant="outline" className="w-full" onClick={manuallyCheckedFront}>{t('pms.scan.checkedManually')}</Button>
          )}
          {phase === 'review' && <Button type="button" variant="outline" className="w-full" onClick={restart}>{t('pms.scan.retry')}</Button>}
          {phase === 'review' && result && (
            <Button type="button" className="w-full" disabled={result.fields.documentType === 'id_card' && !frontAssessment || (needsReviewAcknowledgement && !reviewAcknowledged)} onClick={() => { onApply(result); onOpenChange(false); }}>{t('pms.scan.use')}</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
