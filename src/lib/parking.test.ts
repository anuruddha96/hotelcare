import { describe, expect, it } from 'vitest';
import {
  addDaysISO,
  normalizeParkingReference,
  parkingDisplayStatus,
  parseNotificationEmails,
  previewParkingRange,
  roleParkingAccess,
  todayISO,
} from '@/lib/parking';

describe('parking range validation', () => {
  it('expands a full prefixed range without losing zero padding', () => {
    expect(previewParkingRange('43930-00098', '43930-00102')).toEqual({
      ok: true,
      prefix: '43930-',
      firstNumber: 98n,
      lastNumber: 102n,
      width: 5,
      count: 5,
      canonicalStart: '43930-00098',
      canonicalEnd: '43930-00102',
    });
  });

  it('accepts a shorthand final number', () => {
    const preview = previewParkingRange('43930-21096', '21200');
    expect(preview.ok).toBe(true);
    if (preview.ok) {
      expect(preview.canonicalEnd).toBe('43930-21200');
      expect(preview.count).toBe(105);
    }
  });

  it('rejects mismatched prefixes, reversed ranges and oversized batches', () => {
    expect(previewParkingRange('A-1', 'B-2')).toMatchObject({ ok: false });
    expect(previewParkingRange('A-10', 'A-2')).toMatchObject({ ok: false });
    expect(previewParkingRange('A-1', 'A-2001')).toMatchObject({ ok: false });
  });
});

describe('parking helpers', () => {
  it('normalizes ticket and reservation searches', () => {
    expect(normalizeParkingReference(' 43 930–21-096 ')).toBe('4393021096');
    expect(normalizeParkingReference('BK / Ab-123')).toBe('bkab123');
  });

  it('derives access from HotelCare roles', () => {
    expect(roleParkingAccess('manager')).toBe('manage');
    expect(roleParkingAccess('reception')).toBe('issue');
    expect(roleParkingAccess('housekeeping')).toBe('none');
    expect(roleParkingAccess('housekeeping', true)).toBe('manage');
  });

  it('labels expired issued tickets without changing stored status', () => {
    expect(parkingDisplayStatus({ status: 'issued', valid_to: '2026-09-09' }, '2026-09-10')).toBe('expired');
    expect(parkingDisplayStatus({ status: 'issued', valid_to: '2026-09-10' }, '2026-09-10')).toBe('issued');
    expect(parkingDisplayStatus({ status: 'void', valid_to: '2026-09-09' }, '2026-09-10')).toBe('void');
  });

  it('calculates dates and cleans notification recipients', () => {
    expect(addDaysISO('2026-12-31', 1)).toBe('2027-01-01');
    expect(todayISO(new Date('2026-09-10T22:30:00Z'))).toBe('2026-09-11');
    expect(parseNotificationEmails('A@example.com; b@example.com\na@example.com')).toEqual([
      'a@example.com',
      'b@example.com',
    ]);
  });
});
