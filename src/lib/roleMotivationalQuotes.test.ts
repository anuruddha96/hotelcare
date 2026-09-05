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

  it('gives every manager/supervisor role leadership and teamwork quotes', () => {
    const managerRoles = [
      'manager',
      'admin',
      'top_management',
      'housekeeping_manager',
      'maintenance_manager',
      'marketing_manager',
      'reception_manager',
      'back_office_manager',
      'control_manager',
      'finance_manager',
      'top_management_manager',
      'supervisor',
    ];

    for (const role of managerRoles) {
      expect(quoteAudienceForRole(role)).toBe('leadership');
      expect(quotePoolForRole(role).every((line) => line.id.startsWith('lead-'))).toBe(true);
    }
  });

  it('never serves management/revenue-style lines from the housekeeping pool', () => {
    const housekeeping = quotePoolForRole('housekeeping');
    expect(housekeeping.length).toBeGreaterThan(0);
    expect(housekeeping.every((line) => line.id.startsWith('hk-'))).toBe(true);
    expect(housekeeping.some((line) => /revenue|adr|pricing|occupancy/i.test(line.quote))).toBe(false);
  });

  it('uses neutral hospitality quotes until a trusted role is known', () => {
    expect(quoteAudienceForRole(null)).toBe('hospitality');
    expect(quoteAudienceForRole(undefined)).toBe('hospitality');
    expect(quoteAudienceForRole('unexpected_future_role')).toBe('hospitality');
    expect(quotePoolForRole(null).every((line) => line.id.startsWith('gen-'))).toBe(true);
  });
});
