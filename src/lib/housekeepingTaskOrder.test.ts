import { describe, expect, it } from 'vitest';
import { compareHousekeepingTasks, housekeepingTaskBucket, isCheckoutAssignment, type HousekeepingOrderAssignment } from './housekeepingTaskOrder';

const now = new Date('2026-11-26T08:00:00+01:00');
const task = (patch: Partial<HousekeepingOrderAssignment> = {}): HousekeepingOrderAssignment => ({
  status: 'assigned', assignment_type: 'daily_cleaning', rooms: { hotel: 'generic-test-hotel', room_number: '105', floor_number: 1 }, ...patch,
});
const bucket = (x: HousekeepingOrderAssignment, view: 'mobile' | 'desktop') => housekeepingTaskBucket(x, view, now);

describe('existing housekeeping ordering contracts', () => {
  for (const view of ['mobile', 'desktop'] as const) {
    it(`preserves generic priority and floor order on ${view}`, () => {
      const running = task({ status: 'in_progress' });
      const priority = task({ priority: 3 });
      const ready = task({ assignment_type: 'checkout_cleaning', ready_to_clean: true });
      const daily = task();
      const waiting = task({ assignment_type: 'checkout_cleaning' });
      const completed = task({ status: 'completed' });
      const cancelled = task({ status: 'cancelled' });
      expect([cancelled, waiting, daily, completed, priority, ready, running].sort((a, b) => compareHousekeepingTasks(a, b, view, now)))
        .toEqual([running, priority, ready, daily, waiting, completed, cancelled]);
      expect(compareHousekeepingTasks(task({ rooms: { floor_number: 1, room_number: '109' } }), task({ rooms: { floor_number: 2, room_number: '101' } }), view, now)).toBeLessThan(0);
    });
    it(`preserves Memories ready checkout, towels, request, daily and waiting on ${view}`, () => {
      const hotel = 'Hotel Memories Budapest';
      const ready = task({ assignment_type: 'checkout_cleaning', ready_to_clean: true, rooms: { hotel } });
      const towels = task({ rooms: { hotel, towel_change_required: true } });
      const request = task({ rooms: { hotel, notes: '[ROOM_CLEANING]' } });
      const daily = task({ rooms: { hotel } });
      const waiting = task({ assignment_type: 'checkout_cleaning', rooms: { hotel } });
      expect([ready, towels, request, daily, waiting].map(x => bucket(x, view))).toEqual([1, 2, 3, 4, 5]);
    });
    it(`preserves carry-forward checkout precedence on ${view}`, () => {
      const hotel = 'Hotel Ottofiori';
      expect(bucket(task({ assignment_type: 'checkout_cleaning', ready_to_clean: true, rooms: { hotel } }), view)).toBe(1);
      expect(bucket(task({ assignment_type: 'checkout_cleaning', rooms: { hotel } }), view)).toBe(4);
    });
  }

  it('records the mobile/desktop generic PMS discrepancy explicitly', () => {
    const freshCheckout = task({ ready_to_clean: true, rooms: { pms_metadata: { pmsSyncDate: '2026-11-26', scheduledDepartureToday: true } } });
    expect(isCheckoutAssignment(freshCheckout, now)).toBe(true);
    expect(bucket(freshCheckout, 'mobile')).toBe(2);
    expect(bucket(freshCheckout, 'desktop')).toBe(3);
    const staleAssignmentType = task({ assignment_type: 'checkout_cleaning', ready_to_clean: true, rooms: { pms_metadata: { pmsSyncDate: '2026-11-26' } } });
    expect(isCheckoutAssignment(staleAssignmentType, now)).toBe(false);
    expect(bucket(staleAssignmentType, 'mobile')).toBe(3);
    expect(bucket(staleAssignmentType, 'desktop')).toBe(2);
  });

  it('retains both existing door-retry buckets without changing unlock policy', () => {
    const retry = task({ status: 'dnd_pending_retry', dnd_retry_unlocked_at: now.toISOString() });
    const locked = task({ status: 'dnd_pending_retry' });
    expect([bucket(retry, 'mobile'), bucket(locked, 'mobile')]).toEqual([6, 7]);
    expect([bucket(retry, 'desktop'), bucket(locked, 'desktop')]).toEqual([4, 5]);
  });
});
