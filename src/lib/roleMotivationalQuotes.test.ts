import { describe, expect, it } from 'vitest';
import {
  quoteAudienceForRole,
  quoteAudienceLabel,
  quotePoolForAudience,
  quotePoolForRole,
  type QuoteAudience,
} from './roleMotivationalQuotes';

const audiences: QuoteAudience[] = [
  'housekeeping', 'housekeeping_leadership', 'reception', 'reception_leadership',
  'maintenance', 'maintenance_leadership', 'breakfast', 'marketing',
  'marketing_leadership', 'finance', 'finance_leadership', 'hr',
  'hotel_management', 'executive', 'admin', 'supervisor', 'hospitality',
];

describe('verified, role-relevant welcome quotes', () => {
  it('has several sourced, named, actionable quotations for every audience', () => {
    audiences.forEach((audience) => {
      const pool = quotePoolForAudience(audience);
      expect(pool.length).toBeGreaterThanOrEqual(5);
      expect(new Set(pool.map(({ id }) => id)).size).toBe(pool.length);
      expect(quoteAudienceLabel(audience).trim().length).toBeGreaterThan(0);
      pool.forEach(({ quote, by, takeaway, sourceUrl }) => {
        expect(quote.trim().length).toBeGreaterThan(10);
        expect(by.trim().length).toBeGreaterThan(3);
        expect(takeaway.trim().length).toBeGreaterThan(10);
        expect(sourceUrl).toMatch(/^https:\/\//);
        expect(by).not.toMatch(/operations|clarity|quality|mindset|teamwork|craft|principle/i);
      });
    });
  });

  it('maps existing staff and managers to their own quote audiences', () => {
    const expectedAudiences: Record<string, QuoteAudience> = {
      housekeeping: 'housekeeping',
      housekeeping_manager: 'housekeeping_leadership',
      reception: 'reception',
      front_office: 'reception',
      reception_manager: 'reception_leadership',
      maintenance: 'maintenance',
      maintenance_manager: 'maintenance_leadership',
      breakfast_staff: 'breakfast',
      marketing: 'marketing',
      marketing_manager: 'marketing_leadership',
      control_finance: 'finance',
      control_manager: 'finance_leadership',
      finance_manager: 'finance_leadership',
      hr: 'hr',
      manager: 'hotel_management',
      back_office_manager: 'hotel_management',
      top_management: 'executive',
      top_management_manager: 'executive',
      admin: 'admin',
      supervisor: 'supervisor',
    };
    Object.entries(expectedAudiences).forEach(([role, audience]) => {
      expect(quoteAudienceForRole(role)).toBe(audience);
      expect(quotePoolForRole(role)).toEqual(quotePoolForAudience(audience));
    });
    expect(quotePoolForRole('maintenance').some(({ id }) => id === 'franklin-prevention')).toBe(true);
    expect(quotePoolForRole('reception').some(({ id }) => id === 'meyer-hospitality')).toBe(true);
    expect(quotePoolForRole('control_finance').some(({ id }) => id === 'drucker-time')).toBe(true);
  });

  it('does not push pricing or revenue statements to housekeepers', () => {
    expect(quotePoolForRole('housekeeping').some(({ quote }) => /revenue|adr|pricing|occupancy/i.test(quote))).toBe(false);
  });

  it('uses neutral hospitality selections while the role is unknown', () => {
    expect(quoteAudienceForRole(null)).toBe('hospitality');
    expect(quoteAudienceForRole(undefined)).toBe('hospitality');
    expect(quoteAudienceForRole('unexpected_future_role')).toBe('hospitality');
    expect(quotePoolForRole(null)).toEqual(quotePoolForAudience('hospitality'));
  });
});
