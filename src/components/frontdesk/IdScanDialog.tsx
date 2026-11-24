import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Camera, CheckCircle2, ImageUp, Keyboard, Loader2, PlugZap, RotateCw, ScanLine, ShieldCheck, TriangleAlert } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useTranslation } from '@/hooks/useTranslation';
import type { Worker as TesseractWorker } from 'tesseract.js';
import { readMrz, type MrzReadResult } from '@/lib/idScan/mrz';
import { guideCrop, snapshotFrame, type SourceRect } from '@/lib/idScan/frameCapture';
import { OcrSession } from '@/lib/idScan/ocrSession';
import { documentNumberReview, sameRead, scanConfidence } from '@/lib/idScan/scanReview';
import { assessReadiness, completeAutoMrz, type Readiness } from '@/lib/idScan/autoCapture';
import { assessIdFront, looksLikeIdFront, type IdFrontAssessment } from '@/lib/idScan/idFront';
import { firstSideAction, nextMrzScanAction } from '@/lib/idScan/documentScanFlow';
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
function prepareBand(source: CanvasImageSource, width: number, height: number, band: 'bottom' | 'lower' | 'full', live = false): HTMLCanvasElement {
  const top = band === 'bottom' ? Math.floor(height * (live ? 0.51 : 0.58)) : band === 'lower' ? Math.floor(height * 0.3) : 0;
  const cropH = height - top;
  const scale = Math.min(3, 1600 / width);
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
  d.fill(0);
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
  tessedit_pageseg_mode: '6',
};

/**
 * The reader uses a model trained on the OCR-B type of document code lines
 * (served from this site, see public/tessdata) — it reads worn and
 * low-resolution documents that the general English model gets wrong.
 * English OCR is reserved for the non-blocking front cross-check.
 */
async function createOcrWorker(): Promise<TesseractWorker> {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('mrz', 1, { langPath: `${window.location.origin}/tessdata`, gzip: false });
  try {
    await worker.setParameters(OCR_PARAMETERS as never);
    return worker;
  } catch (error) {
    await worker.terminate().catch(() => undefined);
    throw error;
  }
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
  const frontRef = useRef({ captured: false, positive: false, text: '' });
  const frontJobRef = useRef<Promise<void> | null>(null);
  const frontGeneration = useRef(0);
  const busyRef = useRef<number | null>(null);
  const nextFullRef = useRef(false);
  const previousRead = useRef<MrzReadResult | null>(null);
  const flipUntil = useRef(0);
  const [flipPrompt, setFlipPrompt] = useState(false);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [numberReview, setNumberReview] = useState<{ needsReview: boolean; printed: string | null }>({ needsReview: false, printed: null });
  const [mrzSession] = useState(() => new OcrSession(createOcrWorker));
  const [frontSession] = useState(() => new OcrSession(createFrontOcrWorker));
  const [guidance, setGuidance] = useState<Readiness>('holdSteady');
  const [captureProgress, setCaptureProgress] = useState(0);
  const [frontAssessment, setFrontAssessment] = useState<IdFrontAssessment | null>(null);
  const [frontCaptureAttempted, setFrontCaptureAttempted] = useState(false);
  const [reviewAcknowledged, setReviewAcknowledged] = useState(false);
  const [cameraOk, setCameraOk] = useState<boolean | null>(null);
  const [autoReading, setAutoReading] = useState(false);
  const [result, setResult] = useState<MrzReadResult | null>(null);
  const [settings, setSettings] = useState<ScannerSettings>(loadScannerSettings);
  const [source, setSource] = useState<ScannerSource>(() => loadScannerSettings().preferred);
  const [typed, setTyped] = useState('');
  const [bridgeDraft, setBridgeDraft] = useState(() => loadScannerSettings().bridgeUrl);
  const [failReason, setFailReason] = useState<string | null>(null);
  const wedgeRef = useRef<HTMLTextAreaElement | null>(null);

  const clearFront = useCallback(() => {
    frontGeneration.current++;
    nextFullRef.current = false;
    previousRead.current = null;
    flipUntil.current = 0;
    frontSession.reset();
    frontJobRef.current = null;
    frontRef.current = { captured: false, positive: false, text: '' };
  }, [frontSession]);

  const chooseSource = (next: ScannerSource) => {
    if (next === source) return;
    scanRunRef.current++;
    busyRef.current = null;
    mrzSession.reset();
    setAutoReading(false);
    setFlipPrompt(false);
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
      clearFront();
      setFrontAssessment(null);
      setFrontCaptureAttempted(false);
      setReviewAcknowledged(false);
      return;
    }
    setPhase('camera');
    setFlipPrompt(false);
    setConfidence(null);
    setNumberReview({ needsReview: false, printed: null });
    setSide('front');
    setSource('camera');
    setResult(null);
    clearFront();
    setFrontAssessment(null);
    setFrontCaptureAttempted(false);
    setReviewAcknowledged(false);
    setTyped('');
    setFailReason(null);
    void mrzSession.warm().catch(() => undefined);
    return () => {
      scanRunRef.current++;
      busyRef.current = null;
      stopCamera();
      mrzSession.reset();
      clearFront();
    };
  }, [open, stopCamera, mrzSession, clearFront]);

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
  const completeMrz = async (parsed: MrzReadResult, run = scanRunRef.current, ocrConfidence: number | null = null) => {
    // Front OCR runs concurrently with turning the card. Give it a short
    // opportunity to finish for the cross-check, never block indefinitely.
    const pending = frontJobRef.current;
    if (pending) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([pending, new Promise<void>(resolve => { timer = setTimeout(resolve, 1000); })]);
      if (timer !== undefined) clearTimeout(timer);
    }
    if (scanRunRef.current !== run) return;
    const front = frontRef.current;
    const action = nextMrzScanAction(parsed, front.captured, front.positive);
    setFailReason(null);
    setReviewAcknowledged(false);
    stopCamera();
    if (action === 'different_document' || action === 'front_first_required') {
      setResult(null);
      clearFront();
      setFrontAssessment(null);
      setSide('front');
      setFailReason(action === 'different_document' ? 'different_document' : 'front_first');
      setPhase('failed');
      return;
    }
    setResult(parsed);
    setConfidence(scanConfidence(ocrConfidence));
    setNumberReview(documentNumberReview(parsed, front.text));
    setFlipPrompt(false);
    if (action === 'passport_complete') {
      setFrontAssessment(null);
    } else {
      setSide('mrz');
      const assessment = assessIdFront(front.text, parsed.fields);
      setFrontAssessment(assessment.status === 'unreadable' ? { status: 'needs_review', matchedFields: [] } : assessment);
    }
    clearFront();
    setPhase('review');
  };

  // A reader types the whole code zone within a fraction of a second: read it
  // as soon as it is complete, without the receptionist pressing anything.
  useEffect(() => {
    if (source !== 'wedge' || phase !== 'camera' || !wedgeInputLooksComplete(typed)) return;
    const timer = setTimeout(() => {
      const parsed = readMrz(wedgeInputToMrzText(typed));
      if (parsed) void completeMrz(parsed); else { setFailReason(null); setPhase('failed'); }
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
    const run = ++scanRunRef.current;
    setPhase('reading');
    setFailReason(null);
    const scan = await fetchBridgeScan(settings.bridgeUrl);
    if (scanRunRef.current !== run) return;
    if (scan.kind === 'mrz') {
      const parsed = readMrz(scan.text);
      if (parsed) void completeMrz(parsed, run); else setPhase('failed');
      return;
    }
    if (scan.kind === 'image') {
      const img = new Image();
      img.onload = () => { if (scanRunRef.current === run) void readFrom(img, img.naturalWidth, img.naturalHeight); };
      img.onerror = () => { if (scanRunRef.current === run) setPhase('failed'); };
      img.src = scan.dataUrl;
      return;
    }
    setFailReason(scan.reason);
    setPhase('failed');
  };

  const liveRect = (video: HTMLVideoElement) => {
    const box = video.getBoundingClientRect();
    return guideCrop(video.videoWidth, video.videoHeight, box.width, box.height);
  };

  const graySample = (image: CanvasImageSource, rect: SourceRect) => {
    const sample = document.createElement('canvas');
    sample.width = 320;
    sample.height = Math.max(8, Math.round(320 * rect.height / rect.width));
    try {
      const ctx = sample.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('Canvas unavailable');
      ctx.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, sample.width, sample.height);
      const rgba = ctx.getImageData(0, 0, sample.width, sample.height).data;
      const gray = new Uint8Array(sample.width * sample.height);
      for (let i = 0; i < gray.length; i++) {
        gray[i] = Math.round(0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]);
      }
      rgba.fill(0);
      return gray;
    } finally { wipe(sample); }
  };

  const acceptFront = (frame: HTMLCanvasElement) => {
    clearFront();
    frontRef.current.captured = true;
    setFrontCaptureAttempted(true);
    const generation = frontGeneration.current;
    // Separate worker and canvas; the capture path never waits for English
    // OCR/model download. A failed read is not evidence of an ID.
    const copy = snapshotFrame(frame, frame.width, frame.height);
    frontJobRef.current = frontSession.recognize(copy, 8000).then(text => {
      if (frontGeneration.current === generation) {
        frontRef.current.text = text;
        frontRef.current.positive = looksLikeIdFront(text);
      }
    }).catch(() => undefined).finally(() => {
      wipe(copy);
      if (frontGeneration.current === generation) {
        frontJobRef.current = null;
        frontSession.reset();
      }
    });
    setFrontAssessment(null);
    flipUntil.current = performance.now() + 1600;
    setFlipPrompt(true);
    setSide('mrz');
    setSource('camera');
    setPhase('camera');
  };

  // Shared path for live auto/manual and full-size uploaded photos.
  const readFrom = async (image: CanvasImageSource, width: number, height: number,
    rect?: SourceRect, automatic = false) => {
    if (automatic && busyRef.current !== null) return;
    if (!automatic && busyRef.current !== null) mrzSession.reset();
    const run = ++scanRunRef.current;
    busyRef.current = run;
    const initial = side === 'front';
    const live = !!rect;
    let frame: HTMLCanvasElement | null = null;
    let quality: Readiness = 'moveCloser';
    let completedPass = false;
    let partial: MrzReadResult | null = null;
    let partialConfidence: number | null = null;
    const active = () => scanRunRef.current === run;
    const fail = (reason: string, hint?: Readiness) => {
      if (!active()) return;
      if (hint) setGuidance(hint);
      if (automatic || (live && hint)) {
        setPhase('camera');
        return;
      }
      setFailReason(reason);
      setPhase('failed');
    };
    try {
      frame = snapshotFrame(image, width, height, rect);
      if (initial) setFrontCaptureAttempted(true);
      if (automatic) setAutoReading(true);
      else if (!live) { setPhase('reading'); stopCamera(); }
      else setAutoReading(true);
      setFailReason(null);
      const sample = graySample(frame, { x: 0, y: 0, width: frame.width, height: frame.height });
      quality = assessReadiness(sample, 320, null, false);
      sample.fill(0);
      // Warm-up must not consume the recognition budget. Keep the captured
      // frame in memory while the model loads rather than missing the shot.
      await mrzSession.warm();
      if (!active()) return;
      const deadline = performance.now() + (automatic ? 4000 : 18000);
      // If a prior automatic attempt completed the bottom pass but timed out
      // during the full pass, resume with a fresh full-guide frame next time.
      const resumeFull = automatic && nextFullRef.current;
      const bands: Array<'bottom' | 'lower' | 'full'> = live ? (resumeFull ? ['full'] : ['bottom', 'full']) : ['bottom', 'lower', 'full'];
      if (!automatic) nextFullRef.current = false;
      for (const band of bands) {
        if (!active()) return;
        const prepared = prepareBand(frame, frame.width, frame.height, band, live);
        try {
          const { text, confidence: score } = await mrzSession.recognizeWithConfidence(prepared, deadline - performance.now());
          if (!active()) return;
          completedPass = true;
          const parsed = readMrz(text);
          if (parsed?.valid && !parsed.unknownCountry) {
            // Wrong-side ID is actionable even if some optional fields are missing.
            const wrongSide = initial && parsed.fields.documentType === 'id_card';
            if (!automatic || completeAutoMrz(parsed) || wrongSide) {
              await completeMrz(parsed, run, score);
              return;
            }
          }
          if (parsed && (!partial || (parsed.valid && !partial.valid) || (parsed.valid === partial.valid && (score ?? 0) > (partialConfidence ?? 0)))) {
            partial = parsed;
            partialConfidence = score;
          }
          if (automatic && band === 'bottom') nextFullRef.current = true;
          if (automatic && band === 'full') nextFullRef.current = false;
        } finally { wipe(prepared); }
      }
      if (!active()) return;
      if (initial) {
        const action = firstSideAction(partial, quality === 'ready');
        if (action === 'front_first_required' && partial) await completeMrz(partial, run, partialConfidence);
        else if (action === 'passport_complete' && partial) {
          if (!automatic || completeAutoMrz(partial)) await completeMrz(partial, run, partialConfidence);
          else fail('no_mrz', 'moveCloser');
        } else if (action === 'provisional_front') acceptFront(frame);
        else fail('first_not_recognized', quality === 'ready' ? 'moveCloser' : quality);
      } else if (partial && (!automatic || sameRead(previousRead.current, partial))) {
        // Repeated imperfect reads may open review, never silently confirm.
        await completeMrz(partial, run, partialConfidence);
      } else {
        previousRead.current = partial;
        fail('no_mrz', live ? 'moveCloser' : undefined);
      }
    } catch {
      if (active()) {
        // A completed MRZ pass on a clear first side is sufficient for a
        // provisional front when the secondary pass times out. No OCR result
        // is invented; a passport can still be recovered on the next side.
        if (initial && live && frame && completedPass && !partial && quality === 'ready') acceptFront(frame);
        else if (automatic && !initial && partial && sameRead(previousRead.current, partial)) await completeMrz(partial, run, partialConfidence);
        else if (automatic || live) { if (!initial && partial) previousRead.current = partial; setGuidance('holdSteady'); }
        else fail('ocr_unavailable');
        void mrzSession.warm().catch(() => undefined);
      }
    } finally {
      if (frame) wipe(frame);
      if (busyRef.current === run) {
        busyRef.current = null;
        if (active()) setAutoReading(false);
      }
    }
  };

  const captureFrame = () => {
    if (busyRef.current !== null || performance.now() < flipUntil.current) return;
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) {
      setCameraOk(false);
      return;
    }
    try { void readFrom(video, video.videoWidth, video.videoHeight, liveRect(video)); }
    catch { setGuidance('moveCloser'); }
  };

  useEffect(() => {
    if (!open || phase !== 'camera' || source !== 'camera' || cameraOk !== true) return;
    const session = cameraSessionRef.current;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let previous: Uint8Array | null = null;
    let stable = 0;
    const active = () => !cancelled && session === cameraSessionRef.current;
    const schedule = (ms: number) => { if (active()) timer = setTimeout(() => void tick(), ms); };
    const tick = async () => {
      if (!active()) return;
      try {
        const video = videoRef.current;
        if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight || document.hidden || busyRef.current !== null) {
          previous?.fill(0); previous = null; stable = 0; return;
        }
        if (performance.now() < flipUntil.current) {
          previous?.fill(0); previous = null; stable = 0; return;
        }
        setFlipPrompt(false);
        const rect = liveRect(video);
        const gray = graySample(video, rect);
        const readiness = assessReadiness(gray, 320, previous);
        previous?.fill(0); previous = gray;
        setGuidance(readiness);
        stable = readiness === 'ready' ? stable + 1 : 0;
        setCaptureProgress(Math.min(100, stable * 50));
        if (stable < 2) setAutoReading(false);
        if (stable >= 2) {
          stable = 0;
          await readFrom(video, video.videoWidth, video.videoHeight, rect, true);
        }
      } catch { if (active()) setGuidance('moveCloser'); }
      finally { schedule(250); }
    };
    setGuidance('holdSteady');
    setCaptureProgress(0);
    schedule(250);
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
      previous?.fill(0);
      setAutoReading(false);
    };
    // Current side determines routing; side changes reset stability without
    // stopping the shared camera or the warmed MRZ worker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, phase, source, cameraOk, side, mrzSession]);

  const readFile = (file: File | undefined) => {
    if (!file) return;
    const fileRun = ++scanRunRef.current;
    mrzSession.reset();
    busyRef.current = fileRun;
    setPhase('reading');
    stopCamera();
    if (file.type && !file.type.startsWith('image/')) { busyRef.current = null; setFailReason('unsupported_image'); setPhase('failed'); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      if (scanRunRef.current !== fileRun) { URL.revokeObjectURL(url); return; }
      void readFrom(img, img.naturalWidth, img.naturalHeight).finally(() => URL.revokeObjectURL(url));
    };
    img.onerror = () => { URL.revokeObjectURL(url); if (scanRunRef.current === fileRun) { busyRef.current = null; setFailReason('unsupported_image'); setPhase('failed'); } };
    img.src = url;
  };

  const retry = () => {
    scanRunRef.current += 1;
    busyRef.current = null;
    setAutoReading(false);
    setFlipPrompt(false);
    setTyped('');
    setFailReason(null);
    // A failed second scan keeps the successfully captured first ID side.
    if (side === 'front') { setResult(null); clearFront(); setFrontCaptureAttempted(false); }
    setFrontAssessment(null);
    setReviewAcknowledged(false);
    setPhase('camera');
  };

  const restart = () => {
    scanRunRef.current += 1;
    busyRef.current = null;
    setAutoReading(false);
    setResult(null); clearFront(); setFrontAssessment(null);
    setFlipPrompt(false); setConfidence(null); setNumberReview({ needsReview: false, printed: null });
    setFrontCaptureAttempted(false); setReviewAcknowledged(false);
    setSide('front'); setSource('camera'); setTyped(''); setFailReason(null);
    setPhase('camera');
  };

  // If the printed front is difficult for OCR (including foreign ID cards),
  // staff can only continue after actually capturing a front photo. The final
  // fields must then be verified manually; no OCR match is invented.
  const manuallyCheckedFront = () => {
    if (side !== 'front' || !frontCaptureAttempted || result) return;
    clearFront();
    frontRef.current.captured = true;
    // Physical review is not positive OCR evidence; preserve passport recovery.
    frontRef.current.positive = false;
    flipUntil.current = performance.now() + 1600;
    setFlipPrompt(true);
    setSide('mrz');
    setSource('camera');
    setFailReason(null);
    setReviewAcknowledged(false);
    setPhase('camera');
  };
  const needsReviewAcknowledgement = !!result && (
    !result.valid || result.unknownCountry || numberReview.needsReview ||
    (result.fields.documentType === 'id_card' && frontAssessment?.status !== 'matched')
  );
  const expired = !!result?.fields.expiryDate && result.fields.expiryDate < new Date().toISOString().slice(0, 10);

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) { scanRunRef.current += 1; busyRef.current = null; stopCamera(); mrzSession.reset(); clearFront(); } onOpenChange(next); }}>
      <DialogContent className="w-[calc(100%-1rem)] max-w-lg max-h-[94dvh] !h-auto flex flex-col overflow-hidden px-4 py-4 sm:!h-auto sm:max-h-[90dvh] sm:p-6" data-training="fd-id-scan">
        <DialogHeader className="shrink-0 pr-6 text-left">
          <DialogTitle className="flex items-center gap-2"><ScanLine className="h-5 w-5 text-primary" /> {t('pms.scan.title')}</DialogTitle>
        </DialogHeader>

        <p className="flex shrink-0 items-start gap-1.5 text-[11px] text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 shrink-0 mt-px text-emerald-600" /> {t('pms.scan.privacy')}
        </p>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain pr-0.5" data-training="fd-id-scan-scroll">
        {phase !== 'failed' && phase !== 'review' && (
          <div className="space-y-2" role="status" aria-live="polite">
            <div className="flex gap-1" aria-hidden="true"><span className="h-1.5 flex-1 rounded-full bg-primary"/><span className={side === 'mrz' ? 'h-1.5 flex-1 rounded-full bg-primary' : 'h-1.5 flex-1 rounded-full bg-muted'}/></div>
            {side === 'front' ? <div className="rounded-md bg-primary/5 px-3 py-2 text-sm font-semibold">{t('pms.scan.firstStep')}</div> : <div className="flex items-center gap-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 p-3 text-emerald-800 dark:text-emerald-200"><CheckCircle2 className="h-5 w-5 shrink-0"/><div><div className="text-xs">{t('pms.scan.frontCaptured')}</div><div className="text-sm font-bold">{t('pms.scan.flipCard')}</div></div><RotateCw className="ml-auto h-5 w-5 shrink-0 motion-safe:animate-pulse"/></div>}
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
                <video ref={videoRef} playsInline muted autoPlay className="absolute inset-0 h-full w-full object-cover object-center" />
                {/* Guide frame: the MRZ band sits in the lower part of the document. */}
                <div className={`pointer-events-none absolute inset-[7%] rounded-md border-2 border-dashed shadow-[0_0_0_9999px_rgba(0,0,0,0.28)] transition-colors ${autoReading || guidance === 'ready' ? 'border-emerald-400' : 'border-white/90'}`} />
                {side === 'mrz' && <div className="pointer-events-none absolute inset-x-[7%] bottom-[7%] h-[24%] border-t border-dashed border-white/80 bg-primary/15" />}
                {flipPrompt && side === 'mrz' && <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-black/75 text-white" role="status"><CheckCircle2 className="h-9 w-9 text-emerald-400"/><span className="text-sm font-semibold">{t('pms.scan.frontCaptured')}</span><RotateCw className="h-8 w-8 motion-safe:animate-pulse"/><span className="text-base font-bold">{t('pms.scan.flipCard')}</span></div>}
                {cameraOk === true && <div role="status" className="pointer-events-none absolute inset-x-2 bottom-2 rounded-md bg-black/70 px-2 py-1 text-center text-xs text-white"><div>{autoReading ? t('pms.scan.reading') : guidance === 'ready' ? t('pms.scan.autoCaptureHint') : t(`pms.scan.${guidance}`)}</div><div aria-hidden="true" className="mt-1 h-1 overflow-hidden rounded-full bg-white/25"><div className="h-full rounded-full bg-emerald-400 transition-[width] duration-200" style={{width: `${autoReading ? 100 : captureProgress}%`}}/></div></div>
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
            <div className="rounded-lg border p-3 space-y-1.5"><div className="flex justify-between text-sm font-semibold"><span>{t('pms.scan.ocrConfidence')}</span><span>{confidence === null ? t('pms.scan.confidenceUnavailable') : `${confidence}%`}</span></div>{confidence !== null && <div role="progressbar" aria-label={t('pms.scan.ocrConfidence')} aria-valuenow={confidence} aria-valuemin={0} aria-valuemax={100} className="h-2 rounded-full bg-muted overflow-hidden"><div className={`h-full rounded-full ${result.valid && !numberReview.needsReview ? 'bg-emerald-500' : 'bg-amber-500'}`} style={{ width: `${confidence}%` }}/></div>}<p className="text-[11px] text-muted-foreground">{t('pms.scan.confidenceHint')}</p></div>
            <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1 rounded-md border border-border p-3 text-sm">
              <dt className="text-muted-foreground">{t('pms.guest.familyName')}</dt><dd className="font-semibold">{result.fields.mrzLastName || '—'}</dd>
              <dt className="text-muted-foreground">{t('pms.guest.givenName')}</dt><dd className="font-semibold">{result.fields.mrzFirstName || '—'}</dd>
              <dt className="text-muted-foreground">{t('pms.guest.nationality')}</dt><dd>{result.fields.nationality}</dd>
              <dt className="text-muted-foreground">{t('pms.guest.birthDate')}</dt><dd>{result.fields.dateOfBirth ?? '—'}</dd>
              <dt className="text-muted-foreground">{t('pms.guest.gender')}</dt><dd>{result.fields.gender ? t(`pms.guest.gender${result.fields.gender[0].toUpperCase()}${result.fields.gender.slice(1)}`) : '—'}</dd>
              <dt className="text-muted-foreground">{t('pms.guest.docType')}</dt><dd>{t(result.fields.documentType === 'passport' ? 'pms.guest.docPassport' : 'pms.guest.docIdCard')}</dd>
              <dt className="text-muted-foreground">{t('pms.guest.docNumber')}</dt><dd className={numberReview.needsReview ? 'font-mono text-amber-700 dark:text-amber-300 font-semibold' : 'font-mono'}>{result.fields.documentNumber}{numberReview.needsReview && <div className="font-sans text-xs mt-1">{t('pms.scan.verifyNumber')}{numberReview.printed && <div>{t('pms.scan.printedNumber')}: <strong>{numberReview.printed}</strong></div>}</div>}</dd>
              <dt className="text-muted-foreground">{t('pms.scan.expiry')}</dt><dd>{result.fields.expiryDate ?? '—'}</dd>
            </dl>
            <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">{t('pms.scan.codeLines')}</summary><pre className="mt-1 overflow-x-auto rounded-md bg-muted px-2 py-1.5 font-mono text-[10px] leading-tight">{result.lines.join('\n')}</pre></details>
            <p className="text-[11px] text-muted-foreground">{t('pms.scan.reviewHint')}</p>

          </div>
        )}

        </div>
        <DialogFooter className="shrink-0 !flex-col gap-2 border-t border-border pt-3 pb-[env(safe-area-inset-bottom)]">
          {phase === 'review' && result && (needsReviewAcknowledgement && (
              <label className="flex cursor-pointer items-start gap-2 rounded-md border border-amber-200 p-2.5 text-xs">
                <Checkbox checked={reviewAcknowledged} onCheckedChange={(value) => setReviewAcknowledged(value === true)} className="mt-0.5 shrink-0" />
                <span>{t('pms.scan.manualReviewConfirm')}</span>
              </label>
            ))}
          {phase === 'camera' && side === 'mrz' && source === 'bridge' && (
            <Button type="button" className="gap-1.5" disabled={!settings.bridgeUrl} onClick={() => void readFromBridge()}><ScanLine className="h-4 w-4" /> {t('pms.scan.readDocument')}</Button>
          )}
          {phase === 'camera' && source === 'camera' && (
            <>
              {cameraOk && <Button type="button" className="w-full gap-1.5" disabled={autoReading || flipPrompt} onClick={captureFrame}><ScanLine className="h-4 w-4" /> {autoReading ? t('pms.scan.reading') : side === 'front' ? t('pms.scan.captureFirst') : t('pms.scan.captureBack')}</Button>}
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
