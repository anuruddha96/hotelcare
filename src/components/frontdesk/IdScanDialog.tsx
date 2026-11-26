import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Camera, CheckCircle2, Flashlight, FlashlightOff, ImageUp, Keyboard, Loader2, PlugZap, RotateCw, ScanLine, TriangleAlert } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useTranslation } from '@/hooks/useTranslation';
import { useAuth } from '@/hooks/useAuth';
import type { Worker as TesseractWorker } from 'tesseract.js';
import { readMrz, type MrzReadResult } from '@/lib/idScan/mrz';
import { codeLineGeometry, printedZone, refineCodeBlock, repairLookAlikes, toGray, sampleStraight, normalizeText, padWhite, type CodeGeometry, type Gray } from '@/lib/idScan/codeLineRefine';
import { agreePrinted, parsePrintedText, printedGuestFields, type PrintedRead } from '@/lib/idScan/printedFields';
import { guideCrop, privacyThumbnail, snapshotFrame, type SourceRect } from '@/lib/idScan/frameCapture';
import { OcrSession } from '@/lib/idScan/ocrSession';
import { HUNGARIAN_BACK_ROWS, estimateCardRect, printedRowRect, mergeHungarianRows, needsHungarianPrintedFallback, rowHasLabel, corroboratedMotherName, mergeHungarianFallback } from '@/lib/idScan/hungarianCard';
import { shouldAdvanceFront, printedRegion } from '@/lib/idScan/stillCapture';
import { documentNumberReview, scanConfidence } from '@/lib/idScan/scanReview';
import { recoverPassportBirthplace, hasPassportBirthplaceLabel, numberedUkBirthplaceRegions, numberedBirthplaceLabel, recoverNumberedBirthplace, type BirthplaceRowRead } from '@/lib/idScan/passportBirthPlace';
import { sampleUkRegion, ukLegacyRegions, localPassportContrast, passportOtsu, verifiedLegacyBirthplace } from '@/lib/idScan/ukPassportVisual';
import { suggestPassportAbsences, PASSPORT_ABSENCE_KEYS, type PassportAbsences } from '@/lib/idScan/passportAbsence';
import { opticalGuestFields, guestScanPatch, type OpticalGuestFields } from '@/lib/idScan/opticalGuestFields';
import { harmonizeNameAccents } from '@/lib/idScan/nameAccents';
import { assessReadiness, type Readiness } from '@/lib/idScan/autoCapture';
import { assessIdFront, looksLikeIdFront, type IdFrontAssessment } from '@/lib/idScan/idFront';
import { firstSideAction, nextMrzScanAction, looksLikePassport, classifyFirstCapture, canAdvanceToIdBack, type FirstCaptureKind } from '@/lib/idScan/documentScanFlow';
import { Checkbox } from '@/components/ui/checkbox';
import { DocumentReviewPreview } from './DocumentReviewPreview';
import { ScanProcessing, type ScanStep } from './ScanProcessing';
import {
  fetchBridgeScan, isLoopbackUrl, loadScannerSettings, saveScannerSettings, wedgeInputLooksComplete, wedgeInputToMrzText,
  type ScannerSettings, type ScannerSource,
} from '@/lib/idScan/scannerDevices';
import {
  AUTO_TORCH_START, acquireCamera, autoTorchStep, cameraWasAsked, holdCamera, isAppleTouchDevice, loadCameraPrefs, nextTorchMode,
  releaseCamera, saveCameraPrefs, setTorch, torchAvailable, torchIsOn, type AutoTorch, type TorchMode,
} from '@/lib/idScan/cameraSession';

/**
 * Passport / ID-card scan at the front desk.
 *
 * Three sources, chosen per workstation and remembered:
 *   - Camera (or a photo on iPads/phones),
 *   - a document reader attached to the computer that types the code lines
 *     (keyboard output — ARH, Access-IS, Desko, 3M …),
 *   - a reader service on this computer (http://localhost…, Plustek/Granus style).
 *
 * Camera → crop the code-line band → OCR in the browser (tesseract.js, loaded
 * only when needed) → ICAO MRZ parse with check digits → staff review → fields
 * handed to the guest form.
 *
 * What staff see: the live camera only while aiming. From the moment a capture
 * starts, the picture is replaced by a blurred colour field (a ≤40 px copy) and
 * an animated progress card; when reading is done only the details appear, as
 * text. The capture is never shown sharp, uploaded or stored; canvases are
 * wiped after reading. This dialog is the one document scan used by every
 * check-in flow (guest details, in-house guest list, express check-in).
 */

export type ScanApplyOutcome = 'applied' | 'identity-mismatch' | 'confirm-name-change' | 'unavailable';

interface IdScanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  previousDocumentType?: string | null;
  onApply: (result: MrzReadResult, optical?: OpticalGuestFields, confirmNameChange?: boolean, confirmedAbsences?: PassportAbsences) => ScanApplyOutcome | void;
}

type Phase = 'camera' | 'reading' | 'front_preview' | 'review' | 'failed';
type DocumentSide = 'mrz' | 'front'; // 'front' is ALWAYS the initial camera capture.

/** Grayscale + contrast stretch + upscale: OCR reads MRZ much better this way. */
function bandLayout(width: number, height: number, band: 'bottom' | 'lower' | 'full', live: boolean) {
  const top = band === 'bottom' ? Math.floor(height * (live ? 0.51 : 0.58)) : band === 'lower' ? Math.floor(height * 0.3) : 0;
  return { top, scale: Math.min(3, 1600 / width) };
}

/** In-memory luminance copy of a captured frame for the tighter second reading. */
function frameGray(frame: HTMLCanvasElement): Gray | null {
  const ctx = frame.getContext('2d', { willReadFrequently: true });
  if (!ctx || !frame.width || !frame.height) return null;
  const pixels = ctx.getImageData(0, 0, frame.width, frame.height);
  const gray = toGray(pixels.data, frame.width, frame.height);
  pixels.data.fill(0);
  return gray;
}

function grayCanvas(image: Gray): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = image.width; canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const pixels = ctx.createImageData(image.width, image.height);
    for (let i = 0, p = 0; i < image.data.length; i++, p += 4) {
      pixels.data[p] = pixels.data[p + 1] = pixels.data[p + 2] = image.data[i];
      pixels.data[p + 3] = 255;
    }
    ctx.putImageData(pixels, 0, 0);
  }
  image.data.fill(0);
  return canvas;
}

function prepareBand(source: CanvasImageSource, width: number, height: number, band: 'bottom' | 'lower' | 'full', live = false, enhanced = true): HTMLCanvasElement {
  const { top, scale } = bandLayout(width, height, band, live);
  const cropH = height - top;
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
    const out = enhanced ? (v < 128 ? Math.max(0, v - 40) : Math.min(255, v + 40)) : v;
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
  let worker: TesseractWorker;
  try { worker = await createWorker(['hun', 'eng']); }
  catch { worker = await createWorker('eng'); }
  try { await worker.setParameters({ tessedit_pageseg_mode: '6' } as never); return worker; }
  catch (error) { await worker.terminate().catch(() => undefined); throw error; }
}

/** Hungarian-only model for the small printed rows on a Hungarian ID back:
 * it keeps accented capitals that the mixed model tends to drop. */
async function createHungarianOcrWorker(): Promise<TesseractWorker> {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('hun');
  try { await worker.setParameters({ tessedit_pageseg_mode: '6' } as never); return worker; }
  catch (error) { await worker.terminate().catch(() => undefined); throw error; }
}

/** While the printed rows are read the progress card stays up; past this the
 * details are shown anyway and the remaining rows fill in underneath. */
const REVEAL_AFTER_MS = 12_000;

/** Enhance small printed characters without the MRZ-specific thresholding. */
function printedCanvas(frame: HTMLCanvasElement, idBack: boolean, enhanced = false) {
  const region = printedRegion(frame.width, frame.height, idBack, enhanced);
  const canvas = document.createElement('canvas');
  const scale = Math.min(2.5, 1800 / region.width);
  canvas.width = Math.max(1, Math.round(region.width * scale));
  canvas.height = Math.max(1, Math.round(region.height * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (ctx) {
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(frame, region.x, region.y, region.width, region.height, 0, 0, canvas.width, canvas.height);
    if (enhanced) {
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = pixels.data;
      for (let i = 0; i < data.length; i += 4) {
        const gray = 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
        const value = Math.max(0, Math.min(255, (gray - 128) * 1.45 + 128));
        data[i] = data[i+1] = data[i+2] = value;
      }
      ctx.putImageData(pixels, 0, 0); data.fill(0);
    }
  }
  return canvas;
}

export function IdScanDialog({ open, onOpenChange, onApply, previousDocumentType }: IdScanDialogProps) {
  const { t } = useTranslation();
  const { profile } = useAuth();
  // Loading a saved photo exists only for specimen tests (VIZA validation) on
  // the sandbox test hotel and for administrators. At a live desk the document
  // is read from the camera and no photo of it is kept anywhere.
  const photoTesting = profile?.organization_slug === 'channex' || profile?.role === 'admin';
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scanRunRef = useRef(0);
  const cameraSessionRef = useRef(0);
  const [phase, setPhase] = useState<Phase>('camera');
  const [side, setSide] = useState<DocumentSide>('front');
  const [captureKind, setCaptureKind] = useState<FirstCaptureKind>('unknown');
  const passportEvidenceRef = useRef(false);
  const frontRef = useRef({ captured: false, positive: false, text: '' });
  // Extra reading of a Hungarian ID front with the Hungarian model (accents).
  const frontAccentRef = useRef<{ promise: Promise<string[]> } | null>(null);
  const busyRef = useRef<number | null>(null);
  const backdropRef = useRef<HTMLCanvasElement | null>(null);
  const [backdrop, setBackdrop] = useState<HTMLCanvasElement | null>(null);
  const [step, setStep] = useState<ScanStep>('reading');
  // The details stay behind the progress card until the reading is done.
  const [revealed, setRevealed] = useState(true);
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [frontConfidence, setFrontConfidence] = useState<number | null>(null);
  const clearBackdrop = useCallback(() => {
    if (backdropRef.current) wipe(backdropRef.current);
    backdropRef.current = null;
    setBackdrop(null);
  }, []);
  const showBackdrop = (frame: HTMLCanvasElement) => {
    clearBackdrop();
    const tiny = privacyThumbnail(frame);
    backdropRef.current = tiny;
    setBackdrop(tiny);
  };
  const clearRevealTimer = useCallback(() => {
    if (revealTimerRef.current !== null) clearTimeout(revealTimerRef.current);
    revealTimerRef.current = null;
  }, []);
  const [torchMode, setTorchMode] = useState<TorchMode>(() => loadCameraPrefs().torch);
  const torchModeRef = useRef<TorchMode>(torchMode);
  const [torchReady, setTorchReady] = useState(false);
  const [torchLit, setTorchLit] = useState(false);
  const autoTorchRef = useRef<AutoTorch>(AUTO_TORCH_START);
  const [safariTip, setSafariTip] = useState(false);
  const flipUntil = useRef(0);
  const [flipPrompt, setFlipPrompt] = useState(false);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [opticalFields, setOpticalFields] = useState<OpticalGuestFields>({});
  const [passportAbsences, setPassportAbsences] = useState<PassportAbsences>({});
  const [passportSuggestions, setPassportSuggestions] = useState<PassportAbsences>({});
  const [opticalReading, setOpticalReading] = useState(false);
  const [opticalIssue, setOpticalIssue] = useState(false);
  const [numberReview, setNumberReview] = useState<{ needsReview: boolean; printed: string | null }>({ needsReview: false, printed: null });
  const [mrzSession] = useState(() => new OcrSession(createOcrWorker));
  const [frontSession] = useState(() => new OcrSession(createFrontOcrWorker));
  const [hungarianSession] = useState(() => new OcrSession(createHungarianOcrWorker));
  const [guidance, setGuidance] = useState<Readiness>('holdSteady');
  const [captureProgress, setCaptureProgress] = useState(0);
  const [frontAssessment, setFrontAssessment] = useState<IdFrontAssessment | null>(null);
  const [reviewAcknowledged, setReviewAcknowledged] = useState(false);
  const [applyIssue, setApplyIssue] = useState<ScanApplyOutcome | null>(null);
  const [confirmRestart, setConfirmRestart] = useState(false);
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
    flipUntil.current = 0;
    frontSession.reset();
    hungarianSession.reset();
    frontAccentRef.current = null;
    frontRef.current = { captured: false, positive: false, text: '' };
  }, [frontSession, hungarianSession]);

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

  // One camera stream shared by every scan (see cameraSession): held between
  // the two sides and while a capture is processed, kept ready for a minute
  // after the dialog closes, so the browser is not asked again for each guest.
  const pauseCamera = useCallback(() => {
    cameraSessionRef.current += 1;
    holdCamera();
    setTorchLit(false);
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const stopCamera = useCallback(() => {
    cameraSessionRef.current += 1; // Invalidate a pending iPhone permission request.
    releaseCamera();
    setTorchLit(false);
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const startCamera = useCallback(async () => {
    const request = ++cameraSessionRef.current;
    setCameraOk(null);
    try {
      const stream = await acquireCamera();
      // The browser may answer after the dialog was closed or another source
      // selected; the shared session then stops the camera by itself.
      if (cameraSessionRef.current !== request || !videoRef.current) return;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      if (cameraSessionRef.current !== request) return;
      autoTorchRef.current = AUTO_TORCH_START;
      const hasTorch = torchAvailable();
      setTorchReady(hasTorch);
      if (hasTorch && torchModeRef.current === 'on') void setTorch(true).then(ok => { if (ok && cameraSessionRef.current === request) setTorchLit(true); });
      // Safari on iPad/iPhone asks on every visit until the site is allowed:
      // after the second time, say once where to switch it to Allow.
      setSafariTip(cameraWasAsked() && isAppleTouchDevice() && loadCameraPrefs().prompts >= 2);
      setCameraOk(true);
    } catch {
      if (cameraSessionRef.current === request) {
        stopCamera();
        setCameraOk(false);
      }
    }
  }, [stopCamera]);

  const cycleTorch = () => {
    const mode = nextTorchMode(torchModeRef.current);
    torchModeRef.current = mode;
    autoTorchRef.current = AUTO_TORCH_START;
    setTorchMode(mode);
    saveCameraPrefs({ ...loadCameraPrefs(), torch: mode });
    const want = mode === 'on';
    if (want !== torchIsOn()) void setTorch(want).then(ok => { if (ok) setTorchLit(want); });
  };

  useEffect(() => {
    setApplyIssue(null);
    setConfirmRestart(false);
    clearRevealTimer();
    setRevealed(true);
    setStep('reading');
    setSafariTip(false);
    if (!open) {
      scanRunRef.current += 1;
      stopCamera();
      setResult(null);
      clearBackdrop();
      clearFront();
      setFrontAssessment(null);
      setReviewAcknowledged(false);
      return;
    }
    setPhase('camera');
    setFlipPrompt(false);
    setConfidence(null);
    setFrontConfidence(null);
    clearBackdrop();
    setOpticalFields({}); setPassportAbsences({}); setPassportSuggestions({});
    setOpticalReading(false);
    setOpticalIssue(false);
    setNumberReview({ needsReview: false, printed: null });
    setSide('front');
    setCaptureKind('unknown');
    passportEvidenceRef.current = false;
    setSource('camera');
    setResult(null);
    clearFront();
    setFrontAssessment(null);
    setReviewAcknowledged(false);
    setTyped('');
    setFailReason(null);
    void mrzSession.warm().catch(() => undefined);
    void frontSession.warm().catch(() => undefined);
    return () => {
      scanRunRef.current++;
      busyRef.current = null;
      stopCamera();
      mrzSession.reset();
      clearFront();
      clearBackdrop();
      clearRevealTimer();
    };
  }, [open, stopCamera, mrzSession, frontSession, clearFront, clearBackdrop, clearRevealTimer]);

  // Do not release the stream on every phase transition. Safari can prompt
  // again when getUserMedia is called after all tracks have been stopped.
  useEffect(() => {
    if (!open || source !== 'camera') { stopCamera(); return; }
    if (phase === 'camera' && !document.hidden) void startCamera();
    else pauseCamera();
  }, [open, source, phase, startCamera, stopCamera, pauseCamera]);

  useEffect(() => {
    if (!open) return;
    const onVisibility = () => {
      if (document.hidden) stopCamera();
      else if (source === 'camera' && phase === 'camera') void startCamera();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [open, source, phase, stopCamera, startCamera]);

  useEffect(() => {
    if (!open || source !== 'wedge' || phase !== 'camera') return;
    const timer = setTimeout(() => wedgeRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, [open, source, phase]);

  // Passports are recognised from their bio-page code lines (TD3), so the
  // first capture is enough. ID cards require a front capture BEFORE TD1/TD2
  // code lines on the back. Never accept the back as scan step one.
  const readPrinted = async (session: OcrSession, frame: HTMLCanvasElement, idBack: boolean, run: number, passport = false) => {
    const texts: string[] = [];
    let score: number | null = null;
    let positiveScore: number | null = null;
    await session.warm();
    if (scanRunRef.current !== run) return { texts, score, positiveScore };
    // Separate printed area from MRZ and try a contrast-enhanced second pass.
    // Keep independent OCR results for field-level merging, not a joined
    // string that could make neighboring labels or values cross boundaries.
    for (const enhanced of [false, true]) {
      if (scanRunRef.current !== run) break;
      const canvas = printedCanvas(frame, idBack, enhanced);
      try {
        const reading = await session.recognizeWithConfidence(canvas, 12000, '6');
        if (scanRunRef.current !== run) break;
        if (reading.text.trim()) texts.push(reading.text);
        if (reading.confidence !== null) {
          score = Math.max(score ?? 0, reading.confidence);
          if (looksLikeIdFront(reading.text)) positiveScore = Math.max(positiveScore ?? 0, reading.confidence);
        }
        if (!passport && !idBack && positiveScore !== null && positiveScore > 90) break;
        // Read both passes on a Hungarian back so fallback values can be corroborated.
      } catch { /* retain any earlier successful pass */ }
      finally { wipe(canvas); }
    }
    return { texts, score, positiveScore };
  };

  // Hungarian ID front: the mixed model reads the printed name without its
  // accents. One extra reading with the Hungarian model runs in the
  // background while the card is turned over; after the back is read its
  // accents are matched to the code-line letters (nameAccents.ts).
  const readFrontAccents = async (frame: HTMLCanvasElement, alive: () => boolean): Promise<string[]> => {
    const texts: string[] = [];
    for (const enhanced of [false, true]) {
      if (!alive()) break;
      const canvas = printedCanvas(frame, false, enhanced);
      try {
        const reading = await hungarianSession.recognizeWithConfidence(canvas, 12000, '6');
        if (reading.text.trim()) texts.push(reading.text);
      } catch { /* a failed reading adds no accents */ }
      finally { wipe(canvas); }
    }
    return texts;
  };

  // A passport's MRZ does not carry birthplace. Re-read the visual zone
  // with sparse-text segmentation, then the complete page if needed.
  const readPassportBirthplace = async (frame: HTMLCanvasElement, geometry: CodeGeometry | null, run: number, reads: string[]) => {
    const extra: string[] = [];
    const scan = async (canvas: HTMLCanvasElement, mode: '6' | '11') => {
      try {
        const reading = await frontSession.recognizeWithConfidence(canvas, 10000, mode);
        if (scanRunRef.current === run && reading.text.trim()) extra.push(reading.text);
      } catch { /* retain earlier optical evidence */ }
      finally { wipe(canvas); }
    };
    if (geometry && geometry.lines === 2 && scanRunRef.current === run) {
      const gray = frameGray(frame);
      if (gray) {
        try {
          await scan(grayCanvas(printedZone(gray, geometry, 2000)), '11');
        } finally { gray.data.fill(0); }
      }
    }
    if (!recoverPassportBirthplace([...reads, ...extra]) && scanRunRef.current === run) {
      await scan(printedCanvas(frame, false, true), '11');
    }
    if (!recoverPassportBirthplace([...reads, ...extra]) && scanRunRef.current === run && geometry && geometry.lines === 2) {
      const gray = frameGray(frame);
      if (gray) {
        try { await scan(grayCanvas(printedZone(gray, geometry, 1600)), '6'); }
        finally { gray.data.fill(0); }
      }
    }
    return extra;
  };

  // The legacy numbered UK passport has a small coloured label above a
  // much larger birthplace. Isolate that row and read the value separately
  // rather than requiring whole-page OCR to preserve column order.
  const readNumberedUkBirthplace = async (frame: HTMLCanvasElement, geometry: CodeGeometry | null, issuingState: string, run: number) => {
    const regions = geometry && numberedUkBirthplaceRegions(geometry, issuingState);
    if (!geometry || !regions || scanRunRef.current !== run) return {birthplace: undefined, labelSeen: false};
    const gray = frameGray(frame);
    if (!gray) return {birthplace: undefined, labelSeen: false};
    const ctx = frame.getContext('2d', {willReadFrequently:true});
    let red: Gray | null = null;
    if (ctx) {
      const rgba = ctx.getImageData(0,0,frame.width,frame.height);
      const data = new Uint8ClampedArray(frame.width*frame.height);
      for (let i=0;i<data.length;i++) data[i]=rgba.data[i*4];
      rgba.data.fill(0);
      red={data,width:frame.width,height:frame.height};
    }
    const scan = async (region: typeof regions.row, source: Gray, mode: '6'|'7'|'11', enhanced: boolean, width: number): Promise<BirthplaceRowRead> => {
      if (scanRunRef.current !== run) return {text:'',confidence:null};
      const crop = sampleStraight(source,geometry.cx,geometry.cy,geometry.angle,region.u0,region.v0,region.u1,region.v1,width);
      const normalized=enhanced?normalizeText(crop):crop;
      const padded=padWhite(normalized,30);
      crop.data.fill(0); normalized.data.fill(0);
      const canvas=grayCanvas(padded);
      try {
        const reading=await frontSession.recognizeWithConfidence(canvas,6500,mode);
        return scanRunRef.current===run?reading:{text:'',confidence:null};
      } catch { return {text:'',confidence:null}; }
      finally { wipe(canvas); }
    };
    try {
      const row=await scan(regions.row,gray,'6',true,1200);
      const direct=recoverPassportBirthplace([row.text]);
      const labelRead=await scan(regions.label,red??gray,'11',true,1350);
      const label=[row.text,labelRead.text].find(numberedBirthplaceLabel)??'';
      if(!label) return {birthplace:undefined,labelSeen:false};
      const first=await scan(regions.value,gray,'7',false,950);
      const second=await scan(regions.value,red??gray,'7',true,1200);
      const birthplace=recoverNumberedBirthplace(label,[first,second]);
      // Disagreement with a labeled complete-row read stays unresolved.
      return {birthplace:birthplace && (!direct || direct.normalize('NFD').toLowerCase()===birthplace.normalize('NFD').toLowerCase())?birthplace:undefined,labelSeen:true};
    } finally { gray.data.fill(0); red?.data.fill(0); }
  };

  // Recover the value even when security printing prevents recognition of
  // the tiny field label, but only on a separately verified legacy layout.
  const readVerifiedUkBirthplace = async (frame: HTMLCanvasElement, geometry: CodeGeometry | null, result: MrzReadResult, run: number) => {
    if (!geometry || geometry.lines !== 2 || !result.valid || result.unknownCountry || result.fields.issuingState !== 'GBR' || scanRunRef.current !== run) return undefined;
    const ctx=frame.getContext('2d',{willReadFrequently:true});
    if(!ctx)return undefined;
    const rgba=ctx.getImageData(0,0,frame.width,frame.height);
    const data=new Uint8ClampedArray(frame.width*frame.height);
    for(let i=0;i<data.length;i++)data[i]=rgba.data[i*4+2];
    rgba.data.fill(0);
    const source={data,width:frame.width,height:frame.height};
    const scan=async (region:typeof ukLegacyRegions[keyof typeof ukLegacyRegions],method:'contrast'|'otsu'):Promise<BirthplaceRowRead>=>{
      if(scanRunRef.current!==run)return {text:'',confidence:null};
      const crop=sampleUkRegion(source,geometry,region);
      const processed=method==='contrast'?localPassportContrast(crop):passportOtsu(crop);
      const padded=padWhite(processed,24);
      crop.data.fill(0);processed.data.fill(0);
      const canvas=grayCanvas(padded);
      try {
        const read=await frontSession.recognizeWithConfidence(canvas,6500,'7');
        return scanRunRef.current===run?read:{text:'',confidence:null};
      } catch {return {text:'',confidence:null};}
      finally {wipe(canvas);}
    };
    try{
      const surname=await scan(ukLegacyRegions.surname,'otsu');
      const expiry=await scan(ukLegacyRegions.expiry,'otsu');
      const contrast=await scan(ukLegacyRegions.value,'contrast');
      const binary=await scan(ukLegacyRegions.value,'otsu');
      return verifiedLegacyBirthplace(result,surname,expiry,[contrast,binary]);
    }finally{data.fill(0);}
  };

  const readHungarianRows = async (frame: HTMLCanvasElement, run: number) => {
    const gray = graySample(frame, {x:0,y:0,width:frame.width,height:frame.height});
    const h = gray.length / 320;
    const box = estimateCardRect(gray, 320, h);
    gray.fill(0);
    const card = {x:box.x*frame.width/320,y:box.y*frame.height/h,
      width:box.width*frame.width/320,height:box.height*frame.height/h};
    const rows: Array<{row: typeof HUNGARIAN_BACK_ROWS[number]; label:string; value:string; confidence:number|null}> = [];
    for (const row of HUNGARIAN_BACK_ROWS) {
      if (scanRunRef.current !== run) break;
      let label = '';
      for (const pass of ['label', 'raw', 'enhanced'] as const) {
        const valueOnly = pass !== 'label';
        if (scanRunRef.current !== run) break;
        if (valueOnly && !rowHasLabel(row,label)) break;
        const region=printedRowRect(card,row,valueOnly);
        const canvas=document.createElement('canvas');
        const scale=Math.min(3, 1500/region.width);
        canvas.width=Math.max(1,Math.round(region.width*scale))+32;
        canvas.height=Math.max(1,Math.round(region.height*scale))+32;
        const ctx=canvas.getContext('2d',{willReadFrequently:true});
        try {
          if (!ctx) continue;
          ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);
          ctx.drawImage(frame,region.x,region.y,region.width,region.height,16,16,canvas.width-32,canvas.height-32);
          if (pass === 'enhanced') {
            const pixels=ctx.getImageData(16,16,canvas.width-32,canvas.height-32);
            const d=pixels.data, hist=new Uint32Array(256);
            for(let i=0;i<d.length;i+=4){const v=Math.round(.299*d[i]+.587*d[i+1]+.114*d[i+2]);d[i]=v;hist[v]++;}
            const quantile=(q:number)=>{let n=0;for(let i=0;i<256;i++){n+=hist[i];if(n>=q*d.length/4)return i;}return 255;};
            const low=quantile(.035),high=quantile(.85);
            const threshold=Math.max(70,Math.min(150,low+(high-low)*.30));
            for(let i=0;i<d.length;i+=4){const v=d[i]<threshold?0:255;d[i]=d[i+1]=d[i+2]=v;}
            ctx.putImageData(pixels,16,16);d.fill(0);
          }
          const reading=await frontSession.recognizeWithConfidence(canvas,6000,valueOnly?'7':'6');
          if (scanRunRef.current!==run) break;
          if (!valueOnly) label=reading.text;
          else rows.push({row,label,value:reading.text,confidence:reading.confidence});
        } catch { /* no value is invented after a timeout */ }
        finally { wipe(canvas); }
      }
    }
    return { fields: mergeHungarianRows(true,rows), confirmedMother: corroboratedMotherName(rows) };
  };

  // Printed rows above the code lines of an ID back, located from the code
  // lines themselves. Three readings at different sizes; a value is proposed
  // only when two of them agree.
  const readPrintedZone = async (frame: HTMLCanvasElement, geometry: CodeGeometry, hungarian: boolean, givenName: string, run: number): Promise<OpticalGuestFields> => {
    const gray = frameGray(frame);
    if (!gray) return {};
    const session = hungarian ? hungarianSession : frontSession;
    const reads: PrintedRead[] = [];
    try {
      for (const width of [1500, 1900, 1200]) {
        if (scanRunRef.current !== run) return {};
        const canvas = grayCanvas(printedZone(gray, geometry, width));
        try {
          const { text } = await session.recognizeWithConfidence(canvas, 12000, '6');
          reads.push(parsePrintedText(text, hungarian));
        } catch { /* a timed-out reading simply does not vote */ }
        finally { wipe(canvas); }
        const agreed = agreePrinted(reads);
        if (reads.length === 2 && agreed.birth_place && agreed.birth_name && agreed.mother_name) break;
      }
    } finally {
      gray.data.fill(0);
      if (hungarian) hungarianSession.reset();
    }
    return printedGuestFields(agreePrinted(reads), givenName);
  };

  const completeMrz = async (parsed: MrzReadResult, run = scanRunRef.current, ocrConfidence: number | null = null, frame?: HTMLCanvasElement, geometry: CodeGeometry | null = null) => {
    if (scanRunRef.current !== run) return;
    const front = frontRef.current;
    const action = nextMrzScanAction(parsed, front.captured, front.positive);
    setFailReason(null);
    setReviewAcknowledged(false);
    pauseCamera();
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
    setPassportAbsences({}); setPassportSuggestions({});
    setConfidence(scanConfidence(ocrConfidence));
    setNumberReview(documentNumberReview(parsed, front.text));
    setFlipPrompt(false);
    if (action === 'passport_complete') {
      passportEvidenceRef.current = true;
      setCaptureKind('passport');
      setSide('front');
      setFrontAssessment(null);
    } else {
      setSide('mrz');
      const assessment = assessIdFront(front.text, parsed.fields);
      setFrontAssessment(assessment.status === 'unreadable' ? { status: 'needs_review', matchedFields: [] } : assessment);
    }
    const frontText = action === 'id_complete' ? front.text : '';
    const frontAccent = action === 'id_complete' ? frontAccentRef.current : null;
    setOpticalFields(opticalGuestFields(parsed, frontText, ''));
    setOpticalReading(!!frame);
    setOpticalIssue(false);
    // Preserve the already initialized printed OCR worker for the back.
    frontRef.current = {captured:false, positive:false, text:''};
    clearRevealTimer();
    if (frame) {
      // Keep the progress card up while the printed rows are read; show the
      // details when that is done, or after REVEAL_AFTER_MS at the latest.
      setStep('details');
      setRevealed(false);
      revealTimerRef.current = setTimeout(() => {
        revealTimerRef.current = null;
        if (scanRunRef.current === run) { setRevealed(true); clearBackdrop(); }
      }, REVEAL_AFTER_MS);
    } else {
      setRevealed(true);
      clearBackdrop();
    }
    setPhase('review');
    // Read the printed fields on the back (or passport bio page) as well as
    // the MRZ. Only labeled values go into the proposed guest form. The
    // original machine-readable result remains frozen and separate.
    if (frame) {
      let copy: HTMLCanvasElement | null = null;
      try {
        copy = snapshotFrame(frame, frame.width, frame.height);
        const hungarian = action === 'id_complete' && parsed.format === 'TD1' && (parsed.fields.issuingState === 'HUN' || parsed.fields.nationalityIso3 === 'HUN' || /HUNGARY|MAGYARORSZ[AÁ]G/i.test(frontText));
        const complete = (v: OpticalGuestFields) => !needsHungarianPrintedFallback(true, v);
        // Wait (at most 8 s) for the Hungarian reading of the front started
        // while the card was turned over; it only adds accents to names.
        const accentTexts = frontAccent
          ? await Promise.race([frontAccent.promise, new Promise<string[]>(resolve => setTimeout(() => resolve([]), 8000))])
          : [];
        if (frontAccentRef.current === frontAccent) frontAccentRef.current = null;
        const frontAll = [frontText, ...accentTexts].filter(t => t.trim()).join('\n--- OCR PASS ---\n');
        // ID back with located code lines: read the straightened printed
        // rows. The older whole-picture reading remains the fallback.
        const located = action === 'id_complete' && parsed.format === 'TD1' && geometry
          ? await readPrintedZone(copy, geometry, hungarian, parsed.fields.mrzFirstName, run) : null;
        // Agreed readings of the located rows stand on their own: a single
        // whole-picture reading must not overwrite or complete them.
        const { texts, score } = located ? { texts: ['located'], score: null } : await readPrinted(frontSession, copy, hungarian, run, action === 'passport_complete');
        let extracted = located
          ? { ...opticalGuestFields(parsed, frontAll, ''), ...located }
          : hungarian
            ? mergeHungarianFallback(opticalGuestFields(parsed, frontAll, ''),
              printedGuestFields(agreePrinted(texts.map(text => parsePrintedText(text, true))), parsed.fields.mrzFirstName))
            : opticalGuestFields(parsed, frontAll, texts.join('\n--- OCR PASS ---\n'));
        if (needsHungarianPrintedFallback(hungarian, extracted) && scanRunRef.current === run) {
          const targeted = await readHungarianRows(copy, run);
          extracted = mergeHungarianFallback(extracted, targeted.fields, targeted.confirmedMother);
        }
        // A partial located result (including {}) must not suppress the
        // wider printed-zone OCR. Keep agreed evidence from both passes.
        if (located && needsHungarianPrintedFallback(hungarian, extracted) && scanRunRef.current === run) {
          const wider = await readPrinted(frontSession, copy, true, run);
          const agreed = printedGuestFields(agreePrinted(wider.texts.map(text => parsePrintedText(text, true))), parsed.fields.mrzFirstName);
          extracted = mergeHungarianFallback(extracted, agreed);
        }
        let birthplaceReads: string[] = [];
        let targetedBirthplaceLabel = false;
        if (action === 'passport_complete' && scanRunRef.current === run) {
          // Read each pass separately to avoid joining unrelated headers/values.
          let birthplace = recoverPassportBirthplace(texts);
          if (!birthplace || !extracted.birth_place) {
            birthplaceReads = await readPassportBirthplace(copy, geometry, run, texts);
            birthplace = recoverPassportBirthplace([...texts, ...birthplaceReads]);
          }
          if (!birthplace && scanRunRef.current === run) {
            birthplace = await readVerifiedUkBirthplace(copy, geometry, parsed, run);
          }
          if (!birthplace && scanRunRef.current === run) {
            const targeted = await readNumberedUkBirthplace(copy, geometry, parsed.fields.issuingState, run);
            birthplace = targeted.birthplace;
            targetedBirthplaceLabel = targeted.labelSeen;
          }
          const candidates = [...texts, ...birthplaceReads];
          if (birthplace) extracted = {...extracted, birth_place: birthplace};
          else if (targetedBirthplaceLabel || candidates.some(hasPassportBirthplaceLabel)) {
            // A detected but unresolved birthplace must not become a guessed value.
            extracted = {...extracted};
            delete extracted.birth_place;
          }
        }
        // Current and birth names written twice get the same accents.
        extracted = harmonizeNameAccents(extracted, parsed.fields.nationalityIso3 === 'HUN' || parsed.fields.issuingState === 'HUN');
        if (scanRunRef.current === run) {
          setOpticalFields(extracted);
          const suggestions = suggestPassportAbsences(parsed, extracted, texts, score);
          if (targetedBirthplaceLabel || birthplaceReads.some(hasPassportBirthplaceLabel)) delete suggestions.birth_place_absent;
          setPassportAbsences(suggestions);
          setPassportSuggestions(suggestions);
          setOpticalIssue(!texts.length || (hungarian && !complete(extracted)) || (action === 'passport_complete' && !extracted.birth_place && !suggestions.birth_place_absent));
          setReviewAcknowledged(false);
        }
      } catch { if(scanRunRef.current===run) setOpticalIssue(true); }
      finally {
        if (copy) wipe(copy);
        if (scanRunRef.current === run) {
          setOpticalReading(false);
          clearRevealTimer();
          setRevealed(true);
          clearBackdrop();
        }
      }
    }
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

  const advanceFront = (kind: FirstCaptureKind, explicitlyConfirmedId = false) => {
    if (!canAdvanceToIdBack(kind, frontRef.current.captured, explicitlyConfirmedId) || passportEvidenceRef.current) return;
    setCaptureKind('id_card');
    clearBackdrop();
    setFrontAssessment(null);
    flipUntil.current = performance.now() + 1600;
    setFlipPrompt(true);
    setSide('mrz');
    setSource('camera');
    setPhase('camera');
  };

  const acceptFront = async (frame: HTMLCanvasElement, run: number) => {
    // Keep the progress card up and wait for the actual front OCR result, not
    // a guessed ID classification. A low-confidence front needs one tap.
    setStep('checking');
    frontRef.current = { captured: true, positive: false, text: '' };
    let score: number | null = null;
    let positiveScore: number | null = null;
    try {
      const reading = await readPrinted(frontSession, frame, false, run);
      if (scanRunRef.current !== run) return;
      score = reading.score;
      positiveScore = reading.positiveScore;
      frontRef.current.text = reading.texts.join('\n--- OCR PASS ---\n');
    } catch { /* no document type is inferred from a failed OCR pass */ }
    if (scanRunRef.current !== run) return;
    const kind = passportEvidenceRef.current ? 'passport' : classifyFirstCapture(frontRef.current.text, previousDocumentType === 'passport');
    setCaptureKind(kind);
    if (kind === 'passport') {
      passportEvidenceRef.current ||= looksLikePassport(frontRef.current.text);
      frontRef.current = { captured: false, positive: false, text: '' };
      clearBackdrop(); setFailReason('passport_retry'); setPhase('failed'); return;
    }
    frontRef.current.positive = kind === 'id_card';
    if (kind === 'id_card' && /MAGYARORSZ|HUNGARY/i.test(frontRef.current.text)) {
      const copy = snapshotFrame(frame, frame.width, frame.height);
      const entry: { promise: Promise<string[]> } = { promise: Promise.resolve([]) };
      frontAccentRef.current = entry;
      entry.promise = readFrontAccents(copy, () => frontAccentRef.current === entry)
        .catch(() => [] as string[])
        .finally(() => wipe(copy));
    }
    setFrontConfidence(score);
    if (shouldAdvanceFront(positiveScore, frontRef.current.positive)) advanceFront(kind);
    else { clearBackdrop(); setPhase('front_preview'); }
  };

  // Freeze a good still immediately, then process it. Do not repeatedly
  // restart OCR on a moving camera stream or discard a usable image at 4s.
  const readFrom = async (image: CanvasImageSource, width: number, height: number,
    rect?: SourceRect, automatic = false) => {
    if (busyRef.current !== null) return;
    const run = ++scanRunRef.current;
    busyRef.current = run;
    const initial = side === 'front';
    const live = !!rect;
    let frame: HTMLCanvasElement | null = null;
    let quality: Readiness = 'moveCloser';
    let partial: MrzReadResult | null = null;
    let partialConfidence: number | null = null;
    let completedPass = false;
    let gray: Gray | null = null;
    let geometry: CodeGeometry | null = null;
    const active = () => scanRunRef.current === run;
    const fail = (reason: string) => {
      if (!active()) return;
      clearBackdrop();
      setFailReason(reason);
      setPhase('failed');
    };
    try {
      frame = snapshotFrame(image, width, height, rect);
      const sample = graySample(frame, { x: 0, y: 0, width: frame.width, height: frame.height });
      quality = assessReadiness(sample, 320, null, false);
      sample.fill(0);
      if (automatic && quality !== 'ready') { setGuidance(quality); return; }
      if (initial) setCaptureKind('unknown');
      // From here on the camera picture is replaced by the progress card.
      showBackdrop(frame);
      setStep('reading');
      setPhase('reading');
      pauseCamera();
      setFailReason(null);
      await mrzSession.warm();
      if (!active()) return;
      // Read the tight band first and then the wider/full still if needed.
      // A high-confidence, valid MRZ can skip remaining passes.
      const bands: Array<{ band: 'bottom' | 'lower' | 'full'; enhanced: boolean }> = [
        { band: 'bottom', enhanced: false }, { band: 'bottom', enhanced: true },
        { band: 'lower', enhanced: true }, { band: 'full', enhanced: true },
      ];
      for (const { band, enhanced } of bands) {
        if (!active()) return;
        const prepared = prepareBand(frame, frame.width, frame.height, band, live, enhanced);
        try {
          const { text, confidence: firstScore, lines } = await mrzSession.recognizeDetailed(prepared, 10000);
          if (!active()) return;
          completedPass = true;
          if (initial && looksLikePassport(text)) passportEvidenceRef.current = true;
          let parsed = readMrz(text);
          let score = firstScore;
          let refinedRead = false;
          // The first pass shows where the code lines are. Unless they
          // already pass every check digit, straighten that block, even out
          // its lighting and read it again; then let the check digits repair
          // a single look-alike character. Names are never altered.
          const layout = bandLayout(frame.width, frame.height, band, live);
          const located = codeLineGeometry(lines, layout.scale, 0, layout.top, parsed?.format === 'TD3' || parsed?.format === 'TD2' ? 2 : parsed?.format === 'TD1' ? 3 : undefined);
          if (located && !(parsed?.valid && !parsed.unknownCountry)) {
            gray ??= frameGray(frame);
            if (gray) {
              const refined = grayCanvas(refineCodeBlock(gray, located));
              try {
                const second = await mrzSession.recognizeWithConfidence(refined, 8000);
                if (!active()) return;
                const reparsed = readMrz(second.text);
                if (reparsed && (!parsed || reparsed.valid || !parsed.valid)) { parsed = reparsed; score = second.confidence; refinedRead = true; }
              } catch { if (!active()) return; }
              finally { wipe(refined); }
            }
          }
          if (parsed && !parsed.valid) {
            const repaired = repairLookAlikes(parsed.lines, parsed.format);
            const reread = repaired ? readMrz(repaired.join('\n')) : null;
            if (reread?.valid) parsed = reread;
          }
          if (initial && parsed?.fields.documentType === 'passport') passportEvidenceRef.current = true;
          if (located && parsed && (!geometry || parsed.valid)) geometry = located;
          if (parsed && (!partial || (parsed.valid && !partial.valid) ||
            (parsed.valid === partial.valid && !parsed.unknownCountry && partial.unknownCountry) ||
            (parsed.valid === partial.valid && parsed.unknownCountry === partial.unknownCountry && (score ?? 0) > (partialConfidence ?? 0)))) {
            partial = parsed; partialConfidence = score;
          }
          if (parsed?.valid && !parsed.unknownCountry && ((score ?? 0) > 90 || refinedRead || (initial && parsed.fields.documentType === 'id_card'))) break;
          // Do not stop early on a sharp but unidentified document. The
          // full-page pass may recover the passport MRZ or its heading.
        } catch { if (!active()) return; }
        finally { wipe(prepared); }
      }
      if (!active()) return;
      if (partial) setStep('checking');
      if (initial) {
        const action = firstSideAction(partial, quality === 'ready');
        if (partial && (action === 'front_first_required' || action === 'passport_complete')) {
          await completeMrz(partial, run, partialConfidence, frame, geometry);
        } else if (passportEvidenceRef.current) {
          setCaptureKind('passport'); fail('passport_retry');
        } else if (completedPass && action === 'provisional_front') {
          await acceptFront(frame, run);
        } else if (previousDocumentType === 'passport') {
          setCaptureKind('passport'); fail('passport_retry');
        } else fail(completedPass ? 'first_not_recognized' : 'ocr_unavailable');
      } else if (partial) {
        // An imperfect result is never auto-confirmed: review stays required.
        await completeMrz(partial, run, partialConfidence, frame, geometry);
      } else fail(completedPass ? 'no_mrz' : 'ocr_unavailable');
    } catch { if (active()) fail('ocr_unavailable'); }
    finally {
      if (frame) wipe(frame);
      gray?.data.fill(0);
      if (busyRef.current === run) { busyRef.current = null; if (active()) setAutoReading(false); }
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
        // Flashlight: automatic on a dark picture, off again on glare, or as
        // set by staff. Only where the camera has one.
        if (torchAvailable()) {
          const lit = torchIsOn();
          const next = autoTorchStep(torchModeRef.current, lit, readiness, autoTorchRef.current);
          autoTorchRef.current = next.state;
          if (next.on !== lit) void setTorch(next.on).then(ok => { if (ok && active()) setTorchLit(next.on); });
        }
        stable = readiness === 'ready' ? stable + 1 : 0;
        setCaptureProgress(Math.min(100, stable * 50));
        if (stable < 2) setAutoReading(false);
        if (stable >= 2) {
          stable = 0;
          await readFrom(video, video.videoWidth, video.videoHeight, rect, true);
        }
      } catch { if (active()) setGuidance('moveCloser'); }
      finally { schedule(180); }
    };
    setGuidance('holdSteady');
    setCaptureProgress(0);
    schedule(180);
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
    frontSession.reset();
    busyRef.current = fileRun;
    setPhase('reading');
    pauseCamera();
    if (file.type && !file.type.startsWith('image/')) { busyRef.current = null; setFailReason('unsupported_image'); setPhase('failed'); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      if (scanRunRef.current !== fileRun) { URL.revokeObjectURL(url); return; }
      busyRef.current = null;
      void readFrom(img, img.naturalWidth, img.naturalHeight).finally(() => URL.revokeObjectURL(url));
    };
    img.onerror = () => { URL.revokeObjectURL(url); if (scanRunRef.current === fileRun) { busyRef.current = null; setFailReason('unsupported_image'); setPhase('failed'); } };
    img.src = url;
  };

  const retry = () => {
    scanRunRef.current += 1;
    busyRef.current = null;
    mrzSession.reset();
    setAutoReading(false);
    clearRevealTimer();
    setRevealed(true);
    clearBackdrop();
    setFlipPrompt(false);
    setTyped('');
    setFailReason(null);
    // A failed second scan keeps the successfully captured first ID side.
    if (side === 'front') { setResult(null); clearFront(); setCaptureKind(passportEvidenceRef.current || previousDocumentType === 'passport' ? 'passport' : 'unknown'); }
    setFrontAssessment(null);
    setFrontConfidence(null);
    setReviewAcknowledged(false);
    setPhase('camera');
  };

  const restart = () => {
    setApplyIssue(null);
    setConfirmRestart(false);
    scanRunRef.current += 1;
    busyRef.current = null;
    setAutoReading(false);
    clearRevealTimer();
    setRevealed(true);
    mrzSession.reset();
    setResult(null); clearFront(); clearBackdrop(); setFrontAssessment(null);
    setFlipPrompt(false); setConfidence(null); setFrontConfidence(null); setOpticalFields({}); setPassportAbsences({}); setPassportSuggestions({}); setOpticalReading(false); setOpticalIssue(false); setNumberReview({ needsReview: false, printed: null });
    setReviewAcknowledged(false);
    setSide('front'); setCaptureKind('unknown'); passportEvidenceRef.current = false; setSource('camera'); setTyped(''); setFailReason(null);
    setPhase('camera');
  };

  // An unidentified first capture is not an ID. Offer the staff an explicit
  // document-type confirmation only when no passport evidence exists.
  const manuallyCheckedFront = () => {
    if (side !== 'front' || captureKind !== 'unknown' || !frontRef.current.captured || result || passportEvidenceRef.current) return;
    advanceFront('unknown', true);
  };
  const hasPassportAbsences = PASSPORT_ABSENCE_KEYS.some(key => passportAbsences[key]);
  const needsReviewAcknowledgement = !!result && (
    hasPassportAbsences ||
    !result.valid || result.unknownCountry || numberReview.needsReview || (confidence !== null && confidence <= 90) || Object.keys(opticalFields).length > 0 ||
    (result.fields.documentType === 'id_card' && frontAssessment?.status !== 'matched')
  );
  const proposed = result ? guestScanPatch(result, opticalFields) : null;
  const expired = !!result?.fields.expiryDate && result.fields.expiryDate < new Date().toISOString().slice(0, 10);
  // From the capture until the details are ready, only the progress card shows.
  const processing = phase === 'reading' || (phase === 'review' && !!result && !revealed);

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) { scanRunRef.current += 1; busyRef.current = null; stopCamera(); mrzSession.reset(); clearFront(); clearBackdrop(); clearRevealTimer(); } onOpenChange(next); }}>
      <DialogContent aria-describedby={undefined} className="w-[calc(100%-1rem)] max-w-lg max-h-[94dvh] !h-auto flex flex-col overflow-hidden px-4 py-4 sm:!h-auto sm:max-h-[90dvh] sm:p-6" data-training="fd-id-scan">
        <DialogHeader className="shrink-0 pr-6 text-left">
          <DialogTitle className="flex items-center gap-2"><ScanLine className="h-5 w-5 text-primary" /> {t('pms.scan.title')}</DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain pr-0.5" data-training="fd-id-scan-scroll">
        {(phase === 'camera' || phase === 'front_preview') && (
          <div className="space-y-2" role="status" aria-live="polite">
            <div className="flex gap-1" aria-hidden="true"><span className="h-1.5 flex-1 rounded-full bg-primary"/>{(side === 'mrz' || captureKind === 'id_card') && <span className={side === 'mrz' ? 'h-1.5 flex-1 rounded-full bg-primary' : 'h-1.5 flex-1 rounded-full bg-muted'}/>}</div>
            {side === 'front' ? <div className="rounded-md bg-primary/5 px-3 py-2 text-sm font-semibold">{t(captureKind === 'passport' ? 'pms.scan.passportPhotoOnly' : 'pms.scan.firstStep')}</div> : <div className="flex items-center gap-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 p-3 text-emerald-800 dark:text-emerald-200"><CheckCircle2 className="h-5 w-5 shrink-0"/><div><div className="text-xs">{t('pms.scan.frontCaptured')}</div><div className="text-sm font-bold">{t('pms.scan.flipCard')}</div></div><RotateCw className="ml-auto h-5 w-5 shrink-0 motion-safe:animate-pulse"/></div>}
          </div>
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
                {cameraOk === true && <div role="status" className="pointer-events-none absolute inset-x-2 bottom-2 rounded-md bg-black/70 px-2 py-1 text-center text-xs text-white"><div>{autoReading ? t('pms.scan.reading') : guidance === 'ready' ? t('pms.scan.autoCaptureHint') : t(`pms.scan.${guidance}`)}</div><div aria-hidden="true" className="mt-1 h-1 overflow-hidden rounded-full bg-white/25"><div className="h-full rounded-full bg-emerald-400 transition-[width] duration-200" style={{width: `${autoReading ? 100 : captureProgress}%`}}/></div></div>}
                {cameraOk === true && torchReady && !flipPrompt && (
                  <button type="button" onClick={cycleTorch} aria-label={t(`pms.scan.light.${torchMode}`)} title={t(`pms.scan.light.${torchMode}`)}
                    className={`absolute right-2 top-2 z-20 flex h-9 min-w-9 items-center justify-center gap-1 rounded-full px-2.5 text-xs font-semibold shadow-sm transition-colors ${torchLit ? 'bg-amber-300 text-amber-950' : 'bg-black/60 text-white hover:bg-black/75'}`}>
                    {torchMode === 'off' ? <FlashlightOff className="h-4 w-4" aria-hidden="true" /> : <Flashlight className="h-4 w-4" aria-hidden="true" />}
                    {torchMode === 'auto' && <span aria-hidden="true">A</span>}
                  </button>
                )}
                {cameraOk === null && <Loader2 className="absolute inset-0 m-auto h-6 w-6 animate-spin text-white" />}
              </div>
            ) : (
              <div className="space-y-2 rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                <p>{t('pms.scan.noCamera')}</p>
                <Button type="button" variant="outline" size="sm" onClick={() => void startCamera()}>{t('pms.scan.retry')}</Button>
              </div>
            )}
            {safariTip && cameraOk === true && <p className="text-[11px] text-muted-foreground">{t('pms.scan.safariCameraTip')}</p>}
          </div>
        )}

        {processing && <ScanProcessing backdrop={backdrop} step={step} />}
        {phase === 'front_preview' && (
          <div className="rounded-lg border p-3 text-sm"><p className="text-muted-foreground">{t(captureKind === 'id_card' ? 'pms.scan.idFrontRecognized' : 'pms.scan.unknownDocumentRetry')}</p></div>
        )}

        {phase === 'failed' && (
          <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-3 text-sm text-amber-900 dark:text-amber-200">
            <TriangleAlert className="h-4 w-4 shrink-0 mt-0.5" /> {failReason === 'passport_retry' || (side === 'front' && captureKind === 'passport') ? t('pms.scan.passportRetry') : failReason === 'front_first' ? t('pms.scan.frontFirstRequired') : failReason === 'first_not_recognized' ? t('pms.scan.unrecognizedRetry') : failReason === 'different_document' ? t('pms.scan.differentDocument') : failReason === 'front_unreadable' ? t('pms.scan.frontUnreadable') : failReason === 'ocr_unavailable' ? t('pms.scan.ocrUnavailable') : failReason === 'unsupported_image' ? t('pms.scan.invalidPhoto') : failReason === 'no_mrz' ? t(side === 'mrz' ? 'pms.scan.idBackRetry' : 'pms.scan.unrecognizedRetry') : failReason && failReason !== 'no_document' ? t('pms.scan.serviceFailed') : t('pms.scan.notFound')}
          </div>
        )}

        {phase === 'review' && result && revealed && (
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
              {expired && <Badge variant="outline" className="border-amber-400 text-amber-700 dark:text-amber-300">{t('pms.scan.expired')}</Badge>}
            </div>
            {expired && <p role="status" className="text-sm text-amber-700 dark:text-amber-300">{t('pms.guest.requirement.expiredWarning').replace('{date}',result.fields.expiryDate ?? '')}</p>}
            <DocumentReviewPreview documentType={result.fields.documentType}>
            <dl className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-3 gap-y-2 text-sm [&_dd]:min-w-0 [&_dd]:break-words">
              <dt className="text-muted-foreground">{t('pms.guest.familyName')}</dt><dd className="font-semibold">{proposed?.last_name || '—'}</dd>
              <dt className="text-muted-foreground">{t('pms.guest.givenName')}</dt><dd className="font-semibold">{proposed?.first_name || '—'}</dd>
              <dt className="text-muted-foreground">{t('pms.guest.nationality')}</dt><dd>{proposed?.nationality || '—'}</dd>
              <dt className="text-muted-foreground">{t('pms.guest.birthDate')}</dt><dd>{proposed?.date_of_birth ?? '—'}</dd>
              <dt className="text-muted-foreground">{t('pms.guest.gender')}</dt><dd>{result.fields.gender ? t(`pms.guest.gender${result.fields.gender[0].toUpperCase()}${result.fields.gender.slice(1)}`) : '—'}</dd>
              <dt className="text-muted-foreground">{t('pms.guest.docType')}</dt><dd>{t(result.fields.documentType === 'passport' ? 'pms.guest.docPassport' : 'pms.guest.docIdCard')}</dd>
              <dt className="text-muted-foreground">{t('pms.guest.docNumber')}</dt><dd className={numberReview.needsReview ? 'font-mono text-amber-700 dark:text-amber-300 font-semibold' : 'font-mono'}>{proposed?.id_document_number || '—'}{numberReview.needsReview && <div className="font-sans text-xs mt-1">{t('pms.scan.verifyNumber')}{numberReview.printed && <div>{t('pms.scan.printedNumber')}: <strong>{numberReview.printed}</strong></div>}</div>}</dd>
              {(['birth_last_name', 'birth_first_name', 'mother_name', 'birth_place'] as const).map(key => opticalFields[key] && <div key={key} className="contents"><dt className="text-muted-foreground">{t(({ birth_last_name: 'pms.guest.birthFamilyName', birth_first_name: 'pms.guest.birthGivenName', mother_name: 'pms.guest.motherName', birth_place: 'pms.guest.birthPlace' })[key])}</dt><dd>{opticalFields[key]}</dd></div>)}
              <dt className="text-muted-foreground">{t('pms.scan.expiry')}</dt><dd>{result.fields.expiryDate ?? '—'}</dd>
            </dl>
            </DocumentReviewPreview>
            {PASSPORT_ABSENCE_KEYS.some(key => passportSuggestions[key]) && !opticalReading && <div className="rounded-md border border-border bg-muted/30 p-2.5 text-xs space-y-1.5">
              <p className="font-medium">{t('pms.scan.absenceSuggested')}</p>
              {PASSPORT_ABSENCE_KEYS.filter(key => passportSuggestions[key]).map(key => <label key={key} className="flex items-center gap-2 cursor-pointer">
                <Checkbox checked={passportAbsences[key] === true} onCheckedChange={checked => { setPassportAbsences(current => { const next = {...current}; if (checked === true) next[key] = true; else delete next[key]; return next; }); setReviewAcknowledged(false); }} />
                <span>{t(({birth_name_absent:'pms.guest.birthNameGroup',mother_name_absent:'pms.guest.motherNameGroup',birth_place_absent:'pms.guest.birthPlace'})[key])}</span>
              </label>)}
            </div>}
            {opticalIssue && !opticalReading && <p role="status" className="text-xs text-amber-700 dark:text-amber-300">{t('pms.scan.printedIncomplete')}</p>}
            {opticalReading && <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin"/>{t('pms.scan.readingPrintedFields')}</p>}
            <p className="text-[11px] text-muted-foreground">{t('pms.scan.reviewHint')}</p>

          </div>
        )}

        </div>
        <DialogFooter className="shrink-0 !flex-col gap-2 border-t border-border pt-3 pb-[env(safe-area-inset-bottom)] sm:space-x-0">
          {phase === 'review' && result && revealed && (needsReviewAcknowledgement && (
              <label className="flex cursor-pointer items-start gap-2 rounded-md border border-amber-200 p-2.5 text-xs">
                <Checkbox checked={reviewAcknowledged} onCheckedChange={(value) => setReviewAcknowledged(value === true)} className="mt-0.5 shrink-0" />
                <span>{t(hasPassportAbsences ? 'pms.scan.confirmPassportAbsences' : 'pms.scan.manualReviewConfirm')}</span>
              </label>
            ))}
          {phase === 'camera' && side === 'mrz' && source === 'bridge' && (
            <Button type="button" className="gap-1.5" disabled={!settings.bridgeUrl} onClick={() => void readFromBridge()}><ScanLine className="h-4 w-4" /> {t('pms.scan.readDocument')}</Button>
          )}
          {phase === 'camera' && source === 'camera' && (
            <>
              {cameraOk && <Button type="button" className="w-full gap-1.5" disabled={autoReading || flipPrompt} onClick={captureFrame}><ScanLine className="h-4 w-4" /> {autoReading ? t('pms.scan.reading') : side === 'front' ? t('pms.scan.captureFirst') : t('pms.scan.captureBack')}</Button>}
              {photoTesting && (
                <Button variant="outline" className="w-full" asChild>
                  <label className="relative cursor-pointer gap-1.5">
                    <ImageUp className="h-4 w-4" /> {t('pms.scan.choosePhoto')}
                    <input type="file" accept="image/*" aria-label={t('pms.scan.choosePhoto')} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" onChange={(e) => { readFile(e.currentTarget.files?.[0]); e.currentTarget.value = ''; }} />
                  </label>
                </Button>
              )}
            </>
          )}
          {phase === 'reading' && <Button type="button" variant="outline" className="w-full" onClick={retry}>{t('pms.scan.retry')}</Button>}
          {phase === 'review' && result && !revealed && <Button type="button" variant="outline" className="w-full" onClick={restart}>{t('pms.scan.retry')}</Button>}
          {phase === 'front_preview' && <>
            {captureKind === 'id_card' && <Button type="button" className="w-full" onClick={() => advanceFront('id_card')}><RotateCw className="mr-2 h-4 w-4"/>{t('pms.scan.nextSide')}</Button>}
            <Button type="button" variant={captureKind === 'id_card' ? 'outline' : 'default'} className="w-full" onClick={retry}>{t('pms.scan.retry')}</Button>
            {captureKind === 'unknown' && <Button type="button" variant="outline" className="w-full" onClick={manuallyCheckedFront}>{t('pms.scan.confirmIdType')}</Button>}
          </>}
          {phase === 'failed' && <Button type="button" variant="default" className="w-full" onClick={retry}>{t('pms.scan.retry')}</Button>}
          {phase === 'review' && result && revealed && (
            <>
              {applyIssue && applyIssue !== 'applied' && <p role="alert" className="rounded-md border border-amber-500/50 bg-amber-500/10 p-2.5 text-sm text-foreground">
                {t(applyIssue === 'confirm-name-change' ? 'pms.scan.confirmNameChange' : applyIssue === 'identity-mismatch' ? 'pms.express.identityMismatch' : 'pms.scan.applyUnavailable')}
              </p>}
              <Button type="button" className="w-full" disabled={confirmRestart || opticalReading || (result.fields.documentType === 'id_card' && !frontAssessment) || (needsReviewAcknowledgement && !reviewAcknowledged)} onClick={() => {
                const outcome = onApply(result, opticalFields, applyIssue === 'confirm-name-change', reviewAcknowledged ? passportAbsences : {});
                if (outcome && outcome !== 'applied') { setApplyIssue(outcome); return; }
                clearBackdrop();
                onOpenChange(false);
              }}>{t(applyIssue === 'confirm-name-change' ? 'pms.scan.confirmSameGuest' : 'pms.scan.use')}</Button>
              <div className="mt-2 w-full border-t border-border pt-2">
                {confirmRestart ? <div className="space-y-2">
                  <p role="alert" className="text-xs text-muted-foreground">{t('pms.scan.discardWarning')}</p>
                  <div className="grid grid-cols-2 gap-2">
                    <Button type="button" variant="outline" onClick={() => setConfirmRestart(false)}>{t('common.cancel')}</Button>
                    <Button type="button" variant="destructive" onClick={restart}>{t('pms.scan.retry')}</Button>
                  </div>
                </div> : <Button type="button" variant="ghost" className="w-full text-muted-foreground" onClick={() => setConfirmRestart(true)}>{t('pms.scan.retry')}</Button>}
              </div>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
