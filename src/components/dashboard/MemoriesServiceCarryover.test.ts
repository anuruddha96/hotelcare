import { describe, expect, it } from 'vitest';
import { pendingServices, previousBusinessDate } from './MemoriesServiceCarryover';

const event = {
  id: 'event', source_business_date: '2026-09-17', incident_type: 'dnd' as const,
  towel_due: true, linen_due: true,
  towel_confirmed_at: null, linen_confirmed_at: null,
  incident_resolved_same_day: false,
};

describe('Hotel Memories missed-service carryover', () => {
  it('calculates the previous business date without depending on browser timezone', () => {
    expect(previousBusinessDate('2026-09-18')).toBe('2026-09-17');
    expect(previousBusinessDate('2026-03-01')).toBe('2026-02-28');
    expect(previousBusinessDate('2024-03-01')).toBe('2024-02-29');
    expect(previousBusinessDate('2026-01-01')).toBe('2025-12-31');
  });

  it('carries all unconfirmed due textile services, independently', () => {
    expect(pendingServices(event)).toEqual(['towel change', 'full linen change']);
    expect(pendingServices({ ...event, towel_confirmed_at: '2026-09-18T08:00:00Z' }))
      .toEqual(['full linen change']);
    expect(pendingServices({ ...event, linen_confirmed_at: '2026-09-18T08:00:00Z' }))
      .toEqual(['towel change']);
    expect(pendingServices({ ...event, towel_confirmed_at: '2026-09-18T08:00:00Z', linen_confirmed_at: '2026-09-18T08:05:00Z' }))
      .toEqual([]);
  });

  it('does not manufacture service requirements from a bare DND/NS incident', () => {
    expect(pendingServices({ ...event, towel_due: false, linen_due: false })).toEqual([]);
  });
});
