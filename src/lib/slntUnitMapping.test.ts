import { describe, expect, it } from 'vitest';
import { deriveSuggestion, extractRoomNames, isTechnicalRow, normalizeUnitName, isSlntInactiveOperationalUnit, isSlntWorkbookActiveUnit, slntPmsIdentityKey } from './slntUnitMapping';

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


describe('SLNT authoritative two-PMS inventory', () => {
  it('excludes the stale workbook-missing Sobi unit from operations', () => {
    expect(isSlntWorkbookActiveUnit('Sobi Apartment Budapest', 'clean')).toBe(false);
    expect(isSlntWorkbookActiveUnit('Silver Rooms 3', 'dirty')).toBe(true);
    expect(isSlntWorkbookActiveUnit('WR Pension 102', 'clean')).toBe(false);
    expect(isSlntWorkbookActiveUnit('Downtown Terrace Passion', 'clean')).toBe(false);
    expect(isSlntWorkbookActiveUnit('Technikai 1', 'clean')).toBe(false);
    expect(isSlntWorkbookActiveUnit('K4 – Room 7', 'clean')).toBe(true);
  });

  it('ignores confirmed inactive PMS listings even when Previo appends marketing text', () => {
    expect(isSlntInactiveOperationalUnit('Sobi Apartment Budapest - central apartment')).toBe(true);
    expect(isSlntInactiveOperationalUnit('Downtown Terrace Passion with balcony')).toBe(true);
    expect(isSlntInactiveOperationalUnit('WR Pension 104 - Budapest')).toBe(true);
    expect(isSlntInactiveOperationalUnit('Technikai 2')).toBe(true);
    expect(isSlntInactiveOperationalUnit('Silver Rooms 14 - Budapest')).toBe(false);
  });

  it('keeps identical external room ids isolated by Previo account', () => {
    expect(slntPmsIdentityKey('782407-account', '102')).not.toBe(slntPmsIdentityKey('783103-account', '102'));
    expect(slntPmsIdentityKey('782407-account', '102')).toBe('782407-account:102');
  });
});
