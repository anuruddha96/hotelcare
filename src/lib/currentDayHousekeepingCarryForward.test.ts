import { describe, expect, it } from 'vitest';
import {
  isActionableCurrentDayCarryForwardStatus,
  selectCarryForwardPrimaryItems,
} from './currentDayHousekeepingCarryForward';
import type { NextDayPlanItem } from './nextDayAutoAssignBridge';

const item = (
  roomId: string,
  source: NextDayPlanItem['source'] = 'auto',
  context: Record<string, any> = {},
): NextDayPlanItem => ({
  id: `item-${roomId}-${source}`,
  room_id: roomId,
  assigned_to: 'staff-1',
  assignment_type: 'checkout_cleaning',
  priority: 1,
  source,
  recommendation_context: context,
});

describe('current-day housekeeping carry forward', () => {
  it('only carries plans that are still awaiting/under morning release', () => {
    expect(isActionableCurrentDayCarryForwardStatus('approved')).toBe(true);
    expect(isActionableCurrentDayCarryForwardStatus('releasing')).toBe(true);
    expect(isActionableCurrentDayCarryForwardStatus('released')).toBe(false);
    expect(isActionableCurrentDayCarryForwardStatus('failed')).toBe(false);
    expect(isActionableCurrentDayCarryForwardStatus('cancelled')).toBe(false);
    expect(isActionableCurrentDayCarryForwardStatus('draft')).toBe(false);
  });

  it('keeps only primary eligible unfinished rooms from the manager-approved plan', () => {
    const selected = selectCarryForwardPrimaryItems({
      planStatus: 'approved',
      items: [
        item('room-101'),
        item('room-102', 'manager', { manager_changed: true }),
        item('room-103', 'shared', { assignment_role: 'shared' }),
        item('room-104'),
        item('room-105'),
      ],
      eligibleRoomIds: new Set(['room-101', 'room-102', 'room-103', 'room-104']),
      completedRoomIds: new Set(['room-104']),
    });

    expect(selected.map(row => row.room_id)).toEqual(['room-101', 'room-102']);
  });

  it('never carries plan items after the plan has already been released', () => {
    const selected = selectCarryForwardPrimaryItems({
      planStatus: 'released',
      items: [item('room-101')],
      eligibleRoomIds: new Set(['room-101']),
    });

    expect(selected).toEqual([]);
  });
});
