import { describe, expect, it } from 'vitest';
import { localizedMaintenanceTitle, maintenanceTitleCatalog, normalizeMaintenanceQuery, suggestMaintenanceTitles } from './maintenanceTitleSuggestions';

describe('maintenance title autocomplete', () => {
  it('has a broad catalog with unique stable ids', () => {
    expect(maintenanceTitleCatalog.length).toBeGreaterThan(70);
    expect(new Set(maintenanceTitleCatalog.map(item => item.id)).size).toBe(maintenanceTitleCatalog.length);
  });
  it('suggests relevant curtain problems in English', () => {
    const suggestions = suggestMaintenanceTitles('Curtain', 'en');
    expect(suggestions.some(item => item.en === 'Curtain rail loose')).toBe(true);
    expect(suggestions.length).toBeLessThanOrEqual(6);
  });
  it('finds Hungarian titles with or without accents', () => {
    expect(suggestMaintenanceTitles('függöny', 'hu').some(item => item.hu === 'Függönykarnis meglazult')).toBe(true);
    expect(suggestMaintenanceTitles('fuggony', 'hu').some(item => item.hu === 'Függönykarnis meglazult')).toBe(true);
  });
  it('supports cross-language queries and UI language selection', () => {
    const item = suggestMaintenanceTitles('curtain', 'hu').find(result => result.en === 'Curtain rail loose');
    expect(item).toBeDefined();
    expect(localizedMaintenanceTitle(item!, 'hu')).toBe('Függönykarnis meglazult');
    expect(localizedMaintenanceTitle(item!, 'de')).toBe('Curtain rail loose');
  });
  it('does not suggest for empty or single-character queries', () => {
    expect(suggestMaintenanceTitles('', 'en')).toEqual([]);
    expect(suggestMaintenanceTitles('c', 'en')).toEqual([]);
    expect(suggestMaintenanceTitles('    ', 'hu')).toEqual([]);
  });
  it('normalizes Unicode punctuation and accents', () => {
    expect(normalizeMaintenanceQuery('  KLÍMA—VÍZ  ')).toBe('klima viz');
  });
  it('returns no result for unrelated custom text and never modifies it', () => {
    const custom = 'Guest reports an unusual squeaking noise';
    expect(suggestMaintenanceTitles(custom, 'en')).toEqual([]);
    expect(custom).toBe('Guest reports an unusual squeaking noise');
  });
});
