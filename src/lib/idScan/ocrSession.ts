import type { Worker } from 'tesseract.js';

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
    slot.promise = Promise.race([loading, cancelled]).catch(error => {
      if (this.slot === slot) this.reset();
      throw error;
    });
    return slot.promise;
  }

  get ready(): boolean { return !!this.slot?.worker; }

  async recognize(canvas: HTMLCanvasElement, timeoutMs: number): Promise<string> {
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
        workerPromise.then(worker => {
          if (this.slot !== slot) throw new Error('OCR cancelled');
          return worker.recognize(canvas);
        }).then(({ data }) => data.text ?? ''),
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
