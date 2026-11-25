import { describe, expect, it } from 'vitest';
import { lifecycleErrorKey } from './reservations';
import { pmsTranslations } from './pms-translations';

describe('NTAK Phase-3 guestless check-in language', () => {
  it('maps NO_ELIGIBLE_GUESTS to clear English instructions', () => {
    const key = lifecycleErrorKey({ message: 'NO_ELIGIBLE_GUESTS' });
    expect(key).toBe('pms.err.noEligibleGuests');
    expect(pmsTranslations.en[key!]).toBe('Add a guest to this reservation before checking in.');
  });

  it('has a Hungarian translation of the actionable error', () => {
    const key = lifecycleErrorKey({ message: 'NO_ELIGIBLE_GUESTS' });
    expect(key).toBeTruthy();
    expect(pmsTranslations.hu[key!]).toMatch(/vendéget|vendég/);
    expect(pmsTranslations.hu[key!]).not.toBe(pmsTranslations.en[key!]);
  });
});
