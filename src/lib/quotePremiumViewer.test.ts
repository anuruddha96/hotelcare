import { describe, expect, it } from 'vitest';
import { isPremiumQuoteViewer } from './quotePremiumViewer';

describe('premium quote presentation', () => {
  it('is only enabled for the exact configured nickname, case-insensitive', () => {
    expect(isPremiumQuoteViewer('Anu_000')).toBe(true);
    expect(isPremiumQuoteViewer('anu_000')).toBe(true);
    expect(isPremiumQuoteViewer(' anu_000 ')).toBe(true);
    expect(isPremiumQuoteViewer('anu_001')).toBe(false);
    expect(isPremiumQuoteViewer('another_anu_000')).toBe(false);
    expect(isPremiumQuoteViewer(null)).toBe(false);
    expect(isPremiumQuoteViewer(undefined)).toBe(false);
  });
});
