import { describe, expect, it } from 'vitest';
import { isSupportedMaintenanceLanguage, localizedMaintenanceText, maintenanceTranslationCacheKey } from './maintenanceTicketLocalization';

describe('maintenance ticket localization', () => {
  const response = {
    ticketId: 'ticket-one', reporter: 'Reporter', history: [],
    translations: { description: 'A fürdőszobai tükör eltört.', title: 'Tükör', 'comment:abc': 'Javítsa meg.' },
  };

  it('uses the selected-language translation but never mutates the original', () => {
    const source = 'The bathroom mirror is broken.';
    expect(localizedMaintenanceText(source, 'description', response, false)).toBe('A fürdőszobai tükör eltört.');
    expect(localizedMaintenanceText(source, 'description', response, true)).toBe(source);
  });

  it('falls back to the original on missing, blank, failed or unrequested translation', () => {
    expect(localizedMaintenanceText('Needs repair', 'description', null, false)).toBe('Needs repair');
    expect(localizedMaintenanceText('Needs repair', 'hold', response, false)).toBe('Needs repair');
    expect(localizedMaintenanceText('Needs repair', 'description', { ...response, translations: { description: ' ' } }, false)).toBe('Needs repair');
  });

  it('uses unique revisions and languages to avoid cross-ticket and stale cache collisions', () => {
    expect(maintenanceTranslationCacheKey('ticket-one', 'v1', 'hu')).not.toBe(maintenanceTranslationCacheKey('ticket-one', 'v1', 'en'));
    expect(maintenanceTranslationCacheKey('ticket-one', 'v1', 'hu')).not.toBe(maintenanceTranslationCacheKey('ticket-one', 'v2', 'hu'));
    expect(maintenanceTranslationCacheKey('ticket-one', 'v1', 'hu')).not.toBe(maintenanceTranslationCacheKey('ticket-two', 'v1', 'hu'));
  });

  it('only accepts languages supported by the maintenance switcher', () => {
    expect(isSupportedMaintenanceLanguage('hu')).toBe(true);
    expect(isSupportedMaintenanceLanguage('si')).toBe(true);
    expect(isSupportedMaintenanceLanguage('xx')).toBe(false);
    expect(isSupportedMaintenanceLanguage('__proto__')).toBe(false);
  });
});
