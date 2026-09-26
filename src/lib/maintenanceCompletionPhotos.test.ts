import { describe, expect, it } from 'vitest';
import { mergeCompletionPhotos, validateCompletionFiles } from './maintenanceCompletionPhotos';

const image = (type = 'image/jpeg', size = 1024) => ({ type, size });

describe('maintenance completion photos', () => {
  it('preserves historical images and appends multiple unique uploads', () => {
    expect(mergeCompletionPhotos(['old/first.jpg', 'old/second.jpg'],
      ['new/a.jpg', 'new/b.jpg', 'old/first.jpg']))
      .toEqual(['old/first.jpg', 'old/second.jpg', 'new/a.jpg', 'new/b.jpg']);
  });
  it('handles null old evidence and idempotent retries', () => {
    expect(mergeCompletionPhotos(null, ['one', 'one', 'two'])).toEqual(['one', 'two']);
    expect(mergeCompletionPhotos(['one', 'two'], [])).toEqual(['one', 'two']);
  });
  it('requires valid images and limits count and size', () => {
    expect(validateCompletionFiles([])).toBeTruthy();
    expect(validateCompletionFiles([image()])).toBeNull();
    expect(validateCompletionFiles([image('application/pdf')])).toBeTruthy();
    expect(validateCompletionFiles([image('image/jpeg', 16 * 1024 * 1024)])).toBeTruthy();
    expect(validateCompletionFiles(Array.from({ length: 11 }, () => image()))).toBeTruthy();
  });
});
