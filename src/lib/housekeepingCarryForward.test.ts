import { describe, expect, it } from 'vitest';
import {
  effectiveCarryServiceFlags,
  getCarryForwardHousekeeperCopy,
  getCarryForwardManagerCopy,
  getHousekeepingCarryForward,
  getActionableHousekeepingCarryForward,
  isCarryForwardDisplayHotel,
  isPortfolioCarryForwardHotel,
  isRdCarryForwardHotel,
} from './housekeepingCarryForward';

describe('portfolio housekeeping carry-forward', () => {
  it('gates Mika, Ottofiori and Gozsdu without treating Memories as the shared portfolio path', () => {
    expect(isPortfolioCarryForwardHotel('mika-downtown')).toBe(true);
    expect(isPortfolioCarryForwardHotel('Hotel Mika Downtown')).toBe(true);
    expect(isPortfolioCarryForwardHotel('Hotel Ottofiori')).toBe(true);
    expect(isPortfolioCarryForwardHotel('gozsdu-court')).toBe(true);
    expect(isPortfolioCarryForwardHotel('Gozsdu Court Budapest')).toBe(true);
    expect(isPortfolioCarryForwardHotel('Hotel Memories Budapest')).toBe(false);
    expect(isCarryForwardDisplayHotel('Hotel Memories Budapest')).toBe(true);
    expect(isCarryForwardDisplayHotel('memories-budapest')).toBe(true);
    expect(isCarryForwardDisplayHotel('Hotel Ottofiori')).toBe(true);
    expect(isCarryForwardDisplayHotel('slnt-group')).toBe(true);
    expect(isPortfolioCarryForwardHotel('slnt-group')).toBe(true);
    expect(isRdCarryForwardHotel('Hotel Memories Budapest')).toBe(true);
    expect(isRdCarryForwardHotel('Hotel Mika Downtown')).toBe(true);
    expect(isRdCarryForwardHotel('Hotel Ottofiori')).toBe(true);
    expect(isRdCarryForwardHotel('gozsdu-court')).toBe(true);
    expect(isRdCarryForwardHotel('slnt-group')).toBe(false);
    expect(isRdCarryForwardHotel('SLNT Group')).toBe(false);
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

  it('turns carry lineage into short housekeeper and manager copy', () => {
    const carry = getHousekeepingCarryForward({
      carry_forward: {
        active: true,
        property_id: 'mika-downtown',
        source_business_date: '2026-10-06',
        original_due_date: '2026-10-05',
        service_type: 'towel_change',
        reason: 'dnd',
        attempt_count: 2,
      },
    });
    expect(carry).not.toBeNull();
    expect(getCarryForwardHousekeeperCopy(carry!)).toEqual({
      action: 'Towel change today',
      reason: 'Missed yesterday — DND',
      message: 'Towel change today. Missed yesterday — DND.',
      icon: '🧺',
    });
    expect(getCarryForwardManagerCopy(carry!)).toEqual({
      action: 'Towel change today',
      summary: 'Towel change carried from 2026-10-06 · DND',
      detail: 'Originally due 2026-10-05 · attempt 2',
      reasonLabel: 'DND',
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

  it('stops showing a completed cleaned task as unresolved', () => {
    const context = { carry_forward: { active: true, property_id: 'mika-downtown', service_type: 'towel_change', reason: 'dnd', source_business_date: '2026-10-12' } };
    expect(getActionableHousekeepingCarryForward(context, { service_result: 'cleaned' })).toBeNull();
    expect(getActionableHousekeepingCarryForward(context, { service_result: 'guest_declined' })?.serviceType).toBe('towel_change');
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

  it('turns an HMB missed Change Room into towel-only on the verified last occupied night', () => {
    const carry = getHousekeepingCarryForward({
      carry_forward: {
        active: true,
        property_id: 'memories-budapest',
        source_business_date: '2026-10-19',
        original_due_date: '2026-10-19',
        service_type: 'full_clean',
        reason: 'dnd',
        attempt_count: 1,
      },
    });
    expect(effectiveCarryServiceFlags({
      towelChangeRequired: false,
      linenChangeRequired: true,
      carryForward: carry,
      isCheckout: false,
      forceTowelOnly: true,
    })).toEqual({ towelChangeRequired: true, linenChangeRequired: false });

    // 5/8: missed change can still be completed; the HMB override is NOT set.
    expect(effectiveCarryServiceFlags({
      towelChangeRequired: false,
      linenChangeRequired: true,
      carryForward: carry,
      isCheckout: false,
      forceTowelOnly: false,
    })).toEqual({ towelChangeRequired: false, linenChangeRequired: true });
  });
});
