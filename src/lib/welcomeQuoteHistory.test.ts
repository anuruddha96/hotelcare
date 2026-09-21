import { describe, expect, it } from 'vitest';
import { readLegacyQuoteHistory } from './welcomeQuoteHistory';

function store(items: Record<string, string>): Storage {
  const keys = Object.keys(items);
  return {
    length: keys.length,
    key(index: number) { return keys[index] ?? null; },
    getItem(key: string) { return items[key] ?? null; },
  } as Storage;
}

describe('legacy quote history migration', () => {
  it('combines v3/v4 across roles for the same user without repeating quote IDs', () => {
    const local = store({
      'hc.quoteRotation.v3.housekeeping.staff-1': JSON.stringify({ seen: ['clear-habits', 'franklin-prevention'] }),
      'hc.quoteRotation.v4.maintenance.staff-1': JSON.stringify({ seen: ['franklin-prevention', 'allen-notes'] }),
      'hc.quoteRotation.v3.housekeeping.staff-2': JSON.stringify({ seen: ['meyer-hospitality'] }),
      'hc.greetingRotation.v2.staff-1': 'Hello',
    });
    expect(readLegacyQuoteHistory('staff-1', local)).toEqual(['clear-habits', 'franklin-prevention', 'allen-notes']);
    expect(readLegacyQuoteHistory('staff-2', local)).toEqual(['meyer-hospitality']);
  });

  it('ignores damaged or malformed data and trims excessive input', () => {
    const seen = Array.from({ length: 600 }, (_, i) => `quote-${i}`);
    const local = store({
      'hc.quoteRotation.v3.housekeeping.staff-1': 'broken-json',
      'hc.quoteRotation.v4.supervisor.staff-1': JSON.stringify({ seen: [...seen, 17, null, 'x'.repeat(101)] }),
    });
    const result = readLegacyQuoteHistory('staff-1', local);
    expect(result).toHaveLength(500);
    expect(result[0]).toBe('quote-0');
    expect(result).not.toContain('x'.repeat(101));
  });

  it('does not guess a user or crash if storage is unavailable', () => {
    expect(readLegacyQuoteHistory('', store({}))).toEqual([]);
    const broken = { get length() { throw new Error('private mode'); } } as Storage;
    expect(readLegacyQuoteHistory('staff-1', broken)).toEqual([]);
  });
});
