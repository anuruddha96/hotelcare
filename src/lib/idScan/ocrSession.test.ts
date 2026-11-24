import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Worker } from 'tesseract.js';
import { OcrSession } from './ocrSession';

afterEach(() => vi.useRealTimers());

function fakeWorker() {
  const terminate = vi.fn(async () => undefined);
  const recognize = vi.fn(() => new Promise<never>(() => undefined));
  return { worker: { terminate, recognize } as unknown as Worker, terminate, recognize };
}
describe('OCR session lifetime', () => {
  it('prewarms once and terminates on cancellation', async () => {
    const w = fakeWorker();
    const create = vi.fn(async () => w.worker);
    const session = new OcrSession(create);
    await Promise.all([session.warm(), session.warm()]);
    expect(create).toHaveBeenCalledTimes(1);
    expect(session.ready).toBe(true);
    const pending = session.recognize({} as HTMLCanvasElement, 4000);
    const rejected = expect(pending).rejects.toThrow('cancelled');
    session.reset();
    await rejected;
    expect(w.terminate).toHaveBeenCalledTimes(1);
    expect(session.ready).toBe(false);
  });
  it('terminates a worker that finishes initializing after close', async () => {
    const w = fakeWorker();
    let resolve!: (worker: Worker) => void;
    const session = new OcrSession(() => new Promise<Worker>(r => { resolve = r; }));
    const pending = session.warm();
    const rejected = expect(pending).rejects.toThrow('cancelled');
    session.reset();
    resolve(w.worker);
    await rejected;
    expect(w.terminate).toHaveBeenCalledTimes(1);
  });
  it('timeboxes a hung recognition and releases its worker', async () => {
    vi.useFakeTimers();
    const w = fakeWorker();
    const session = new OcrSession(async () => w.worker);
    await session.warm();
    const pending = session.recognize({} as HTMLCanvasElement, 4000);
    const rejected = expect(pending).rejects.toThrow(/cancelled|timeout/);
    await vi.advanceTimersByTimeAsync(4000);
    await rejected;
    expect(w.terminate).toHaveBeenCalledTimes(1);
    expect(session.ready).toBe(false);
  });
});
