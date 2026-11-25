import type { Worker } from 'tesseract.js';
import type { OcrLine } from './codeLineRefine';

/** One worker per OCR role. Termination invalidates pending initialization
 * as well as recognition. Tesseract may leave an outstanding recognize
 * promise unresolved after terminate, so callers always race cancellation. */
export class OcrSession {
  private slot: { worker: Worker | null; promise: Promise<Worker>; cancel: () => void } | null = null;
  constructor(private readonly create: () => Promise<Worker>) {}

  warm(): Promise<Worker> {
    if (this.slot) return this.slot.promise;
    let cancel!: () => void;
    const cancelled = new Promise<never>((_, reject) => { cancel = () => reject(new Error('OCR cancelled')); });
    const slot = { worker: null as Worker | null, promise: null as unknown as Promise<Worker>, cancel };
    this.slot = slot;
    const loading = this.create().then(worker => {
      if (this.slot !== slot) {
        void worker.terminate().catch(() => undefined);
        throw new Error('OCR cancelled');
      }
      slot.worker = worker;
      return worker;
    });
    let initTimer: ReturnType<typeof setTimeout> | undefined;
    const initTimeout = new Promise<never>((_, reject) => {
      initTimer = setTimeout(() => reject(new Error('OCR initialization timeout')), 15000);
    });
    slot.promise = Promise.race([loading, cancelled, initTimeout]).catch(error => {
      if (this.slot === slot) this.reset();
      throw error;
    }).finally(() => { if (initTimer !== undefined) clearTimeout(initTimer); });
    return slot.promise;
  }

  get ready(): boolean { return !!this.slot?.worker; }

  async recognize(canvas: HTMLCanvasElement, timeoutMs: number): Promise<string> {
    return (await this.recognizeWithConfidence(canvas, timeoutMs)).text;
  }

  async recognizeWithConfidence(canvas: HTMLCanvasElement, timeoutMs: number, pageSegMode?: '6' | '7' | '11'): Promise<{ text: string; confidence: number | null }> {
    const { text, confidence } = await this.recognizeDetailed(canvas, timeoutMs, pageSegMode, false);
    return { text, confidence };
  }

  /** As above, optionally with the position of every recognised line, which
   * lets the caller straighten and re-read a region of the same picture. */
  async recognizeDetailed(canvas: HTMLCanvasElement, timeoutMs: number, pageSegMode?: '6' | '7' | '11', withLines = true): Promise<{ text: string; confidence: number | null; lines: OcrLine[] }> {
    if (timeoutMs <= 0) throw new Error('OCR timeout');
    const workerPromise = this.warm();
    const slot = this.slot!;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // A reset after initialization must also wake a pending recognition.
    let cancelJob!: () => void;
    const cancelled = new Promise<never>((_, reject) => { cancelJob = () => reject(new Error('OCR cancelled')); });
    const cancelWarm = slot.cancel;
    slot.cancel = () => { cancelWarm(); cancelJob(); };
    try {
      return await Promise.race([
        workerPromise.then(async worker => {
          if (this.slot !== slot) throw new Error('OCR cancelled');
          if (pageSegMode) await worker.setParameters({ tessedit_pageseg_mode: pageSegMode } as never);
          if (this.slot !== slot) throw new Error('OCR cancelled');
          return withLines ? worker.recognize(canvas, {}, { text: true, blocks: true }) : worker.recognize(canvas);
        }).then(({ data }) => ({
          text: data.text ?? '',
          confidence: Number.isFinite(data.confidence) ? Math.max(0, Math.min(100, data.confidence)) : null,
          lines: (data.blocks ?? []).flatMap(block => (block.paragraphs ?? []).flatMap(paragraph => (paragraph.lines ?? []).map(line => ({ text: line.text ?? '', bbox: line.bbox, baseline: line.baseline })))),
        })),
        cancelled,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            if (this.slot === slot) this.reset();
            reject(new Error('OCR timeout'));
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (this.slot === slot) slot.cancel = cancelWarm;
    }
  }

  reset() {
    const slot = this.slot;
    this.slot = null;
    if (!slot) return;
    slot.cancel();
    if (slot.worker) void slot.worker.terminate().catch(() => undefined);
  }
}
