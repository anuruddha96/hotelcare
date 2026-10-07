import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  'supabase/migrations/20261007100000_restore_housekeeping_missed_service_carry_forward.sql',
  'utf8',
);
const gate = readFileSync('src/components/dashboard/HotelMemoriesRoomGate.tsx', 'utf8');
const manager = readFileSync('src/components/dashboard/HotelMemoriesManagerRoomOverview.tsx', 'utf8');

describe('Hotel Memories missed-service carry-forward contract', () => {
  it('is property-scoped and starts after the current live workday', () => {
    expect(migration).toContain("'hotel memories budapest'");
    expect(migration).toContain("'memories-budapest'");
    expect(migration).toContain("DATE '2026-09-26'");
    expect(migration).not.toContain('UPDATE public.rooms');
  });

  it('requires unresolved DND or No Service and suppresses cleaned outcomes', () => {
    expect(migration).toContain("v_service_result = 'cleaned'");
    expect(migration).toContain('v_had_dnd OR v_had_no_service');
    expect(migration).toContain("v_service_result = 'guest_declined'");
  });

  it('suppresses checkout and new-arrival states', () => {
    expect(migration).toContain('v_effective_checkout');
    expect(migration).toContain("scheduledDepartureToday");
    expect(migration).toContain("arrivalToday");
    expect(migration).toContain('v_same_reservation');
  });

  it('renders a short action for housekeepers and dated lineage for managers', () => {
    expect(gate).toContain('getMemoriesCarryForwardService');
    expect(gate).toContain('getCarryForwardHousekeeperCopy');
    expect(gate).toContain("carryForward?.serviceType === 'towel_change'");
    expect(gate).toContain("carryForward?.serviceType === 'full_clean'");
    expect(manager).toContain('Carried housekeeping task');
    expect(manager).toContain('getCarryForwardManagerCopy');
  });

  it('restores repeated carry lineage and current-day reconciliation', () => {
    expect(migration).toContain("'original_due_date'");
    expect(migration).toContain("'attempt_count'");
    expect(migration).toContain("'memories_service_cycle'");
    expect(migration).toContain('hc_refresh_memories_missed_service_carry(v_today)');
    expect(migration).toContain('hc_refresh_portfolio_missed_service_carry(v_today)');
  });
});
