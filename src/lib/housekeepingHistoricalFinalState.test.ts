import { describe, expect, it } from 'vitest';
import { resolveHistoricalHousekeepingState, resolveHistoricalMemoriesService } from './housekeepingHistoricalFinalState';

describe('historical housekeeping final-state resolver', () => {
  it('uses the assignment instruction instead of an earlier transient T marker', () => {
    const state = resolveHistoricalHousekeepingState({
      towel_change_required: true,
      final_state: {
        towel_change_required_at_close: true,
        towel_change_required_for_assignment: false,
      },
    });
    expect(state.towel).toBe(false);
  });

  it('does not infer historical T/C from cumulative had_* flags', () => {
    const state = resolveHistoricalHousekeepingState({
      towel_change_required: false,
      linen_change_required: false,
      // legacy callers may have these fields; they are deliberately ignored
      ...( { had_towel_change: true, had_linen_change: true } as any ),
    });
    expect(state.towel).toBe(false);
    expect(state.changeRoom).toBe(false);
  });

  it('preserves DND and No Service as encounter evidence', () => {
    const state = resolveHistoricalHousekeepingState({
      final_state: { had_dnd: true, had_no_service: true },
    });
    expect(state.hadDnd).toBe(true);
    expect(state.hadNoService).toBe(true);
  });

  it('returns frozen notes and manager instructions when available', () => {
    const state = resolveHistoricalHousekeepingState({
      room_notes: 'mutable live note',
      final_state: {
        room_notes_at_close: 'saved 23 Sep note',
        assignment_notes: '[NO_SERVICE] guest declined',
        manager_instruction_text: '2 towels and 2 pillows',
      },
    });
    expect(state.roomNotes).toBe('saved 23 Sep note');
    expect(state.assignmentNotes).toContain('[NO_SERVICE]');
    expect(state.managerInstruction).toBe('2 towels and 2 pillows');
    expect(state.finalized).toBe(true);
  });

  it('remembers a scheduled towel change when an approved clean later clears live T', () => {
    const state = resolveHistoricalHousekeepingState({
      towel_change_required: false,
      final_state: {
        towel_change_required_for_assignment: false,
        towel_change_required_at_close: false,
        service_result: 'cleaned',
      },
      scheduled_service_due: { towel: true, change_room: false, first_observed_at: '2026-10-21T06:00:00Z' },
    });
    expect(state.towel).toBe(false); // immutable end-of-day instruction
    expect(state.scheduledTowel).toBe(true); // independent original duty evidence
    expect(state.scheduledChangeRoom).toBe(false);
  });

  it('does not fabricate scheduled duties for snapshots lacking evidence', () => {
    const state = resolveHistoricalHousekeepingState({
      final_state: { towel_change_required_for_assignment: false },
    });
    expect(state.scheduledTowel).toBe(false);
    expect(state.scheduledChangeRoom).toBe(false);
  });
});


describe('Hotel Memories historical missed-service evidence', () => {
  const businessDate = '2026-10-26';
  const historicalT = {
    towel_change_required: true,
    linen_change_required: false,
    scheduled_service_due: { towel: true, change_room: false },
    final_state: {
      towel_change_required_for_assignment: true,
      linen_change_required_for_assignment: false,
    },
  };
  const fullCarry = {
    previous_day_context: { carry_forward: {
      active: true, property_id: 'memories-budapest',
      reason: 'dnd', service_type: 'full_clean',
      source_business_date: '2026-10-25', original_due_date: '2026-10-24',
      attempt_count: 2,
    } },
    service_result: null,
  };
  const options = { hotel: 'Hotel Memories Budapest', businessDate, isCheckout: false };

  it('rejects room 002 stale night-three towel duty on 27 Oct when final T is false', () => {
    const result = resolveHistoricalMemoriesService({
      towel_change_required: false,
      final_state: { towel_change_required_for_assignment: false,
        pms_metadata_at_close: { arrivalDate: '2026-10-24', reservationId: '113308653' } },
      scheduled_service_due: { towel: true, business_date: '2026-10-27', stay_night: '3',
        reservation_id: '113308653', source: 'same_day_verified_room_duty' },
    }, null, { hotel: 'Hotel Memories Budapest', businessDate: '2026-10-27', isCheckout: false });
    expect(result).toMatchObject({ towel: false, scheduledTowel: false, changeRoom: false });
  });

  it('keeps a verified calendar-night service and rejects evidence from another date', () => {
    const row = {
      towel_change_required: false,
      final_state: { towel_change_required_for_assignment: false,
        pms_metadata_at_close: { arrivalDate: '2026-10-24', reservationId: '113308653' } },
      scheduled_service_due: { towel: true, business_date: '2026-10-26', stay_night: '3',
        reservation_id: '113308653', source: 'same_day_verified_room_duty' },
    };
    expect(resolveHistoricalMemoriesService(row, null, options).towel).toBe(true);
    expect(resolveHistoricalMemoriesService(row, null, { ...options, businessDate: '2026-10-27' }).towel).toBe(false);
  });

  it('shows C instead of natural T for room 147 on 26 Oct after repeated DND', () => {
    const result = resolveHistoricalMemoriesService(historicalT, fullCarry, options);
    expect(result.changeRoom).toBe(true);
    expect(result.towel).toBe(false);
    expect(result.scheduledTowel).toBe(true);
    expect(result.carryForward?.originalDueDate).toBe('2026-10-24');
    expect(historicalT.towel_change_required).toBe(true); // Original audit unchanged.
  });

  it('retains natural T without proven dated carry, or after recorded cleaning', () => {
    expect(resolveHistoricalMemoriesService(historicalT, null, options)).toMatchObject({
      towel: true, changeRoom: false, carryForward: null,
    });
    expect(resolveHistoricalMemoriesService(historicalT, { ...fullCarry, service_result: 'cleaned' }, options))
      .toMatchObject({ towel: true, changeRoom: false, carryForward: null });
  });

  it('does not carry to checkout, no-show, other hotel or unrelated day', () => {
    expect(resolveHistoricalMemoriesService(historicalT, fullCarry, { ...options, isCheckout: true }).carryForward).toBeNull();
    expect(resolveHistoricalMemoriesService(historicalT, fullCarry, { ...options, isNoShow: true }).carryForward).toBeNull();
    expect(resolveHistoricalMemoriesService(historicalT, fullCarry, { ...options, hotel: 'Hotel Mika Downtown' }).carryForward).toBeNull();
    expect(resolveHistoricalMemoriesService(historicalT, fullCarry, { ...options, businessDate: '2026-10-27' }).carryForward).toBeNull();
  });

  it('shows final-night towel-only carry while preserving the original full due date', () => {
    const finalCarry = { previous_day_context: { carry_forward: {
      ...fullCarry.previous_day_context.carry_forward,
      source_business_date: '2026-10-26',
      service_type: 'towel_change',
    } }, service_result: null };
    expect(resolveHistoricalMemoriesService(historicalT, finalCarry, { ...options, businessDate: '2026-10-27' }))
      .toMatchObject({ towel: true, changeRoom: false, carryForward: { originalDueDate: '2026-10-24' } });
  });
});
