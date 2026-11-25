import { describe, expect, it } from 'vitest';
import { isReusableTomorrowReservationBatch, isVerifiedSparseTomorrowSnapshot } from './nextDayPmsGateCoverage';

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

  it('accepts verified sparse reservation snapshots for other Previo properties', () => {
    expect(isVerifiedSparseTomorrowSnapshot({ ...verified, hotelId: 'ottofiori' })).toBe(true);
    expect(isVerifiedSparseTomorrowSnapshot({ ...verified, hotelId: 'memories-budapest' })).toBe(true);
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

describe('next-day planner reservation snapshot reuse', () => {
  const now = Date.parse('2026-10-22T14:10:00Z');
  const rows = (count: number) => Array.from({ length: count }, (_, i) => ({
    room_label: `Room-${i + 1}`,
    room_number: String(i + 1),
    captured_at: '2026-10-22T14:05:00Z',
  }));
  const valid = (roomCount: number, snapshotRows: ReturnType<typeof rows>) =>
    isReusableTomorrowReservationBatch({
      roomCount, rows: snapshotRows, freshnessMs: 15 * 60_000, now,
    });

  it('reuses Mika and Gozsdu booking-only snapshots even with vacant rooms', () => {
    expect(valid(33, rows(27))).toBe(true);
    expect(valid(82, rows(78))).toBe(true);
    expect(valid(33, rows(33))).toBe(true);
  });

  it('rejects empty, oversized, duplicate, invalid and stale batches', () => {
    expect(valid(33, [])).toBe(false);
    expect(valid(33, rows(34))).toBe(false);
    expect(valid(33, [...rows(2), rows(1)[0]])).toBe(false);
    expect(valid(33, [{ ...rows(1)[0], captured_at: null }])).toBe(false);
    expect(valid(33, [{ ...rows(1)[0], room_label: '', room_number: '' }])).toBe(false);
    expect(valid(33, [{ ...rows(1)[0], captured_at: '2026-10-22T13:00:00Z' }])).toBe(false);
    expect(valid(33, [rows(1)[0], { ...rows(2)[1], captured_at: '2026-10-22T14:03:00Z' }])).toBe(false);
  });
});
