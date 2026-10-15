import { describe, expect, it } from 'vitest';
import { addRecheckPhotos, canSubmitRecheck, MAX_RECHECK_PHOTOS, recheckEvidencePath } from './recheckEvidence';

const photo = (name: string, type = 'image/jpeg', bytes = 1) =>
  new File([new Uint8Array(bytes)], name, { type, lastModified: 1 });

describe('manager room recheck evidence', () => {
  it('allows an image instead of forcing a typed reason', () => {
    expect(canSubmitRecheck('housekeeper-id', '', [photo('dirty-floor.jpg')])).toBe(true);
    expect(canSubmitRecheck('housekeeper-id', 'Floor still dirty', [])).toBe(true);
    expect(canSubmitRecheck('housekeeper-id', '', [])).toBe(false);
    expect(canSubmitRecheck('', 'Please recheck', [photo('proof.jpg')])).toBe(false);
  });

  it('accepts multiple photo types and ignores accidental duplicates', () => {
    const a = photo('floor.jpg'), b = photo('mirror.png', 'image/png');
    const first = addRecheckPhotos([], [a, b, a]);
    expect(first.error).toBeUndefined();
    expect(first.accepted).toEqual([a, b]);
  });

  it('rejects nonimage files and preserves valid previous selections', () => {
    const first = photo('proof.jpg');
    const selected = addRecheckPhotos([first], [photo('script.txt', 'text/plain')]);
    expect(selected.accepted).toEqual([first]);
    expect(selected.error).toMatch(/JPG/);
  });

  it('stops at the maximum and keeps existing photo selections', () => {
    const selected = addRecheckPhotos([], Array.from({ length: MAX_RECHECK_PHOTOS + 1 }, (_, i) => photo(`proof-${i}.jpg`)));
    expect(selected.accepted).toHaveLength(MAX_RECHECK_PHOTOS);
    expect(selected.error).toMatch(/10 photos/);
  });

  it('rejects files over eight megabytes', () => {
    const selected = addRecheckPhotos([], [photo('large.jpg', 'image/jpeg', 8 * 1024 * 1024 + 1)]);
    expect(selected.accepted).toHaveLength(0);
    expect(selected.error).toMatch(/8 MB/);
  });

  it('scopes evidence to the uploader and the new assignment', () => {
    const path = recheckEvidencePath('manager-1', 'new-assignment-2', photo('floor.jpg'), 0);
    expect(path).toMatch(/^manager-1\/new-assignment-2\/\d+-0-.+\.jpg$/);
  });
});
