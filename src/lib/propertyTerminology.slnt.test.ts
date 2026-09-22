import { describe, expect, it } from 'vitest';
import { propertyTermsFor } from './propertyTerminology';

describe('SLNT-only cleaning section terminology', () => {
  it.each(['slnt', 'slnt-group'])('labels the daily section as requested only for %s', slug => {
    const terms = propertyTermsFor(slug, 'en');
    expect(terms.dailySection).toBe('Daily Cleaning');
    expect(terms.checkoutSection).toBe('Checkout Units');
    expect(terms.isProperty).toBe(true);
  });

  it('retains the Hungarian SLNT daily label and checkout section', () => {
    expect(propertyTermsFor('slnt', 'hu').dailySection).toBe('Napi takarítás');
    expect(propertyTermsFor('slnt', 'hu').checkoutSection).toBe('Kijelentkező egységek');
  });

  it.each(['rdhotels', 'other', ''])('preserves HotelCare hotel sections for %s', slug => {
    const terms = propertyTermsFor(slug, 'en');
    expect(terms.dailySection).toBe('Daily Rooms');
    expect(terms.checkoutSection).toBe('Checkout Rooms');
    expect(terms.isProperty).toBe(false);
  });

  it('retains non-SLNT hotel translations', () => {
    expect(propertyTermsFor('rdhotels', 'es').plural).toBe('Hoteles');
    expect(propertyTermsFor('rdhotels', 'mn').singular).toBe('Зочид буудал');
  });
});
