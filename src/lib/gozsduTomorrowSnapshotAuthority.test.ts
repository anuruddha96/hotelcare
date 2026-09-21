import { describe, expect, it } from 'vitest';
import { verifyGozsduTomorrowSnapshot, type GozsduTomorrowSnapshotRow } from './gozsduTomorrowSnapshotAuthority';

const DATE = '2026-09-22';
const NOW = Date.parse('2026-09-21T14:40:00Z');
const CAPTURED = '2026-09-21T14:34:38Z';

function row(name: string, overrides: Partial<GozsduTomorrowSnapshotRow> = {}): GozsduTomorrowSnapshotRow {
  return {
    business_date: DATE,
    room_label: name,
    room_number: name,
    captured_at: CAPTURED,
    ...overrides,
  };
}

describe('Gozsdu exact-date Previo snapshot authority', () => {
  it('accepts a fresh 76-room Previo roster without requiring the 82-room registry', () => {
    const rows = Array.from({ length: 76 }, (_, index) => row(`1B-${index + 100}`));
    expect(verifyGozsduTomorrowSnapshot(rows, DATE, NOW)).toEqual({
      capturedAt: '2026-09-21T14:34:38.000Z',
      rowCount: 76,
    });
  });

  it('rejects empty and mixed-date data', () => {
    expect(verifyGozsduTomorrowSnapshot([], DATE, NOW)).toBeNull();
    expect(verifyGozsduTomorrowSnapshot([row('A'), row('B', { business_date: '2026-09-21' })], DATE, NOW)).toBeNull();
  });

  it('rejects duplicate or unidentified rooms', () => {
    expect(verifyGozsduTomorrowSnapshot([row('1B-100'), row('1b-100')], DATE, NOW)).toBeNull();
    expect(verifyGozsduTomorrowSnapshot([row('', { room_number: '' })], DATE, NOW)).toBeNull();
  });

  it('rejects missing, stale, future and mixed-batch capture timestamps', () => {
    expect(verifyGozsduTomorrowSnapshot([row('A', { captured_at: null })], DATE, NOW)).toBeNull();
    expect(verifyGozsduTomorrowSnapshot([row('A', { captured_at: '2026-09-21T14:20:00Z' })], DATE, NOW)).toBeNull();
    expect(verifyGozsduTomorrowSnapshot([row('A', { captured_at: '2026-09-21T14:42:00Z' })], DATE, NOW)).toBeNull();
    expect(verifyGozsduTomorrowSnapshot([row('A'), row('B', { captured_at: '2026-09-21T14:36:38Z' })], DATE, NOW)).toBeNull();
  });
});
