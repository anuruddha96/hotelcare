import { describe, expect, it } from 'vitest';
import { checkGozsduTomorrowPlanDrift } from './gozsduTomorrowPlanDrift';
import type { RoomForAssignment } from './roomAssignmentAlgorithm';

function room(id: string, checkout = false, towel = !checkout, linen = false): RoomForAssignment {
  return {
    id,
    is_checkout_room: checkout,
    towel_change_required: towel,
    linen_change_required: linen,
    pms_metadata: { scheduledDepartureToday: checkout },
  } as RoomForAssignment;
}

const clean = { newlyDue: 0, noLongerDue: 0, changedCleaningType: 0, duplicateAssignments: 0 };

describe('Gozsdu tomorrow plan reconciliation before approval', () => {
  it('accepts an exact match of the Previo checkout and due-stayover workload', () => {
    expect(checkGozsduTomorrowPlanDrift([room('checkout', true), room('second-day')],
      [room('checkout', true), room('second-day')])).toEqual(clean);
  });

  it('rejects new Previo checkout rooms and stayovers missing from an old preview', () => {
    expect(checkGozsduTomorrowPlanDrift([room('a', true), room('b')], [room('a', true)])).toEqual({
      ...clean, newlyDue: 1,
    });
  });

  it('rejects a stayover converted to checkout and towel versus textile changes', () => {
    expect(checkGozsduTomorrowPlanDrift([room('a', true), room('b', false, false, true)],
      [room('a'), room('b')])).toEqual({ ...clean, changedCleaningType: 2 });
  });
  it('rejects a potential checkout that became a confirmed checkout', () => {
    const potential = room('a', true);
    potential.pms_metadata = {
      ...potential.pms_metadata,
      potentialCheckout: true,
      selectedDateSnapshotKind: 'potential_checkout',
    };
    const confirmed = room('a', true);
    confirmed.pms_metadata = {
      ...confirmed.pms_metadata,
      potentialCheckout: false,
      selectedDateSnapshotKind: 'checkout',
    };
    expect(checkGozsduTomorrowPlanDrift([confirmed], [potential]))
      .toEqual({ ...clean, changedCleaningType: 1 });
  });

  it('rejects a room no longer in the verified due-work roster', () => {
    expect(checkGozsduTomorrowPlanDrift([room('a', true)], [room('a', true), room('b')])).toEqual({
      ...clean, noLongerDue: 1,
    });
  });

  it('preserves intentional manager exclusions without accepting duplicate assignment', () => {
    expect(checkGozsduTomorrowPlanDrift([room('a', true), room('b')], [room('a', true)], ['b'])).toEqual(clean);
    expect(checkGozsduTomorrowPlanDrift([room('a', true)], [room('a', true), room('a', true)])).toEqual({
      ...clean, duplicateAssignments: 1,
    });
  });
});
