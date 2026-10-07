import { describe, expect, it } from 'vitest';
import {
  getGuestDeclinedServiceComment,
  getMemoriesCarryForwardService,
  isGuestDeclinedService,
} from './hotel-memories-housekeeping';

describe('guest-declined housekeeping outcomes', () => {
  it('uses the first-class service_result', () => {
    expect(isGuestDeclinedService('guest_declined', null)).toBe(true);
    expect(isGuestDeclinedService('cleaned', null)).toBe(false);
  });

  it('keeps legacy NO_SERVICE records compatible', () => {
    expect(
      isGuestDeclinedService(
        null,
        '[NO_SERVICE] Guest confirmed no service required',
      ),
    ).toBe(true);
  });

  it('shows only the final no-service comment when a green-board marker also exists', () => {
    const notes = [
      '[GREEN_BOARD_CLEAN_REQUEST] Green Clean My Room card seen at the door — cleaning requested.',
      '[NO_SERVICE]',
      '[NO_BOARD_NO_CLEANING] Door checked — no green Clean My Room card / no cleaning request. Guest asked to skip today.',
    ].join('\n');

    expect(getGuestDeclinedServiceComment(notes)).toBe('Guest asked to skip today.');
  });

  it('extracts the housekeeper comment from a generic legacy no-service record', () => {
    expect(
      getGuestDeclinedServiceComment(
        '[NO_SERVICE] Guest confirmed no service required — Guest sleeping',
      ),
    ).toBe('Guest sleeping');
  });
});


describe('Hotel Memories missed-service carry-forward parsing', () => {
  it('parses a DND towel-change carry instruction', () => {
    expect(getMemoriesCarryForwardService({
      carry_forward: {
        active: true,
        source_business_date: '2026-09-25',
        service_type: 'towel_change',
        reason: 'dnd',
        instruction: 'Please retry towels.',
      },
    })).toEqual({
      active: true,
      propertyId: 'memories-budapest',
      sourceBusinessDate: '2026-09-25',
      originalDueDate: '2026-09-25',
      serviceType: 'towel_change',
      reason: 'dnd',
      attemptCount: 1,
      policySource: null,
      instruction: 'Please retry towels.',
    });
  });

  it('parses repeated carry lineage for manager history', () => {
    const carry = getMemoriesCarryForwardService({
      carry_forward: {
        active: true,
        property_id: 'memories-budapest',
        source_business_date: '2026-10-06',
        original_due_date: '2026-10-05',
        service_type: 'full_clean',
        reason: 'no_service',
        attempt_count: 2,
        policy_source: 'memories_service_cycle',
      },
    });
    expect(carry?.originalDueDate).toBe('2026-10-05');
    expect(carry?.attemptCount).toBe(2);
    expect(carry?.policySource).toBe('memories_service_cycle');
  });

  it('builds a readable fallback for a No Service full-clean carry', () => {
    const carry = getMemoriesCarryForwardService({
      carry_forward: {
        active: true,
        source_business_date: '2026-09-25',
        service_type: 'full_clean',
        reason: 'no_service',
      },
    });
    expect(carry?.instruction).toContain('guest declined housekeeping (No Service)');
    expect(carry?.instruction).toContain('full room cleaning (Change Room)');
  });

  it('ignores inactive or malformed carry data', () => {
    expect(getMemoriesCarryForwardService({ carry_forward: { active: false } })).toBeNull();
    expect(getMemoriesCarryForwardService({
      carry_forward: {
        active: true,
        source_business_date: '25-09-2026',
        service_type: 'towel_change',
        reason: 'dnd',
      },
    })).toBeNull();
  });
});
