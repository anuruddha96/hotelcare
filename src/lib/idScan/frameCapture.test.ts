// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { guideCrop, privacyThumbnail, snapshotFrame, thumbnailSize } from './frameCapture';

afterEach(() => vi.restoreAllMocks());

describe('mobile document camera frame capture', () => {
  it('copies a live video frame synchronously before the camera can stop', () => {
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
    const video = document.createElement('video');
    const copied = snapshotFrame(video, 1920, 1080);
    expect(copied.width).toBe(1920);
    expect(copied.height).toBe(1080);
    expect(drawImage).toHaveBeenCalledExactlyOnceWith(video, 0, 0, 1920, 1080, 0, 0, 1920, 1080);
  });

  it('downscales large mobile photos without distorting document proportions', () => {
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
    const photo = document.createElement('img');
    const copied = snapshotFrame(photo, 4000, 3000);
    expect([copied.width, copied.height]).toEqual([2400, 1800]);
    expect(drawImage).toHaveBeenCalledWith(photo, 0, 0, 4000, 3000, 0, 0, 2400, 1800);
  });

  it('rejects an unready live camera frame rather than passing a blank image to OCR', () => {
    expect(() => snapshotFrame(document.createElement('video'), 0, 0)).toThrow('Invalid document frame dimensions');
  });
});

describe('object-cover guide crop', () => {
  it('maps the central visible portrait strip rather than the bottom of the full stream', () => {
    const r = guideCrop(1080, 1920, 316, 200);
    expect(r.x).toBeCloseTo(32.4);
    expect(r.width).toBeCloseTo(1015.2);
    expect(r.height).toBeCloseTo(1015.2 / 1.58);
    expect(r.y + r.height / 2).toBeCloseTo(960);
  });
  it('maps a landscape stream, accounting for the sides cropped by object-cover', () => {
    const r = guideCrop(1920, 1080, 316, 200);
    expect(r.height).toBeCloseTo(1015.2);
    expect(r.width).toBeCloseTo(1015.2 * 1.58);
    expect(r.x + r.width / 2).toBeCloseTo(960);
    expect(r.y).toBeCloseTo(32.4);
  });
  it('maps exact guide and margin independently and uses the actual crop for the shutter', () => {
    const r = guideCrop(1080, 1920, 316, 200, 0.07, 0);
    expect(r.width).toBeCloseTo(928.8);
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
    const video = document.createElement('video');
    const copied = snapshotFrame(video, 1080, 1920, r);
    expect(drawImage).toHaveBeenCalledWith(video, r.x, r.y, r.width, r.height, 0, 0, copied.width, copied.height);
    expect(() => guideCrop(1080, 1920, 0, 200)).toThrow();
  });
});

describe('processing background', () => {
  it('keeps the blurred background at 40 px or less, whatever the capture size', () => {
    expect(thumbnailSize(2400, 1520)).toEqual({ width: 40, height: 25 });
    expect(thumbnailSize(1080, 1920)).toEqual({ width: 23, height: 40 });
    expect(thumbnailSize(20, 10)).toEqual({ width: 20, height: 10 });
    expect(thumbnailSize(0, 10)).toEqual({ width: 1, height: 1 });
  });

  it('draws the capture into the tiny canvas only', () => {
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
    const source = document.createElement('canvas');
    source.width = 2400; source.height = 1520;
    const tiny = privacyThumbnail(source);
    expect([tiny.width, tiny.height]).toEqual([40, 25]);
    expect(drawImage).toHaveBeenCalledExactlyOnceWith(source, 0, 0, 40, 25);
  });
});
