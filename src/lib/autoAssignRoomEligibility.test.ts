import { describe, expect, it } from 'vitest';
import { isRoomEligibleForAutoAssign } from './autoAssignRoomEligibility';

describe('isRoomEligibleForAutoAssign', () => {
  it('includes clean rooms because they can still be scheduled daily or checkout work', () => {
    expect(isRoomEligibleForAutoAssign({ status: 'clean' })).toBe(true);
  });

  it('includes dirty and in-progress rooms', () => {
    expect(isRoomEligibleForAutoAssign({ status: 'dirty' })).toBe(true);
    expect(isRoomEligibleForAutoAssign({ status: 'in_progress' })).toBe(true);
  });

  it('excludes rooms already completed today', () => {
    expect(isRoomEligibleForAutoAssign(
      { status: 'clean' },
      { hasCompletedAssignment: true },
    )).toBe(false);
  });

  it('excludes out-of-order rooms unless an active assignment must remain editable', () => {
    expect(isRoomEligibleForAutoAssign({ status: 'out_of_order' })).toBe(false);
    expect(isRoomEligibleForAutoAssign(
      { status: 'out_of_order' },
      { hasActiveAssignment: true },
    )).toBe(true);
  });
});

