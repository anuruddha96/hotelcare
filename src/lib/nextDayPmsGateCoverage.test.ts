import { describe, expect, it } from 'vitest';
import { isVerifiedSparseTomorrowSnapshot } from './nextDayPmsGateCoverage';

const verified = {
  hotelId: 'mika-downtown',
  roomCount: 33,
  verifiedRowCount: 31,
  exactDayRowCount: 31,
  authoritative: true,
};

describe('tomorrow PMS UI gate coverage', () => {
  it('accepts Mika 31/33 only after the underlying snapshot was verified', () => {
    expect(isVerifiedSparseTomorrowSnapshot(verified)).toBe(true);
  });

  it('preserves the existing Gozsdu verified sparse snapshot exception', () => {
    expect(isVerifiedSparseTomorrowSnapshot({ ...verified, hotelId: 'gozsdu-court' })).toBe(true);
  });

  it('does not allow another hotel to bypass the full inventory requirement', () => {
    expect(isVerifiedSparseTomorrowSnapshot({ ...verified, hotelId: 'ottofiori' })).toBe(false);
    expect(isVerifiedSparseTomorrowSnapshot({ ...verified, hotelId: 'memories-budapest' })).toBe(false);
  });

  it('rejects an unverified, changed or empty exact-day dataset', () => {
    expect(isVerifiedSparseTomorrowSnapshot({ ...verified, authoritative: false })).toBe(false);
    expect(isVerifiedSparseTomorrowSnapshot({ ...verified, exactDayRowCount: 30 })).toBe(false);
    expect(isVerifiedSparseTomorrowSnapshot({ ...verified, exactDayRowCount: 32 })).toBe(false);
    expect(isVerifiedSparseTomorrowSnapshot({ ...verified, exactDayRowCount: 0 })).toBe(false);
  });

  it('rejects empty inventory, empty verification and non-sparse snapshots', () => {
    expect(isVerifiedSparseTomorrowSnapshot({ ...verified, roomCount: 0 })).toBe(false);
    expect(isVerifiedSparseTomorrowSnapshot({ ...verified, verifiedRowCount: 0, exactDayRowCount: 0 })).toBe(false);
    expect(isVerifiedSparseTomorrowSnapshot({ ...verified, verifiedRowCount: 33, exactDayRowCount: 33 })).toBe(false);
    expect(isVerifiedSparseTomorrowSnapshot({ ...verified, verifiedRowCount: 34, exactDayRowCount: 34 })).toBe(false);
  });
});
