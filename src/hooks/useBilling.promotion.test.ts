import { describe, expect, it } from 'vitest';
import {
  effectivePriceFor,
  promotionForModule,
  type BillingSettings,
} from './useBilling';

const settings = {
  organization_slug: 'rdhotels',
  maintenance_pricing_mode: 'custom',
  maintenance_price_cents: 0,
  standard_operations_price_cents: 600,
  operations_price_cents: 300,
  standard_revenue_bi_price_cents: 2000,
  revenue_bi_price_cents: 1500,
  standard_revenue_automation_price_cents: 3500,
  revenue_automation_price_cents: 2500,
  revenue_price_cents: 2500,
  operations_promotion_enabled: true,
  operations_promotion_label: 'First 6 months 50% OFF',
  operations_promotion_note: 'Housekeeping only',
  operations_promotion_starts_on: '2026-08-10',
  operations_promotion_ends_on: '2027-02-10',
  revenue_promotion_enabled: false,
  revenue_promotion_label: 'Revenue launch offer',
  revenue_promotion_note: '',
  revenue_promotion_starts_on: null,
  revenue_promotion_ends_on: null,
} as BillingSettings;

describe('module-specific billing promotions', () => {
  it('keeps the Housekeeping end date inclusive and returns to regular pricing afterwards', () => {
    expect(promotionForModule(settings, 'operations', '2027-02-10')?.status).toBe('active');
    expect(effectivePriceFor(settings, 'operations', '2027-02-10')).toBe(300);
    expect(promotionForModule(settings, 'operations', '2027-02-11')?.status).toBe('ended');
    expect(effectivePriceFor(settings, 'operations', '2027-02-11')).toBe(600);
  });

  it('does not leak a Housekeeping promotion into Revenue Management', () => {
    expect(promotionForModule(settings, 'revenue_automation', '2026-09-10')?.status).toBe('disabled');
    expect(effectivePriceFor(settings, 'revenue_bi', '2026-09-10')).toBe(2000);
    expect(effectivePriceFor(settings, 'revenue_automation', '2026-09-10')).toBe(3500);
  });

  it('supports an independent Revenue window and tier prices', () => {
    const revenueOffer = {
      ...settings,
      revenue_promotion_enabled: true,
      revenue_promotion_starts_on: '2026-10-01',
      revenue_promotion_ends_on: '2026-10-31',
    };

    expect(promotionForModule(revenueOffer, 'revenue_bi', '2026-09-30')?.status).toBe('scheduled');
    expect(effectivePriceFor(revenueOffer, 'revenue_bi', '2026-10-01')).toBe(1500);
    expect(effectivePriceFor(revenueOffer, 'revenue_automation', '2026-10-31')).toBe(2500);
    expect(effectivePriceFor(revenueOffer, 'operations', '2026-10-15')).toBe(300);
  });

  it('changes promotional days at Budapest midnight', () => {
    const revenueOffer = {
      ...settings,
      revenue_promotion_enabled: true,
      revenue_promotion_starts_on: '2026-10-01',
      revenue_promotion_ends_on: '2026-10-31',
    };

    // 22:30 UTC is already 00:30 on 1 October in Budapest.
    expect(promotionForModule(revenueOffer, 'revenue_bi', new Date('2026-09-30T22:30:00Z'))?.status).toBe('active');
  });

  it('refuses invalid promotional prices and date ranges', () => {
    const invalid = {
      ...settings,
      operations_price_cents: 700,
      operations_promotion_starts_on: '2027-02-11',
      operations_promotion_ends_on: '2027-02-10',
    };

    expect(promotionForModule(invalid, 'operations', '2027-02-10')?.status).toBe('invalid');
    expect(effectivePriceFor(invalid, 'operations', '2027-02-10')).toBe(600);
  });
});
