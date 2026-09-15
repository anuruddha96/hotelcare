import { describe, expect, it } from 'vitest';
import {
  quoteAudienceForRole,
  quotePoolForRole,
} from '@/lib/roleMotivationalQuotes';

describe('roleMotivationalQuotes', () => {
  it('keeps operational staff in role-relevant quote pools', () => {
    expect(quoteAudienceForRole('housekeeping')).toBe('housekeeping');
    expect(quoteAudienceForRole('reception')).toBe('reception');
    expect(quoteAudienceForRole('front_office')).toBe('reception');
    expect(quoteAudienceForRole('maintenance')).toBe('maintenance');
    expect(quoteAudienceForRole('breakfast_staff')).toBe('breakfast');
    expect(quoteAudienceForRole('marketing')).toBe('marketing');
    expect(quoteAudienceForRole('control_finance')).toBe('finance');
    expect(quoteAudienceForRole('hr')).toBe('hr');
  });

  it('routes manager and supervisor roles to their specific leadership audiences', () => {
    const expectedAudiences: Record<string, string> = {
      manager: 'hotel_management',
      admin: 'admin',
      top_management: 'executive',
      housekeeping_manager: 'housekeeping_leadership',
      maintenance_manager: 'maintenance_leadership',
      marketing_manager: 'marketing_leadership',
      reception_manager: 'reception_leadership',
      back_office_manager: 'hotel_management',
      control_manager: 'finance_leadership',
      finance_manager: 'finance_leadership',
      top_management_manager: 'executive',
      supervisor: 'supervisor',
    };

    for (const [role, audience] of Object.entries(expectedAudiences)) {
      expect(quoteAudienceForRole(role)).toBe(audience);
      const pool = quotePoolForRole(role);
      expect(pool.length).toBeGreaterThan(4);
      expect(pool.some((line) => line.id.startsWith('shared-'))).toBe(true);
      expect(pool.some((line) => !line.id.startsWith('shared-'))).toBe(true);
    }
  });

  it('never serves management/revenue-style lines from the housekeeping pool', () => {
    const housekeeping = quotePoolForRole('housekeeping');
    expect(housekeeping.length).toBeGreaterThan(0);
    const housekeepingSpecific = housekeeping.filter((line) => !line.id.startsWith('shared-'));
    expect(housekeepingSpecific.every((line) => line.id.startsWith('hk-'))).toBe(true);
    expect(housekeeping.some((line) => /revenue|adr|pricing|occupancy/i.test(line.quote))).toBe(false);
  });

  it('uses neutral hospitality quotes until a trusted role is known', () => {
    expect(quoteAudienceForRole(null)).toBe('hospitality');
    expect(quoteAudienceForRole(undefined)).toBe('hospitality');
    expect(quoteAudienceForRole('unexpected_future_role')).toBe('hospitality');
    const fallback = quotePoolForRole(null);
    const hospitalitySpecific = fallback.filter((line) => !line.id.startsWith('shared-'));
    expect(hospitalitySpecific.every((line) => line.id.startsWith('gen-'))).toBe(true);
    expect(fallback.some((line) => line.id.startsWith('shared-'))).toBe(true);
  });
});
