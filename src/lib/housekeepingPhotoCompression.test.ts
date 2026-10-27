import { describe, expect, it } from 'vitest';
import { compressHousekeepingPhoto, fitHousekeepingImage } from './housekeepingPhotoCompression';

describe('housekeeping photo compression safety', () => {
  it('preserves landscape and portrait orientation while shrinking', () => {
    expect(fitHousekeepingImage(4000, 3000)).toEqual({ width: 1600, height: 1200 });
    expect(fitHousekeepingImage(3000, 4000)).toEqual({ width: 1200, height: 1600 });
  });

  it('does not upscale already small room photos', () => {
    expect(fitHousekeepingImage(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it('does not damage guided workflow skip markers', async () => {
    const placeholder = new Blob(['<svg />'], { type: 'image/svg+xml' });
    await expect(compressHousekeepingPhoto(placeholder)).resolves.toBe(placeholder);
  });

  it('does not re-encode already-small JPEGs', async () => {
    const tinyJpeg = new Blob(['jpeg'], { type: 'image/jpeg' });
    await expect(compressHousekeepingPhoto(tinyJpeg)).resolves.toBe(tinyJpeg);
  });

  it('rejects non-image uploads', async () => {
    await expect(compressHousekeepingPhoto(new Blob(['x'], { type: 'text/plain' }))).rejects.toThrow('Only image files');
  });
});
