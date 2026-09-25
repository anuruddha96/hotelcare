import { describe, expect, it } from 'vitest';
import {
  effectiveCarryServiceFlags,
  getHousekeepingCarryForward,
  isPortfolioCarryForwardHotel,
} from './housekeepingCarryForward';

describe('portfolio housekeeping carry-forward', () => {
  it('gates Mika, Ottofiori and Gozsdu without treating Memories as the shared portfolio path', () => {
    expect(isPortfolioCarryForwardHotel('mika-downtown')).toBe(true);
    expect(isPortfolioCarryForwardHotel('Hotel Mika Downtown')).toBe(true);
    expect(isPortfolioCarryForwardHotel('Hotel Ottofiori')).toBe(true);
    expect(isPortfolioCarryForwardHotel('gozsdu-court')).toBe(true);
    expect(isPortfolioCarryForwardHotel('Gozsdu Court Budapest')).toBe(true);
    expect(isPortfolioCarryForwardHotel('Hotel Memories Budapest')).toBe(false);
  });

  it('parses repeated carried service context with lineage', () => {
    expect(getHousekeepingCarryForward({
      carry_forward: {
        active: true,
        property_id: 'gozsdu-court',
        source_business_date: '2026-09-26',
        original_due_date: '2026-09-25',
        service_type: 'full_clean',
        reason: 'no_service',
        attempt_count: 2,
        policy_source: 'gozsdu_property_cycle',
        instruction: 'Complete Textile Change remains outstanding.',
      },
    })).toEqual({
      active: true,
      propertyId: 'gozsdu-court',
      sourceBusinessDate: '2026-09-26',
      originalDueDate: '2026-09-25',
      serviceType: 'full_clean',
      reason: 'no_service',
      attemptCount: 2,
      policySource: 'gozsdu_property_cycle',
      instruction: 'Complete Textile Change remains outstanding.',
    });
  });

  it('lets full cleaning subsume towel service', () => {
    const carry = getHousekeepingCarryForward({
      carry_forward: {
        active: true,
        property_id: 'mika-downtown',
        source_business_date: '2026-09-25',
        original_due_date: '2026-09-25',
        service_type: 'towel_change',
        reason: 'dnd',
        attempt_count: 1,
      },
    });
    expect(effectiveCarryServiceFlags({
      towelChangeRequired: true,
      linenChangeRequired: true,
      carryForward: carry,
      isCheckout: false,
    })).toEqual({ towelChangeRequired: false, linenChangeRequired: true });
  });

  it('never paints stayover carry requirements on checkout', () => {
    const carry = getHousekeepingCarryForward({
      carry_forward: {
        active: true,
        property_id: 'ottofiori',
        source_business_date: '2026-09-25',
        original_due_date: '2026-09-25',
        service_type: 'full_clean',
        reason: 'dnd',
        attempt_count: 1,
      },
    });
    expect(effectiveCarryServiceFlags({
      towelChangeRequired: true,
      linenChangeRequired: true,
      carryForward: carry,
      isCheckout: true,
    })).toEqual({ towelChangeRequired: false, linenChangeRequired: false });
  });
});
