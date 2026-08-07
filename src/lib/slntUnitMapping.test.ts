import { describe, expect, it } from 'vitest';
import { deriveSuggestion, extractRoomNames, isTechnicalRow, normalizeUnitName } from './slntUnitMapping';

describe('slnt unit mapping', () => {
  it('normalizes accents and punctuation', () => {
    expect(normalizeUnitName('Duplex Penthouse Terrace Budapest Klauzál utca 11')).toBe(
      'duplex penthouse terrace budapest klauzal utca 11',
    );
  });

  it('detects technical rows regardless of case/whitespace', () => {
    expect(isTechnicalRow('  Technikai ')).toBe(true);
    expect(isTechnicalRow('technikai')).toBe(true);
    expect(isTechnicalRow('K4 Room 1')).toBe(false);
  });

  it('clusters known venue groups', () => {
    expect(deriveSuggestion('Silver Rooms 12').venue).toBe('Silver Rooms');
    expect(deriveSuggestion('St King 11 Room 4')).toMatchObject({
      unit: 'St King 11 – Room 4',
      venue: 'St King 11',
    });
    expect(deriveSuggestion('Grandio 2 - Stylish Jewish Quarter Studio | Balcony & Parking').venue).toBe('Grandio');
    expect(deriveSuggestion('Elisabeth Downtown Studio').venue).toBe('Elisabeth Downtown');
    expect(deriveSuggestion('Dandelion Apartment with free parking').unit).toBe('Dandelion Apartment');
  });

  it('extracts unique, non technical room names', () => {
    const names = extractRoomNames([
      { Room: 'K4 Room 1', Guests: 2 },
      { Room: 'Technikai' },
      { Room: '' },
      { Room: 'K4 Room 1' },
      { Room: 'Silver Rooms 3' },
    ]);
    expect(names).toEqual(['K4 Room 1', 'Silver Rooms 3']);
  });
});
