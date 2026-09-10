import { describe, expect, it } from 'vitest';
import { billingPathFor } from './billingNavigation';

describe('billingPathFor', () => {
  it('always builds a tenant-scoped billing route', () => {
    expect(billingPathFor('rdhotels')).toBe('/rdhotels/billing');
  });

  it('keeps activation preselection parameters', () => {
    const params = new URLSearchParams({ hotel: '786631', module: 'revenue_automation' });
    expect(billingPathFor('rdhotels', params)).toBe(
      '/rdhotels/billing?hotel=786631&module=revenue_automation',
    );
  });

  it('falls back safely when no organization is available', () => {
    expect(billingPathFor(null)).toBe('/');
  });
});
